/**
 * Apply auto-fixes to a CSV row, returning the fixed row and a list of changes.
 */
export function autoFixRow(row, rowNum) {
    const fixed = { ...row };
    const changes = [];
    // Fix 1: Trim whitespace from email
    if (fixed.email && typeof fixed.email === 'string' && fixed.email !== fixed.email.trim()) {
        const original = fixed.email;
        fixed.email = fixed.email.trim();
        changes.push({ row: rowNum, column: 'email', original, fixed: fixed.email, reason: 'Trimmed whitespace from email' });
    }
    // Fix 2: Normalize boolean fields (Yes/No/1/0/y/n → true/false)
    if (fixed.email_verified !== undefined && fixed.email_verified !== '') {
        const val = String(fixed.email_verified).toLowerCase().trim();
        let normalized;
        if (['true', 'yes', 'y', '1'].includes(val))
            normalized = 'true';
        else if (['false', 'no', 'n', '0'].includes(val))
            normalized = 'false';
        if (normalized && String(fixed.email_verified) !== normalized) {
            const original = String(fixed.email_verified);
            fixed.email_verified = normalized;
            changes.push({ row: rowNum, column: 'email_verified', original, fixed: normalized, reason: 'Normalized boolean value' });
        }
    }
    // Fix 3: Metadata - stringify non-string values and rename reserved fields
    if (fixed.metadata && typeof fixed.metadata === 'string' && fixed.metadata.trim()) {
        try {
            const parsed = JSON.parse(fixed.metadata);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                let changed = false;
                const result = {};
                for (const [key, value] of Object.entries(parsed)) {
                    let newKey = key;
                    let newValue;
                    // Stringify non-string values
                    if (typeof value !== 'string') {
                        newValue = JSON.stringify(value);
                        changes.push({ row: rowNum, column: `metadata.${key}`, original: String(value), fixed: newValue, reason: 'Stringified non-string metadata value' });
                        changed = true;
                    }
                    else {
                        newValue = value;
                    }
                    // Rename reserved field names
                    const reservedFields = new Set([
                        'org_id', 'org_name', 'org_external_id', 'email',
                        'first_name', 'last_name', 'email_verified', 'external_id',
                        'password_hash', 'password_hash_type',
                    ]);
                    if (reservedFields.has(key)) {
                        newKey = `custom_${key}`;
                        changes.push({ row: rowNum, column: `metadata.${key}`, original: key, fixed: newKey, reason: `Renamed reserved metadata field "${key}" to "${newKey}"` });
                        changed = true;
                    }
                    result[newKey] = newValue;
                }
                if (changed) {
                    fixed.metadata = JSON.stringify(result);
                }
            }
        }
        catch {
            // Invalid JSON — can't fix, validation will catch it
        }
    }
    return { fixed, changes };
}
