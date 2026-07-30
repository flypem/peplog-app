-- PepLog database schema
-- Run this once in Supabase → SQL Editor → New Query → paste → Run.

-- 1. Generic key/value store for app data (vials, dose log, custom sites).
--    Users can freely read/write their own rows — this is fine, since
--    nothing here controls billing/entitlement.
create table if not exists kv_store (
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table kv_store enable row level security;

create policy "Users manage their own kv rows"
  on kv_store
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Profiles: holds the subscription plan and Stripe identifiers.
--    Users may READ their own row, but may NOT write plan/stripe_* columns
--    themselves — only the webhook (using the service-role key, which
--    bypasses RLS entirely) is allowed to set those. This is what stops
--    someone from opening devtools and granting themselves Pro for free.
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can read their own profile"
  on profiles
  for select
  using (auth.uid() = user_id);

-- Users may insert their OWN profile row (needed the first time they sign
-- in, before any Stripe activity exists) but the insert can only ever set
-- plan to 'free' — never 'pro' — so this can't be used to self-upgrade.
create policy "Users can create their own free profile"
  on profiles
  for insert
  with check (auth.uid() = user_id and plan = 'free');

-- Intentionally: no UPDATE policy for regular users. Only the service-role
-- key (used exclusively in api/stripe-webhook.js) can update plan/stripe_*.
