-- Migration: adds cancellation-status visibility.
-- Run this in Supabase SQL Editor (separate from the original schema.sql,
-- since that table already exists).
--
-- NOTE: if you're setting this project up fresh, your database already
-- needs schema.sql run first before this migration will work.

alter table profiles add column if not exists cancel_at_period_end boolean not null default false;
alter table profiles add column if not exists current_period_end timestamptz;
