"""
Populate / refresh the migration-state DynamoDB table from WorkOS.

Run as a scheduled Lambda (every 5–15 min during cutover) or on-demand. For each
connection in your WorkOS environment, this script:

  1. Derives the tenant_id from the connection's external_id (the CSV's
     `importedId` column = "<pool_id>:<provider_name>").
  2. Fetches the connection's SAML SP metadata to grab the ACS URL.
  3. Upserts the DynamoDB record so the proxy Lambda routes live traffic to
     WorkOS for that tenant.

Environment variables:

    WORKOS_API_KEY        your WorkOS API key (Bearer token)
    MIGRATIONS_TABLE      DynamoDB table name
    WORKOS_API_BASE       optional, defaults to https://api.workos.com

Notes on the WorkOS connection shape — the `external_id` on the connection must
match the `importedId` you wrote in the CSV. The included export tool formats
importedId as `<user_pool_id>:<provider_name>`; the tenant_id stored in
DynamoDB strips the pool prefix so the proxy routes by provider name only.
Adjust `_tenant_id_from_external_id` if you want a different scheme.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET

import boto3


logger = logging.getLogger()
logger.setLevel(logging.INFO)

WORKOS_API_KEY = os.environ["WORKOS_API_KEY"]
WORKOS_API_BASE = os.environ.get("WORKOS_API_BASE", "https://api.workos.com")
TABLE_NAME = os.environ["MIGRATIONS_TABLE"]

_table = boto3.resource("dynamodb").Table(TABLE_NAME)

SAML_NS = {"md": "urn:oasis:names:tc:SAML:2.0:metadata"}


def list_connections() -> list[dict]:
    """Paginate GET /connections, return list of connection dicts."""
    results: list[dict] = []
    cursor = None
    while True:
        url = f"{WORKOS_API_BASE}/connections?limit=100"
        if cursor:
            url += f"&after={cursor}"
        payload = _http_get_json(url)
        results.extend(payload.get("data", []))
        cursor = (payload.get("list_metadata") or {}).get("after")
        if not cursor:
            break
    return results


def fetch_acs_url(connection_id: str) -> str | None:
    """Grab SP metadata for a SAML connection and extract the AssertionConsumerService URL."""
    metadata_url = f"{WORKOS_API_BASE}/sso/metadata/{connection_id}"
    try:
        req = urllib.request.Request(
            metadata_url,
            headers={"Authorization": f"Bearer {WORKOS_API_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        logger.warning("metadata fetch failed for %s: %s", connection_id, e)
        return None

    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None

    acs = root.find(".//md:SPSSODescriptor/md:AssertionConsumerService", SAML_NS)
    return acs.attrib.get("Location") if acs is not None else None


def sync() -> dict:
    stats = {"updated": 0, "skipped_no_external_id": 0, "skipped_no_acs": 0}
    now = int(time.time())

    for conn in list_connections():
        external_id = conn.get("external_id")
        if not external_id:
            stats["skipped_no_external_id"] += 1
            continue

        tenant_id = _tenant_id_from_external_id(external_id)
        is_saml = (conn.get("connection_type") or "").upper().find("SAML") >= 0
        acs_url = fetch_acs_url(conn["id"]) if is_saml else None
        if is_saml and not acs_url:
            stats["skipped_no_acs"] += 1
            continue

        _table.put_item(
            Item={
                "tenant_id": tenant_id,
                "migrated": conn.get("state") == "active",
                "workos_connection_id": conn["id"],
                "workos_acs_url": acs_url or "",
                "connection_type": conn.get("connection_type", ""),
                "updated_at": now,
            }
        )
        stats["updated"] += 1

    logger.info("sync complete: %s", stats)
    return stats


def _tenant_id_from_external_id(external_id: str) -> str:
    """Strip the user-pool-id prefix so the proxy routes on the provider name alone.

    'us-east-1_ABC:tenant-a-saml' -> 'tenant-a-saml'
    """
    return external_id.split(":", 1)[-1]


def _http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {WORKOS_API_KEY}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def lambda_handler(event, context):
    """Entry point when run as a scheduled Lambda."""
    return {"statusCode": 200, "body": json.dumps(sync())}


if __name__ == "__main__":
    print(json.dumps(sync(), indent=2))
