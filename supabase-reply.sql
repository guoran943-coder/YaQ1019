-- Add reply snapshot fields for quoted message replies.
-- Safe to run multiple times in Supabase SQL Editor.

alter table public.messages
add column if not exists reply_to_id uuid,
add column if not exists reply_to_content text,
add column if not exists reply_to_type text,
add column if not exists reply_to_sender text;
