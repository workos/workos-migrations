import type { CSVRow } from '../shared/types.js';

export interface ValidationIssue {
  row?: number;
  column?: string;
  message: string;
  severity: 'error' | 'warning';
  fixable: boolean;
}

export interface AutoFixChange {
  row: number;
  column: string;
  original: string;
  fixed: string;
  reason: string;
}

// Known WorkOS CSV columns
const KNOWN_COLUMNS = new Set([
  'email',
  'first_name',
  'last_name',
  'email_verified',
  'external_id',
  'password',
  'password_hash',
  'password_hash_type',
  'metadata',
  'org_id',
  'org_external_id',
  'org_name',
  'role_slugs',
]);

const RESERVED_METADATA_FIELDS = new Set([
  'org_id',
  'org_name',
  'org_external_id',
  'email',
  'first_name',
  'last_name',
  'email_verified',
  'external_id',
  'password_hash',
  'password_hash_type',
]);

// --- Pass 1: Header Rules ---

export function validateHeaders(headers: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!headers.includes('email')) {
    issues.push({
      message: 'Missing required column: email',
      severity: 'error',
      fixable: false,
    });
  }

  for (const h of headers) {
    if (!KNOWN_COLUMNS.has(h)) {
      issues.push({
        column: h,
        message: `Unknown column "${h}" — will be ignored during import`,
        severity: 'warning',
        fixable: false,
      });
    }
  }

  return issues;
}

// --- Pass 2: Row Rules ---

export function validateRow(row: CSVRow, rowNum: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Email required
  const email = typeof row.email === 'string' ? row.email.trim() : '';
  if (!email) {
    issues.push({ row: rowNum, column: 'email', message: 'Missing required email', severity: 'error', fixable: false });
  } else if (!email.includes('@')) {
    issues.push({ row: rowNum, column: 'email', message: `Invalid email format: ${email}`, severity: 'error', fixable: false });
  } else if (email !== String(row.email)) {
    issues.push({ row: rowNum, column: 'email', message: `Email has leading/trailing whitespace`, severity: 'warning', fixable: true });
  }

  // email_verified should be boolean-parseable
  if (row.email_verified !== undefined && row.email_verified !== '') {
    const val = String(row.email_verified).toLowerCase().trim();
    const validBooleans = new Set(['true', 'false', 'yes', 'no', '1', '0', 'y', 'n']);
    if (!validBooleans.has(val)) {
      issues.push({ row: rowNum, column: 'email_verified', message: `Invalid boolean value: "${row.email_verified}"`, severity: 'warning', fixable: true });
    }
  }

  // Metadata must be valid JSON
  if (row.metadata && typeof row.metadata === 'string' && row.metadata.trim()) {
    try {
      const parsed = JSON.parse(row.metadata);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        issues.push({ row: rowNum, column: 'metadata', message: 'Metadata must be a JSON object', severity: 'error', fixable: false });
      } else {
        // Check for non-string values (WorkOS requires string values)
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== 'string') {
            issues.push({ row: rowNum, column: 'metadata', message: `Metadata field "${key}" is not a string (${typeof value})`, severity: 'warning', fixable: true });
          }
        }
        // Check for reserved field names
        for (const key of Object.keys(parsed)) {
          if (RESERVED_METADATA_FIELDS.has(key)) {
            issues.push({ row: rowNum, column: 'metadata', message: `Metadata contains reserved field name "${key}"`, severity: 'warning', fixable: true });
          }
        }
      }
    } catch {
      issues.push({ row: rowNum, column: 'metadata', message: 'Invalid JSON in metadata field', severity: 'error', fixable: false });
    }
  }

  // password_hash and password_hash_type must be paired
  const hasHash = row.password_hash && String(row.password_hash).trim();
  const hasType = row.password_hash_type && String(row.password_hash_type).trim();
  if (hasHash && !hasType) {
    issues.push({ row: rowNum, column: 'password_hash', message: 'password_hash provided without password_hash_type', severity: 'error', fixable: false });
  }
  if (!hasHash && hasType) {
    issues.push({ row: rowNum, column: 'password_hash_type', message: 'password_hash_type provided without password_hash', severity: 'error', fixable: false });
  }

  // org_id and org_external_id are mutually exclusive
  const hasOrgId = row.org_id && String(row.org_id).trim();
  const hasOrgExternalId = row.org_external_id && String(row.org_external_id).trim();
  if (hasOrgId && hasOrgExternalId) {
    issues.push({ row: rowNum, message: 'Row has both org_id and org_external_id — these are mutually exclusive', severity: 'error', fixable: false });
  }

  // role_slugs format
  if (row.role_slugs && String(row.role_slugs).trim()) {
    const raw = String(row.role_slugs).trim();
    let slugs: string[];
    try {
      const parsed = JSON.parse(raw);
      slugs = Array.isArray(parsed) ? parsed.map(String) : raw.split(',');
    } catch {
      slugs = raw.split(',');
    }
    for (const slug of slugs) {
      const trimmed = slug.trim();
      if (trimmed && !/^[a-z0-9_-]+$/.test(trimmed)) {
        issues.push({ row: rowNum, column: 'role_slugs', message: `Invalid role slug "${trimmed}" — must be lowercase alphanumeric with hyphens/underscores`, severity: 'error', fixable: false });
      }
    }
  }

  return issues;
}
