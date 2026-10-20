import postgres from 'postgres'
import { env } from './env'

export const sql = postgres(env.databaseUrl, {
  max: 10,
  onnotice: () => {},
  transform: { undefined: null }
})

const MIGRATIONS: string[] = [
  `
  create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    name text not null default '',
    password_hash text not null,
    mode text not null default 'ecommerce',
    target_cpl numeric not null default 0,
    target_roas numeric not null default 0,
    demo boolean not null default true,
    created_at timestamptz not null default now()
  );
  create table if not exists sessions (
    token_hash text primary key,
    user_id uuid not null references users(id) on delete cascade,
    expires_at timestamptz not null
  );
  create table if not exists meta_connections (
    user_id uuid primary key references users(id) on delete cascade,
    access_token_enc text not null,
    meta_user_id text,
    meta_user_name text,
    expires_at timestamptz,
    updated_at timestamptz not null default now()
  );
  create table if not exists oauth_states (
    state text primary key,
    user_id uuid not null references users(id) on delete cascade,
    created_at timestamptz not null default now()
  );
  create table if not exists subscriptions (
    user_id uuid primary key references users(id) on delete cascade,
    stripe_customer_id text unique,
    stripe_subscription_id text,
    status text not null default 'none',
    current_period_end timestamptz,
    updated_at timestamptz not null default now()
  );
  create table if not exists sites (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    name text not null,
    domain text not null,
    public_key text not null unique,
    meta_pixel_id text,
    capi_token_enc text,
    test_event_code text,
    shopify_secret_enc text,
    currency text not null default 'EUR',
    created_at timestamptz not null default now()
  );
  create table if not exists visitors (
    site_id uuid not null references sites(id) on delete cascade,
    visitor_id text not null,
    first_touch jsonb,
    last_touch jsonb,
    fbp text,
    fbc text,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    primary key (site_id, visitor_id)
  );
  create table if not exists events (
    id bigserial primary key,
    site_id uuid not null references sites(id) on delete cascade,
    visitor_id text,
    event_name text not null,
    event_id text not null,
    ts timestamptz not null default now(),
    url text,
    value numeric,
    currency text,
    order_id text,
    first_touch jsonb,
    last_touch jsonb,
    user_data jsonb,
    capi_status text not null default 'skipped',
    capi_error text,
    unique (site_id, event_id)
  );
  create index if not exists events_site_ts on events (site_id, ts);
  create index if not exists events_site_name_ts on events (site_id, event_name, ts);
  `
]

export async function migrate() {
  await sql`create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`
  const done = new Set((await sql<{ version: number }[]>`select version from schema_migrations`).map((r) => r.version))
  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (done.has(i + 1)) continue
    await sql.begin(async (tx) => {
      await tx.unsafe(MIGRATIONS[i])
      await tx`insert into schema_migrations (version) values (${i + 1})`
    })
  }
}
