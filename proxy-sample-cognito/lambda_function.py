"""
SSO migration proxy — AWS Lambda handler.

Sits behind an API Gateway custom-domain route and receives SAML Responses that
customer IdPs POST to the legacy ACS URL (the one on your custom domain). For
each inbound request, looks up migration state per tenant in DynamoDB and
forwards the assertion to either the original Cognito ACS URL or the new WorkOS
ACS URL via an auto-submitting HTML form (standard SAML proxy pattern).

Expected DynamoDB table schema (partition key: tenant_id):

    {
      "tenant_id": "tenant-a-saml",                                # HASH key
      "migrated": true,                                            # bool
      "workos_acs_url": "https://api.workos.com/sso/saml/acs/...", # populated by sync_workos.py
      "workos_connection_id": "conn_01ABC...",
      "updated_at": 1716466000
    }

Environment variables:

    MIGRATIONS_TABLE          DynamoDB table name
    COGNITO_FALLBACK_ACS_URL  Full legacy Cognito ACS URL, used when migrated=false
                              e.g. https://<pool-domain>.auth.us-east-1.amazoncognito.com/saml2/idpresponse

This file is a starting point — adjust routing, logging, and error handling for
your environment. Deploy via Serverless Framework, SAM, Terraform, or the AWS
console. API Gateway route suggestion:

    POST /sso/{tenant_id}/acs   → this Lambda
"""
from __future__ import annotations

import base64
import html
import json
import logging
import os
import urllib.parse

import boto3
from botocore.exceptions import ClientError


logger = logging.getLogger()
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ["MIGRATIONS_TABLE"]
COGNITO_FALLBACK_ACS_URL = os.environ["COGNITO_FALLBACK_ACS_URL"]

_dynamodb = boto3.resource("dynamodb")
_table = _dynamodb.Table(TABLE_NAME)


def lambda_handler(event, context):
    """API Gateway HTTP API v2.0 entry point."""
    path_params = event.get("pathParameters") or {}
    tenant_id = path_params.get("tenant_id") or _tenant_from_path(event.get("rawPath", ""))

    if not tenant_id:
        logger.warning("missing tenant_id in request path: %s", event.get("rawPath"))
        return _plain(400, "missing tenant_id in path")

    saml_response, relay_state = _read_saml_form(event)
    if not saml_response:
        logger.warning("tenant=%s missing SAMLResponse", tenant_id)
        return _plain(400, "missing SAMLResponse in form body")

    record = _fetch_tenant_record(tenant_id)

    if record.get("migrated") is True and record.get("workos_acs_url"):
        target_url = record["workos_acs_url"]
        route = "workos"
    else:
        target_url = COGNITO_FALLBACK_ACS_URL
        route = "cognito"

    logger.info(
        "tenant=%s route=%s target=%s relay_state_present=%s",
        tenant_id,
        route,
        target_url,
        bool(relay_state),
    )
    return _auto_submit_form(target_url, saml_response, relay_state)


def _tenant_from_path(raw_path: str) -> str | None:
    """Fallback parser for path layouts API Gateway path params miss (e.g. ALB).

    Expected: /sso/{tenant_id}/acs
    """
    parts = [p for p in (raw_path or "").strip("/").split("/") if p]
    if len(parts) >= 3 and parts[0] == "sso" and parts[-1] == "acs":
        return parts[1]
    return None


def _read_saml_form(event: dict) -> tuple[str, str]:
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8", errors="replace")
    fields = urllib.parse.parse_qs(body, keep_blank_values=True)
    return fields.get("SAMLResponse", [""])[0], fields.get("RelayState", [""])[0]


def _fetch_tenant_record(tenant_id: str) -> dict:
    try:
        resp = _table.get_item(Key={"tenant_id": tenant_id})
    except ClientError as e:
        logger.error("dynamodb get_item failed for %s: %s", tenant_id, e)
        return {}
    return resp.get("Item") or {}


def _auto_submit_form(action_url: str, saml_response: str, relay_state: str) -> dict:
    """Emit the standard SAML auto-submitting form. The browser re-POSTs instantly."""
    body = (
        "<!doctype html><html><head><title>Forwarding SSO</title></head>"
        "<body onload=\"document.forms[0].submit()\">"
        "<noscript><p>JavaScript is disabled. Click Continue to proceed.</p></noscript>"
        f"<form method=\"POST\" action=\"{html.escape(action_url)}\">"
        f"<input type=\"hidden\" name=\"SAMLResponse\" value=\"{html.escape(saml_response)}\"/>"
        f"<input type=\"hidden\" name=\"RelayState\" value=\"{html.escape(relay_state or '')}\"/>"
        "<noscript><button type=\"submit\">Continue</button></noscript>"
        "</form></body></html>"
    )
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": body,
    }


def _plain(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "text/plain; charset=utf-8"},
        "body": message,
    }
