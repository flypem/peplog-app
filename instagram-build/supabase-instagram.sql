-- Instagram credentials storage — a single row holding the long-lived token.
-- Run this in Supabase SQL Editor.

create table if not exists instagram_credentials (
  id int primary key default 1,
  ig_user_id text,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

-- RLS enabled with NO policies for regular users — this table is only ever
-- touched via the service-role key inside serverless functions, never from
-- the browser. Same protective pattern as the `profiles.plan` column.
alter table instagram_credentials enable row level security;
