import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';
import { runImport } from '../import/importer.js';
import { validateMigrationPackage, } from '../package/validator.js';
import { loadMigrationPackage } from '../package/writer.js';
import { processRoleDefinitions, assignRolesToUsers } from '../roles/processor.js';
import { enrollTotp } from '../totp/enroller.js';
import * as logger from '../shared/logger.js';
const ABSENT = { status: 'absent' };
export async function planImportPackage(packageDir) {
    const resolvedDir = path.resolve(packageDir);
    const validation = await validateMigrationPackage(resolvedDir, {
        requireFiles: false,
        validateCsvHeaders: true,
        validateCounts: false,
    });
    let pkg;
    try {
        pkg = await loadMigrationPackage(resolvedDir);
    }
    catch (error) {
        throw new Error(`Unable to load migration package at ${resolvedDir}: ${error.message}`);
    }
    const counts = pkg.manifest.entitiesExported ?? {};
    return {
        packageDir: resolvedDir,
        manifestProvider: pkg.manifest.provider,
        hasUsersCsv: await csvHasRows(pkg.files.users),
        hasOrganizationsCsv: await csvHasRows(pkg.files.organizations),
        hasMembershipsCsv: await csvHasRows(pkg.files.memberships),
        hasRoleDefinitionsCsv: await csvHasRows(pkg.files.roleDefinitions),
        hasRoleAssignmentsCsv: await csvHasRows(pkg.files.userRoleAssignments),
        hasTotpCsv: await csvHasRows(pkg.files.totpSecrets),
        hasSso: (await csvHasRows(pkg.files.samlConnections)) ||
            (await csvHasRows(pkg.files.oidcConnections)),
        expectedCounts: counts,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
    };
}
export async function importPackage(options) {
    const startedAt = Date.now();
    const resolvedDir = path.resolve(options.packageDir);
    const plan = await planImportPackage(resolvedDir);
    const warnings = [];
    if (plan.validationErrors.length > 0) {
        throw new Error(`Package failed validation:\n${plan.validationErrors.map((issue) => `- ${issue.message}`).join('\n')}`);
    }
    const dryRun = options.dryRun ?? false;
    const quiet = options.quiet ?? false;
    const errorsPath = options.errorsPath ?? path.join(resolvedDir, 'workos_import_errors.jsonl');
    let organizations = { ...ABSENT };
    let users = { ...ABSENT };
    let memberships = { ...ABSENT };
    let roleDefinitions = { ...ABSENT };
    let roleAssignments = { ...ABSENT };
    let totpFactors = { ...ABSENT };
    // 1. Organizations — pre-create using create-org-if-missing semantics during user import.
    if (plan.hasOrganizationsCsv) {
        organizations = {
            status: dryRun ? 'planned' : 'imported',
            total: plan.expectedCounts.organizations ?? 0,
            notes: [
                'Organizations are resolved or created during user import using --create-org-if-missing semantics. Domains and metadata are preserved as warnings if not yet supported by the importer.',
            ],
        };
    }
    // 2. Users + memberships — runImport handles both via row org columns.
    if (plan.hasUsersCsv) {
        if (dryRun) {
            users = {
                status: 'planned',
                total: plan.expectedCounts.users ?? 0,
            };
            memberships = plan.hasMembershipsCsv
                ? { status: 'planned', total: plan.expectedCounts.memberships ?? 0 }
                : { ...ABSENT };
        }
        else {
            if (!options.workos) {
                throw new Error('importPackage requires options.workos when dryRun is false');
            }
            if (!quiet)
                logger.info('Importing users + memberships...');
            const importSummary = await runImport({
                workos: options.workos,
                csvPath: path.join(resolvedDir, 'users.csv'),
                concurrency: options.concurrency ?? 10,
                rateLimit: options.rateLimit ?? 50,
                orgId: null,
                createOrgIfMissing: true,
                dryRun: false,
                dedupe: false,
                errorsPath,
                quiet: true,
            });
            users = {
                status: 'imported',
                total: importSummary.totalRows,
                succeeded: importSummary.usersCreated,
                failed: importSummary.errors,
                warnings: importSummary.warnings,
                details: {
                    duplicateUsers: importSummary.duplicateUsers,
                },
            };
            memberships = {
                status: 'imported',
                total: importSummary.totalRows,
                succeeded: importSummary.membershipsCreated,
                failed: importSummary.errors,
                details: {
                    rolesAssigned: importSummary.rolesAssigned,
                    roleAssignmentFailures: importSummary.roleAssignmentFailures,
                    duplicateMemberships: importSummary.duplicateMemberships,
                },
            };
        }
    }
    // 3. Role definitions
    if (plan.hasRoleDefinitionsCsv) {
        const definitionsPath = path.join(resolvedDir, 'role_definitions.csv');
        if (dryRun) {
            roleDefinitions = {
                status: 'planned',
                total: plan.expectedCounts.roleDefinitions ?? 0,
            };
        }
        else {
            if (!options.workos) {
                throw new Error('importPackage requires options.workos when dryRun is false');
            }
            if (!quiet)
                logger.info('Processing role definitions...');
            const summary = await processRoleDefinitions(definitionsPath, {
                dryRun: false,
            });
            roleDefinitions = {
                status: 'imported',
                total: summary.total,
                succeeded: summary.created + summary.alreadyExist,
                failed: summary.errors,
                warnings: summary.warnings,
            };
        }
    }
    // 4. Role assignments — group by org_external_id and call assignRolesToUsers per org.
    if (plan.hasRoleAssignmentsCsv) {
        if (dryRun) {
            roleAssignments = {
                status: 'planned',
                total: plan.expectedCounts.userRoleAssignments ?? 0,
            };
        }
        else if (!options.workos) {
            throw new Error('importPackage requires options.workos when dryRun is false');
        }
        else {
            const assignmentsPath = path.join(resolvedDir, 'user_role_assignments.csv');
            const groups = await groupAssignmentsByOrg(assignmentsPath);
            let totalAssigned = 0;
            let totalFailed = 0;
            const aggregatedWarnings = [];
            for (const [orgExternalId, mappingPath] of groups) {
                if (!options.workos)
                    continue;
                if (!quiet) {
                    logger.info(`Assigning roles for org ${orgExternalId}...`);
                }
                try {
                    const result = await assignRolesToUsers(mappingPath, options.workos, {
                        orgId: orgExternalId,
                        dryRun: false,
                    });
                    totalAssigned += result.assigned;
                    totalFailed += result.failures;
                    aggregatedWarnings.push(...result.warnings);
                }
                catch (error) {
                    aggregatedWarnings.push(`Failed to assign roles for org ${orgExternalId}: ${error.message}`);
                    totalFailed += 1;
                }
            }
            roleAssignments = {
                status: 'imported',
                total: totalAssigned + totalFailed,
                succeeded: totalAssigned,
                failed: totalFailed,
                warnings: aggregatedWarnings,
            };
        }
    }
    // 5. TOTP enrollment
    if (plan.hasTotpCsv) {
        if (dryRun) {
            totpFactors = {
                status: 'planned',
                total: plan.expectedCounts.totpSecrets ?? 0,
            };
        }
        else if (!options.workos) {
            throw new Error('importPackage requires options.workos when dryRun is false');
        }
        else {
            if (!quiet)
                logger.info('Enrolling TOTP factors...');
            const totpResult = await enrollTotp(options.workos, {
                inputPath: path.join(resolvedDir, 'totp_secrets.csv'),
                format: 'csv',
                concurrency: options.concurrency ?? 5,
                rateLimit: Math.min(options.rateLimit ?? 50, 10),
                dryRun: false,
                errorsPath: path.join(resolvedDir, 'workos_totp_errors.jsonl'),
                quiet: true,
            });
            totpFactors = {
                status: 'imported',
                total: totpResult.summary.total,
                succeeded: totpResult.summary.enrolled,
                failed: totpResult.summary.failures,
                warnings: totpResult.summary.warnings,
            };
        }
    }
    // 6. SSO handoff detection — never imported automatically.
    const ssoConnections = plan.hasSso
        ? {
            status: 'handoff',
            total: (plan.expectedCounts.samlConnections ?? 0) + (plan.expectedCounts.oidcConnections ?? 0),
            notes: [
                'SSO connection files are handoff-only and were not imported automatically.',
                'See sso/handoff_notes.md for next steps.',
            ],
        }
        : { ...ABSENT };
    if (plan.validationWarnings.length > 0) {
        for (const issue of plan.validationWarnings) {
            warnings.push(`${issue.code}: ${issue.message}`);
        }
    }
    const finishedAt = Date.now();
    const summary = {
        packageDir: resolvedDir,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        dryRun,
        manifestProvider: plan.manifestProvider,
        plan,
        organizations,
        users,
        memberships,
        roleDefinitions,
        roleAssignments,
        totpFactors,
        ssoConnections,
        warnings,
    };
    const summaryPath = options.summaryPath ?? path.join(resolvedDir, 'workos_import_summary.json');
    await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    return summary;
}
async function csvHasRows(filePath) {
    try {
        await fsp.access(filePath);
    }
    catch {
        return false;
    }
    return new Promise((resolve, reject) => {
        let resolved = false;
        const stream = fs.createReadStream(filePath);
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
        parser.on('readable', () => {
            const row = parser.read();
            if (row && !resolved) {
                resolved = true;
                resolve(true);
                parser.destroy();
                stream.destroy();
            }
        });
        parser.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });
        parser.on('end', () => {
            if (!resolved)
                resolve(false);
        });
        stream.pipe(parser);
    });
}
async function groupAssignmentsByOrg(assignmentsCsvPath) {
    const rowsByOrg = new Map();
    await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(assignmentsCsvPath);
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true });
        stream
            .pipe(parser)
            .on('data', (row) => {
            const orgKey = row.org_external_id?.trim() || row.org_id?.trim();
            if (!orgKey)
                return;
            const list = rowsByOrg.get(orgKey) ?? [];
            list.push(row);
            rowsByOrg.set(orgKey, list);
        })
            .on('end', resolve)
            .on('error', reject);
    });
    const tmpDir = path.join(path.dirname(assignmentsCsvPath), 'tmp_role_assignments');
    await fsp.mkdir(tmpDir, { recursive: true });
    const result = new Map();
    for (const [orgExternalId, rows] of rowsByOrg) {
        const safe = orgExternalId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filePath = path.join(tmpDir, `${safe}.csv`);
        const headers = ['email', 'user_id', 'external_id', 'role_slug', 'org_id', 'org_external_id'];
        const lines = [headers.join(',')];
        for (const row of rows) {
            lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
        }
        await fsp.writeFile(filePath, `${lines.join('\n')}\n`, 'utf-8');
        result.set(orgExternalId, filePath);
    }
    return result;
}
function csvEscape(value) {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
