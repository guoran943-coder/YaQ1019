-- Text-only temporary room chat MVP.
-- Run this file in Supabase SQL Editor before testing locally.

create extension if not exists pgcrypto;

drop table if exists public.messages cascade;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  nickname text not null,
  content text not null,
  type text not null default 'text',
  file_url text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  constraint messages_room_id_check check (char_length(btrim(room_id)) > 0),
  constraint messages_nickname_check check (char_length(btrim(nickname)) between 1 and 32),
  constraint messages_content_check check (char_length(btrim(content)) between 1 and 1000),
  constraint messages_type_check check (type in ('text', 'image', 'audio', 'video'))
);

create index messages_room_created_at_idx
on public.messages (room_id, created_at);

create index messages_expires_at_idx
on public.messages (expires_at);

alter table public.messages enable row level security;

drop policy if exists "Anon can read messages" on public.messages;
create policy "Anon can read messages"
on public.messages
for select
to anon
using (expires_at > now());

drop policy if exists "Anon can insert messages" on public.messages;
create policy "Anon can insert messages"
on public.messages
for insert
to anon
with check (
  expires_at > now()
  and type = 'text'
  and file_url is null
  and char_length(btrim(room_id)) > 0
  and char_length(btrim(nickname)) between 1 and 32
  and char_length(btrim(content)) between 1 and 1000
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
