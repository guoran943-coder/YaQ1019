-- Non-destructive cleanup setup for temporary chat messages.
-- Run this after deploying the cleanup-expired-messages Edge Function.
--
-- Replace these placeholders before running:
--   PROJECT_REF     -> enzqqzyltthgnosmknld
--   CLEANUP_SECRET  -> the same value you set as the Edge Function CLEANUP_SECRET

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('cleanup-expired-chat-messages')
where exists (
  select 1
  from cron.job
  where jobname = 'cleanup-expired-chat-messages'
);

select cron.schedule(
  'cleanup-expired-chat-messages',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.functions.supabase.co/cleanup-expired-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer CLEANUP_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
