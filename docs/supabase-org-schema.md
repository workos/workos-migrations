# Supabase organizations & role mapping

Supabase Auth has no built-in organization concept — orgs typically live in your application's `public.*` schema. To export them, `export-supabase` accepts a group of flags that describe your schema, then builds safe parameterized queries against the tables you name.

## Required flags (must all be supplied together)

| Flag                          | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `--org-table`                 | Postgres table holding organizations (e.g., `public.organizations`)         |
| `--org-id-column`             | Column on `--org-table` that holds the primary id                           |
| `--org-name-column`           | Column on `--org-table` that holds the display name                         |
| `--org-members-table`         | Postgres table holding org memberships (e.g., `public.org_members`)         |
| `--membership-user-column`    | Column on `--org-members-table` that holds the user UUID (joined to `auth.users.id`) |
| `--membership-org-column`     | Column on `--org-members-table` that holds the org id (joined to `--org-id-column`) |

If any of the above is supplied without all the others, `export-supabase` fails with `Incomplete org schema flags`.

## Optional flags

| Flag                          | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `--org-external-id-column`    | Column on `--org-table` that holds the external org identifier (e.g., a `slug`). Defaults to `--org-id-column`. |
| `--org-domains-column`        | Column on `--org-table` that holds the org domain. Accepts a `text` scalar or a `text[]` array; arrays are comma-joined. |
| `--membership-role-column`    | Column on `--org-members-table` that holds the per-membership role (e.g., `owner`, `member`). Required if you want `role_slugs` populated. |
| `--role-slug-map`             | Path to a JSON or CSV file mapping raw DB role values to WorkOS role slugs (see below). |

## Identifier rules

Every flag value is validated against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before any SQL is constructed. This is stricter than what Postgres allows — non-ASCII identifiers and identifiers containing special characters are rejected even though they may exist in your database. This is defense-in-depth against SQL injection through CLI arguments.

If you have an identifier that doesn't match this pattern, create a database VIEW that renames it (see Example B).

## Role-slug map format

The role-slug map translates raw DB role values into the role slugs your WorkOS environment expects. Two formats are accepted:

**JSON dict (`.json`):**

```json
{
  "owner": "admin",
  "admin": "admin",
  "member": "member",
  "guest": "viewer"
}
```

**CSV with `role,slug` columns (`.csv`):**

```csv
role,slug
owner,admin
admin,admin
member,member
guest,viewer
```

Matching is **case-sensitive**: a DB row with `role = 'Owner'` will not match the key `owner`. Normalize at the source if needed.

A DB role with no corresponding map entry produces a per-membership warning (`Unmapped role: <value>`) in `warnings.jsonl` and leaves `role_slugs` empty for that membership. Memberships are still exported.

If `--role-slug-map` is not supplied, the DB role value is written verbatim into `role_slugs`.

## Example A — Single-tenant teams schema

Schema:

```sql
CREATE TABLE public.teams (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE,
  name TEXT,
  domain TEXT
);

CREATE TABLE public.team_members (
  team_id UUID REFERENCES public.teams(id),
  user_id UUID REFERENCES auth.users(id),
  role TEXT,  -- 'owner', 'admin', 'member'
  PRIMARY KEY (team_id, user_id)
);
```

Invocation:

```bash
workos-migrate export-supabase \
  --url https://abc.supabase.co \
  --service-role-key sk_... \
  --db-url postgresql://postgres:...@db.abc.supabase.co:5432/postgres \
  --package --output-dir ./migration-supabase \
  --entities users,identities,mfa,organizations \
  --org-table public.teams \
  --org-id-column id \
  --org-name-column name \
  --org-external-id-column slug \
  --org-domains-column domain \
  --org-members-table public.team_members \
  --membership-user-column user_id \
  --membership-org-column team_id \
  --membership-role-column role \
  --role-slug-map ./roles.json
```

## Example B — B2B with separate orgs and roles tables

If your schema stores roles in a join table rather than as a column on the membership row, the schema-flag approach won't work directly — only a single column per membership is supported.

Workaround: create a VIEW that flattens the roles into a single text column.

Schema:

```sql
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY,
  name TEXT
);

CREATE TABLE public.organization_members (
  organization_id UUID,
  user_id UUID,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE public.organization_member_roles (
  organization_id UUID,
  user_id UUID,
  role TEXT,
  PRIMARY KEY (organization_id, user_id, role)
);
```

View:

```sql
CREATE VIEW public.organization_members_with_roles AS
  SELECT om.organization_id,
         om.user_id,
         (
           SELECT string_agg(omr.role, ',' ORDER BY omr.role)
             FROM public.organization_member_roles omr
            WHERE omr.organization_id = om.organization_id
              AND omr.user_id = om.user_id
         ) AS role
    FROM public.organization_members om;
```

Invocation:

```bash
workos-migrate export-supabase \
  --url https://abc.supabase.co \
  --service-role-key sk_... \
  --db-url postgresql://postgres:...@db.abc.supabase.co:5432/postgres \
  --package --output-dir ./migration-supabase \
  --entities users,organizations \
  --org-table public.organizations \
  --org-id-column id \
  --org-name-column name \
  --org-members-table public.organization_members_with_roles \
  --membership-user-column user_id \
  --membership-org-column organization_id \
  --membership-role-column role
```

The view returns a single `role` column with comma-joined values per membership; the role-slug map maps each raw value through to a WorkOS slug.

## Orphan memberships

The exporter joins `--org-members-table` against `auth.users` via INNER JOIN. Memberships referencing a `user_id` that is not present in `auth.users` (orphan memberships, common after manual user deletions) are silently dropped from the output. A separate count query reports them in `warnings.jsonl` so they're visible in the manifest's warnings list.

## What ends up where

- `organizations.csv` — one row per org from `--org-table`
- `organization_memberships.csv` — one row per (user, org, role) tuple from `--org-members-table`, joined to `auth.users` for email + external_id
- `warnings.jsonl` — unmapped roles, orphan counts, table-not-found, role-slug-map load failures
- `manifest.json` — `entitiesExported.organizations` and `entitiesExported.memberships` reflect emitted row counts

Downstream `import-package` consumes these unchanged.
