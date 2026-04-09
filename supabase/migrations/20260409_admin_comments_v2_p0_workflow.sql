create table if not exists public.admin_comment_workflows (
    id uuid primary key default gen_random_uuid(),
    site text not null default 'cn',
    entity_type text not null,
    entity_id text not null,
    status text not null default 'pending',
    priority text not null default 'normal',
    assignee_id uuid references auth.users(id) on delete set null,
    assignee_label text,
    tags text[] not null default '{}'::text[],
    note_count integer not null default 0,
    linked_ticket_count integer not null default 0,
    linked_ticket_ids text[] not null default '{}'::text[],
    metadata jsonb not null default '{}'::jsonb,
    resolved_at timestamptz,
    last_activity_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint admin_comment_workflows_site_check check (site in ('cn', 'intl', 'all')),
    constraint admin_comment_workflows_entity_type_check check (entity_type in ('guestbook_message', 'guestbook_comment', 'prompt_comment')),
    constraint admin_comment_workflows_status_check check (status in ('pending', 'in_review', 'escalated', 'resolved', 'ignored')),
    constraint admin_comment_workflows_priority_check check (priority in ('low', 'normal', 'high')),
    constraint admin_comment_workflows_note_count_check check (note_count >= 0),
    constraint admin_comment_workflows_ticket_count_check check (linked_ticket_count >= 0),
    constraint admin_comment_workflows_entity_unique unique (site, entity_type, entity_id)
);

create index if not exists idx_admin_comment_workflows_status
    on public.admin_comment_workflows (status, priority, last_activity_at desc);

create index if not exists idx_admin_comment_workflows_assignee
    on public.admin_comment_workflows (assignee_id, updated_at desc);

create index if not exists idx_admin_comment_workflows_entity_lookup
    on public.admin_comment_workflows (entity_type, entity_id, site);

create index if not exists idx_admin_comment_workflows_tags_gin
    on public.admin_comment_workflows using gin (tags);

create table if not exists public.admin_comment_workflow_notes (
    id uuid primary key default gen_random_uuid(),
    workflow_id uuid not null references public.admin_comment_workflows(id) on delete cascade,
    admin_id uuid references auth.users(id) on delete set null,
    admin_label text,
    note text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_admin_comment_workflow_notes_workflow
    on public.admin_comment_workflow_notes (workflow_id, created_at desc);

create table if not exists public.admin_comment_ticket_links (
    id uuid primary key default gen_random_uuid(),
    workflow_id uuid not null references public.admin_comment_workflows(id) on delete cascade,
    ticket_id uuid not null references public.shop_tickets(id) on delete cascade,
    site text not null default 'cn',
    entity_type text not null,
    entity_id text not null,
    created_by uuid references auth.users(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint admin_comment_ticket_links_site_check check (site in ('cn', 'intl', 'all')),
    constraint admin_comment_ticket_links_entity_type_check check (entity_type in ('guestbook_message', 'guestbook_comment', 'prompt_comment')),
    constraint admin_comment_ticket_links_unique unique (workflow_id, ticket_id)
);

create index if not exists idx_admin_comment_ticket_links_workflow
    on public.admin_comment_ticket_links (workflow_id, created_at desc);

create index if not exists idx_admin_comment_ticket_links_entity
    on public.admin_comment_ticket_links (entity_type, entity_id, site);

create or replace function public.set_admin_comment_workflow_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    if new.last_activity_at is null then
        new.last_activity_at = now();
    end if;
    return new;
end;
$$;

drop trigger if exists trigger_admin_comment_workflows_updated_at on public.admin_comment_workflows;
create trigger trigger_admin_comment_workflows_updated_at
before update on public.admin_comment_workflows
for each row
execute function public.set_admin_comment_workflow_updated_at();

alter table public.admin_comment_workflows enable row level security;
alter table public.admin_comment_workflow_notes enable row level security;
alter table public.admin_comment_ticket_links enable row level security;

drop policy if exists "Admins can view comment workflows" on public.admin_comment_workflows;
create policy "Admins can view comment workflows"
    on public.admin_comment_workflows for select
    using (public.is_admin());

drop policy if exists "Admins can insert comment workflows" on public.admin_comment_workflows;
create policy "Admins can insert comment workflows"
    on public.admin_comment_workflows for insert
    with check (public.is_admin());

drop policy if exists "Admins can update comment workflows" on public.admin_comment_workflows;
create policy "Admins can update comment workflows"
    on public.admin_comment_workflows for update
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "Admins can delete comment workflows" on public.admin_comment_workflows;
create policy "Admins can delete comment workflows"
    on public.admin_comment_workflows for delete
    using (public.is_admin());

drop policy if exists "Admins can view comment workflow notes" on public.admin_comment_workflow_notes;
create policy "Admins can view comment workflow notes"
    on public.admin_comment_workflow_notes for select
    using (public.is_admin());

drop policy if exists "Admins can insert comment workflow notes" on public.admin_comment_workflow_notes;
create policy "Admins can insert comment workflow notes"
    on public.admin_comment_workflow_notes for insert
    with check (public.is_admin());

drop policy if exists "Admins can delete comment workflow notes" on public.admin_comment_workflow_notes;
create policy "Admins can delete comment workflow notes"
    on public.admin_comment_workflow_notes for delete
    using (public.is_admin());

drop policy if exists "Admins can view comment ticket links" on public.admin_comment_ticket_links;
create policy "Admins can view comment ticket links"
    on public.admin_comment_ticket_links for select
    using (public.is_admin());

drop policy if exists "Admins can insert comment ticket links" on public.admin_comment_ticket_links;
create policy "Admins can insert comment ticket links"
    on public.admin_comment_ticket_links for insert
    with check (public.is_admin());

drop policy if exists "Admins can delete comment ticket links" on public.admin_comment_ticket_links;
create policy "Admins can delete comment ticket links"
    on public.admin_comment_ticket_links for delete
    using (public.is_admin());
