-- Enable the pg_cron extension
create extension if not exists pg_cron;

-- Create a function to maintain the message limit
create or replace function maintain_chat_message_limit()
returns void as $$
declare
  limit_count int := 10000;
  deleted_count int;
begin
  -- Delete messages older than the Nth newest message
  with deleted_rows as (
    delete from chat_messages
    where id in (
      select id from chat_messages
      order by created_at desc
      offset limit_count
    )
    returning id
  )
  select count(*) into deleted_count from deleted_rows;
  
  -- Log the result (optional, requires a log table or just raise notice)
  raise notice 'Cleaned up % messages keeping the latest %', deleted_count, limit_count;
end;
$$ language plpgsql;

-- Schedule the job to run daily at 4:00 AM UTC
-- The job name is 'cleanup_chat_messages'
select cron.schedule(
  'cleanup_chat_messages',
  '0 4 * * *', -- At 04:00
  'select maintain_chat_message_limit()'
);

-- To check scheduled jobs:
-- select * from cron.job;

-- To manually run the cleanup now:
-- select maintain_chat_message_limit();
