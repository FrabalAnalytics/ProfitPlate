# Local database workflow

Run from `web/` after `npm ci`.

```powershell
# Fast PostgreSQL checks; no Docker or credentials required.
npm run db:test

# Native PostgreSQL 17, including independent-session races; no Docker required.
npm run db:test:native

# Generate types from a fresh native database without Docker.
node scripts/test-database-native.mjs --types-only

# Full local Supabase integration; requires Docker.
npm run db:start
npm run db:reset
npm run db:lint
npm run db:test:local
npm run db:test:api
npm run db:types

# Verify checked-in types without replacing them.
node scripts/generate-database-types.mjs --check
```

The migration seeds only immutable system units, without demo tenants or opening stock. Email verification is enabled; use the local mail viewer for manual signup tests.

`db:test:local` uses loopback PostgreSQL and rolls fixtures back. `db:test:api` obtains credentials only from the local CLI, creates disposable users/tenants, sends no email, and leaves fixtures until the next local reset. Neither runner loads `.env.local` or accepts hosted credentials.

The portable native server uses a fresh workspace `.db-test` directory, random password, temporary loopback port, and graceful shutdown. The Windows runner validates its cleanup directory before recursive removal. Fast/native suites emulate Auth SQL functions; full Supabase API tests verify real signed sessions and PostgREST separately.

The workspace was linked through Supabase CLI login and the foundation migration was applied to project `ndvqzhvnwbemqmwdlckl` on 27 October 2026. Before future migrations, inspect `supabase db push --linked --dry-run` using the intended target project. There is no deployment command in build/test scripts. Local CLI config does not propagate to hosted Auth/API settings; configure email verification, password policy, trusted redirects, and disabled auto-exposure there too.

Read-only hosted verification:

```powershell
npx supabase db query --linked --file supabase/verification/foundation.sql
```

See [Database_Foundation.md](../docs/Database_Foundation.md) for schema, permissions, command contracts, worker protocol, and limitations.
