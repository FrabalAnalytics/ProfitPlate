import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

// A deliberately small Auth fixture, not a replacement for Supabase integration tests.
export async function installAuthFixture(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
  `);
}

export async function applyMigrations(db) {
  for (const file of (await readdir(path.join(projectRoot, 'supabase/migrations'))).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(path.join(projectRoot, 'supabase/migrations', file), 'utf8'));
  }
}

export function testConnectionString() {
  const value=process.env.PROFITPLATE_TEST_DATABASE_URL;
  if (!value) throw new Error('Run this through npm run db:test:native.');
  const url=new URL(value);
  if (url.hostname!=='127.0.0.1' || url.pathname!=='/profitplate_test') throw new Error('Only the isolated loopback test database is allowed.');
  return value;
}
