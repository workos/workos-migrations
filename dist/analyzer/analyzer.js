import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
/**
 * Normalize error message by replacing dynamic values with placeholders.
 */
function normalizeMessage(message) {
    let m = message;
    // Emails
    m = m.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<EMAIL>');
    // UUIDs
    m = m.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>');
    // WorkOS IDs (org_..., user_...)
    m = m.replace(/\b(org|user)_[A-Za-z0-9]{10,}/g, '<$1_ID>');
    // Long numbers
    m = m.replace(/\b\d{5,}\b/g, '<NUMBER>');
    return m.replace(/\s+/g, ' ').trim();
}
/**
 * Classify whether an error is retryable based on HTTP status and type.
 */
function classifyRetryability(error) {
    if (error.httpStatus === 429)
        return { retryable: true, reason: 'Rate limited — retry with lower concurrency' };
    if (error.httpStatus && error.httpStatus >= 500)
        return { retryable: true, reason: 'Server error — retry after service recovery' };
    if (!error.httpStatus)
        return { retryable: true, reason: 'Unknown error (no HTTP status) — may be network issue' };
    if (error.httpStatus === 409)
        return { retryable: false, reason: 'Conflict — resource already exists' };
    if (error.httpStatus === 400 || error.httpStatus === 422)
        return { retryable: false, reason: 'Validation error — fix data before retry' };
    if (error.httpStatus === 403)
        return { retryable: false, reason: 'Permission denied — check API key permissions' };
    return { retryable: false, reason: 'Non-retryable client error' };
}
/**
 * Generate a fix suggestion for an error group.
 */
function suggestFix(pattern, errorType, httpStatus) {
    const lower = pattern.toLowerCase();
    if (httpStatus === 429)
        return 'Reduce --concurrency value (try 5 or lower) and retry';
    if (httpStatus && httpStatus >= 500)
        return 'Wait a few minutes and retry with the generated retry CSV';
    if (httpStatus === 409 && errorType === 'user_create')
        return 'Users already exist in WorkOS — these can be safely ignored';
    if (httpStatus === 409 && errorType === 'membership_create')
        return 'Memberships already exist — remove duplicate user-org pairs';
    if (errorType === 'org_resolution' && lower.includes('not found'))
        return 'Organization not found — verify org_id/org_external_id values or use --create-org-if-missing';
    if (lower.includes('invalid email'))
        return 'Fix email addresses in CSV to match name@domain.com format';
    if (lower.includes('password_hash') && lower.includes('type'))
        return 'Add password_hash_type column for rows with password hashes';
    if (lower.includes('invalid json'))
        return 'Fix malformed JSON in metadata column';
    if (httpStatus === 400 || httpStatus === 422)
        return 'Validation error — review error details and fix CSV data';
    return 'Review error details in the examples';
}
/**
 * Analyze error JSONL file, grouping errors by pattern and classifying retryability.
 */
export async function analyzeErrors(errorsPath) {
    const errors = [];
    // Stream JSONL
    const fileStream = createReadStream(errorsPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.trim())
            continue;
        try {
            errors.push(JSON.parse(line));
        }
        catch {
            // Skip invalid JSON lines
        }
    }
    // Group by normalized pattern + type + status
    const groupMap = new Map();
    for (const error of errors) {
        const pattern = normalizeMessage(error.errorMessage);
        const key = `${error.errorType || 'unknown'}:${error.httpStatus || 'none'}:${pattern}`;
        let group = groupMap.get(key);
        if (!group) {
            group = { pattern, errorType: error.errorType || 'unknown', httpStatus: error.httpStatus, errors: [] };
            groupMap.set(key, group);
        }
        group.errors.push(error);
    }
    // Build error groups with classification
    const errorGroups = [];
    let retryableCount = 0;
    let nonRetryableCount = 0;
    const suggestions = [];
    for (const group of groupMap.values()) {
        const sample = group.errors[0];
        const { retryable } = classifyRetryability(sample);
        const suggestion = suggestFix(group.pattern, group.errorType, group.httpStatus);
        if (retryable) {
            retryableCount += group.errors.length;
        }
        else {
            nonRetryableCount += group.errors.length;
        }
        errorGroups.push({
            pattern: group.pattern,
            count: group.errors.length,
            errorType: group.errorType,
            httpStatus: group.httpStatus,
            retryable,
            suggestion,
            examples: group.errors.slice(0, 3),
        });
    }
    // Sort by count descending
    errorGroups.sort((a, b) => b.count - a.count);
    // Collect unique suggestions
    for (const g of errorGroups) {
        if (!suggestions.includes(g.suggestion)) {
            suggestions.push(g.suggestion);
        }
    }
    return {
        totalErrors: errors.length,
        errorGroups,
        retryableCount,
        nonRetryableCount,
        suggestions,
    };
}
