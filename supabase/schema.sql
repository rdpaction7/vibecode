-- Apply once, as the database owner, to a fresh Supabase project (PostgreSQL 15+).
-- Existing auth users are backfilled; no demo identities or content are created.
-- Browser roles have SELECT only. ALL mutations go through the checked, atomic RPC.
-- Moderation/role changes are deliberately server-only (SQL Dashboard/service role).
begin;

create function public.forum_valid_tags(value text[])
returns boolean language sql immutable set search_path = '' as $$
  select value is not null
    and cardinality(value) <= 4
    and (cardinality(value) = 0 or array_ndims(value) = 1)
    and not exists (
      select 1 from unnest(value) as tag
      where tag is null or char_length(btrim(tag)) < 1 or char_length(tag) > 32
    );
$$;
revoke all on function public.forum_valid_tags(text[]) from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) >= 1 and char_length(name) <= 32),
  bio text not null default '' check (char_length(bio) <= 180),
  pfp text not null default '' check (
    octet_length(pfp) <= 204800 and
    (pfp = '' or pfp ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$')
  ),
  joined timestamptz not null default now(),
  role text not null default '' check (role in ('', 'mod', 'admin'))
);

create table public.communities (
  id text primary key,
  name text not null,
  icon text not null,
  description text not null
);
insert into public.communities (id, name, icon, description) values
  ('announcements', 'Announcements', '📢', 'News and updates from the team'),
  ('general', 'General', '💬', 'Anything worth talking about'),
  ('help', 'Help & Support', '🛠️', 'Ask questions, get unstuck'),
  ('showcase', 'Show & Tell', '🎨', 'Share what you built'),
  ('offtopic', 'Off-Topic', '🎲', 'The chill corner');

create table public.threads (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) >= 1 and char_length(title) <= 140),
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 50000),
  cat text not null references public.communities(id),
  tags text[] not null default '{}' check (public.forum_valid_tags(tags)),
  created timestamptz not null default now(),
  locked boolean not null default false,
  pinned boolean not null default false,
  featured boolean not null default false,
  hidden boolean not null default false,
  deleted boolean not null default false
);

create table public.replies (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  thread_id text not null references public.threads(id) on delete cascade,
  parent_id text,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 50000),
  created timestamptz not null default now(),
  hidden boolean not null default false,
  deleted boolean not null default false,
  unique (id, thread_id),
  check (parent_id is null or parent_id <> id),
  -- Deleting a parent keeps other members' replies and moves them to the root.
  foreign key (parent_id, thread_id) references public.replies(id, thread_id)
    on delete set null (parent_id)
);

create table public.thread_votes (
  thread_id text not null references public.threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dir text not null check (dir in ('up', 'down')),
  primary key (thread_id, user_id)
);
create table public.reply_votes (
  reply_id text not null references public.replies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dir text not null check (dir in ('up', 'down')),
  primary key (reply_id, user_id)
);
create table public.saved_threads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id text not null references public.threads(id) on delete cascade,
  primary key (user_id, thread_id)
);
create table public.polls (
  thread_id text primary key references public.threads(id) on delete cascade,
  question text not null check (char_length(btrim(question)) >= 1 and char_length(question) <= 120)
);
create table public.poll_options (
  thread_id text not null references public.polls(thread_id) on delete cascade,
  option_index integer not null check (option_index between 0 and 3),
  text text not null check (char_length(btrim(text)) >= 1 and char_length(text) <= 60),
  primary key (thread_id, option_index)
);
create table public.poll_votes (
  thread_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_index integer not null,
  primary key (thread_id, user_id),
  foreign key (thread_id, option_index)
    references public.poll_options(thread_id, option_index) on delete cascade
);
create table public.reports (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  thread_id text references public.threads(id) on delete cascade,
  reply_id text references public.replies(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) >= 1 and char_length(reason) <= 500),
  created timestamptz not null default now(),
  check (num_nonnulls(thread_id, reply_id) = 1)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  href text not null,
  created timestamptz not null default now(),
  read boolean not null default false
);

create index threads_author_idx on public.threads(author_id);
create index threads_feed_idx on public.threads(created desc) where not hidden and not deleted;
create index replies_thread_idx on public.replies(thread_id, created);
create index replies_parent_idx on public.replies(parent_id, thread_id);
create index replies_author_idx on public.replies(author_id);
create index thread_votes_user_idx on public.thread_votes(user_id);
create index reply_votes_user_idx on public.reply_votes(user_id);
create index saved_threads_thread_idx on public.saved_threads(thread_id);
create index poll_votes_user_idx on public.poll_votes(user_id);
create index reports_reporter_idx on public.reports(reporter_id);
create index reports_thread_idx on public.reports(thread_id);
create index reports_reply_idx on public.reports(reply_id);
create index notifications_inbox_idx on public.notifications(user_id, created desc);

-- Read policies form an acyclic dependency graph (profiles/threads -> replies -> votes).
-- Owners/staff do not bypass hidden/deleted visibility in the browser; Dashboard can.
alter table public.profiles enable row level security;
alter table public.communities enable row level security;
alter table public.threads enable row level security;
alter table public.replies enable row level security;
alter table public.thread_votes enable row level security;
alter table public.reply_votes enable row level security;
alter table public.saved_threads enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;

create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy communities_read on public.communities for select to anon, authenticated using (true);
create policy threads_read on public.threads for select to anon, authenticated
  using (not hidden and not deleted);
create policy replies_read on public.replies for select to anon, authenticated using (
  not hidden and not deleted and exists (select 1 from public.threads t where t.id = thread_id)
);
create policy thread_votes_read on public.thread_votes for select to anon, authenticated
  using (exists (select 1 from public.threads t where t.id = thread_id));
create policy reply_votes_read on public.reply_votes for select to anon, authenticated
  using (exists (select 1 from public.replies r where r.id = reply_id));
create policy polls_read on public.polls for select to anon, authenticated
  using (exists (select 1 from public.threads t where t.id = thread_id));
create policy poll_options_read on public.poll_options for select to anon, authenticated
  using (exists (select 1 from public.threads t where t.id = thread_id));
create policy poll_votes_read on public.poll_votes for select to anon, authenticated
  using (exists (select 1 from public.threads t where t.id = thread_id));
create policy saved_threads_read on public.saved_threads for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy reports_read on public.reports for select to authenticated using (
  reporter_id = (select auth.uid()) or exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('mod', 'admin')
  )
);

revoke all on table public.profiles, public.communities, public.threads, public.replies,
  public.thread_votes, public.reply_votes, public.saved_threads, public.polls,
  public.poll_options, public.poll_votes, public.reports, public.notifications
  from public, anon, authenticated;
grant select on table public.profiles, public.communities, public.threads, public.replies,
  public.thread_votes, public.reply_votes, public.saved_threads, public.polls,
  public.poll_options, public.poll_votes, public.reports, public.notifications to anon, authenticated;
grant all on table public.profiles, public.communities, public.threads, public.replies,
  public.thread_votes, public.reply_votes, public.saved_threads, public.polls,
  public.poll_options, public.poll_votes, public.reports, public.notifications to service_role;

-- Never trust metadata for role, joined, ID, bio or image. Names are bounded and
-- blank/invalid metadata gets a safe default. No email is exposed in public profiles.
create function public.forum_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'name'), 32), ''), 'Member'));
  return new;
end;
$$;
revoke all on function public.forum_create_profile() from public, anon, authenticated;
create trigger forum_auth_user_created after insert on auth.users
  for each row execute function public.forum_create_profile();
insert into public.profiles (id, name)
select id, coalesce(nullif(left(btrim(raw_user_meta_data ->> 'name'), 32), ''), 'Member')
from auth.users on conflict (id) do nothing;

create function public.forum_notify_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target public.threads%rowtype;
  sender_name text;
begin
  select * into target from public.threads where id = new.thread_id;
  if target.id is null or target.hidden or target.deleted or new.hidden or new.deleted then
    return new;
  end if;
  select name into sender_name from public.profiles where id = new.author_id;
  insert into public.notifications (user_id, text, href)
  select recipient, sender_name || ' replied to “' || left(target.title, 40) || '”', '#/t/' || target.id
  from (
    select target.author_id as recipient
    union
    select author_id from public.replies
      where id = new.parent_id and thread_id = new.thread_id and not hidden and not deleted
  ) recipients
  where recipient <> new.author_id;
  return new;
end;
$$;
revoke all on function public.forum_notify_reply() from public, anon, authenticated;
create trigger forum_reply_notification after insert on public.replies
  for each row execute function public.forum_notify_reply();

-- The RPC locks the thread BEFORE changing a vote. This trigger also locks it for
-- trusted server writes. A crossing from <10 to >=10 emits one notification, not
-- one per voter or refresh; recrossing after a drop can notify again, as in the UI.
create function public.forum_notify_vote()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  thread_key text;
  voter uuid;
  delta integer;
  total bigint;
  target public.threads%rowtype;
begin
  if tg_op = 'DELETE' then
    thread_key := old.thread_id;
    voter := old.user_id;
    delta := case old.dir when 'up' then -1 else 1 end;
  else
    thread_key := new.thread_id;
    voter := new.user_id;
    delta := case new.dir when 'up' then 1 else -1 end;
    if tg_op = 'UPDATE' then
      delta := delta - case old.dir when 'up' then 1 else -1 end;
    end if;
  end if;
  select * into target from public.threads where id = thread_key for update;
  if target.id is null or target.hidden or target.deleted then return null; end if;
  select coalesce(sum(case dir when 'up' then 1 else -1 end), 0)
    into total from public.thread_votes where thread_id = thread_key;
  if total >= 10 and total - delta < 10 and voter <> target.author_id then
    insert into public.notifications (user_id, text, href)
    values (target.author_id, '“' || left(target.title, 40) || '” just passed +10 karma 🎉', '#/t/' || thread_key);
  end if;
  return null;
end;
$$;
revoke all on function public.forum_notify_vote() from public, anon, authenticated;
create trigger forum_vote_notification after insert or update or delete on public.thread_votes
  for each row execute function public.forum_notify_vote();

-- Private implementation helpers: they are not executable by browser roles.
-- spec maps every REQUIRED key to JSON type(s), e.g. {"parent_id":"string|null"}.
create function public.forum_expect(payload jsonb, spec jsonb)
returns void language plpgsql set search_path = '' as $$
declare field record;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'Expected an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(payload) k where not (spec ? k)) then
    raise exception 'Unexpected operation field' using errcode = '22023';
  end if;
  for field in select * from jsonb_each_text(spec) loop
    if not (payload ? field.key) or not (jsonb_typeof(payload -> field.key) = any(string_to_array(field.value, '|'))) then
      raise exception 'Missing or invalid field: %', field.key using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function public.forum_expect(jsonb, jsonb) from public, anon, authenticated;

create function public.forum_lock_thread(thread_key text, require_unlocked boolean)
returns void language plpgsql set search_path = '' as $$
declare target public.threads%rowtype;
begin
  select * into target from public.threads where id = thread_key for update;
  if target.id is null or target.hidden or target.deleted then
    raise exception 'Thread not available' using errcode = '42501';
  end if;
  if require_unlocked and target.locked then
    raise exception 'Thread is locked' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.forum_lock_thread(text, boolean) from public, anon, authenticated;

-- Contract: exact operation shapes, zero-based poll option_index, UUID note IDs.
-- Returns {"applied":N}. A raised error aborts the entire call (including triggers).
-- SECURITY DEFINER is necessary because clients have NO table mutation grants.
-- Identity always comes from auth.uid(), never JSON. All paths check authorization;
-- no dynamic SQL, caller search_path, metadata roles, or client timestamps are used.
create function public.forum_apply_changes(changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  change jsonb;
  operation text;
  item_id text;
  thread_key text;
  tag_list text[];
  poll jsonb;
  option_value jsonb;
  option_number integer;
  affected integer;
begin
  if actor is null or not exists (select 1 from public.profiles where id = actor) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' then
    raise exception 'changes must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(changes) > 100 then
    raise exception 'At most 100 changes are allowed' using errcode = '22023';
  end if;

  for change in select value from jsonb_array_elements(changes) loop
    if jsonb_typeof(change) is distinct from 'object' or jsonb_typeof(change -> 'op') is distinct from 'string' then
      raise exception 'Each change must have an op string' using errcode = '22023';
    end if;
    operation := change ->> 'op';
    item_id := change ->> 'id';
    case operation
    when 'profile' then
      perform public.forum_expect(change, '{"op":"string","name":"string","bio":"string","pfp":"string"}');
      update public.profiles set name = change ->> 'name', bio = change ->> 'bio', pfp = change ->> 'pfp'
        where id = actor;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Profile not available' using errcode = '42501'; end if;

    when 'thread_create' then
      perform public.forum_expect(change, '{"op":"string","id":"string","title":"string","body":"string","cat":"string","tags":"array","poll":"object|null"}');
      if exists (select 1 from jsonb_array_elements(change -> 'tags') t where jsonb_typeof(t) <> 'string') then
        raise exception 'Tags must be strings' using errcode = '22023';
      end if;
      select coalesce(array_agg(value order by ord), '{}'::text[]) into tag_list
        from jsonb_array_elements_text(change -> 'tags') with ordinality t(value, ord);
      insert into public.threads (id, author_id, title, body, cat, tags)
        values (item_id, actor, change ->> 'title', change ->> 'body', change ->> 'cat', tag_list);
      poll := change -> 'poll';
      if poll <> 'null'::jsonb then
        perform public.forum_expect(poll, '{"q":"string","opts":"array"}');
        if jsonb_array_length(poll -> 'opts') not between 2 and 4 then
          raise exception 'A poll needs 2 to 4 options' using errcode = '22023';
        end if;
        insert into public.polls (thread_id, question) values (item_id, poll ->> 'q');
        option_number := 0;
        for option_value in select value from jsonb_array_elements(poll -> 'opts') loop
          perform public.forum_expect(option_value, '{"text":"string"}');
          insert into public.poll_options (thread_id, option_index, text)
            values (item_id, option_number, option_value ->> 'text');
          option_number := option_number + 1;
        end loop;
      end if;

    when 'thread_delete' then
      perform public.forum_expect(change, '{"op":"string","id":"string"}');
      -- Owners may also remove their own locked/hidden content.
      delete from public.threads where id = item_id and author_id = actor;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Thread not owned or not found' using errcode = '42501'; end if;

    when 'reply_create' then
      perform public.forum_expect(change, '{"op":"string","id":"string","thread_id":"string","parent_id":"string|null","body":"string"}');
      thread_key := change ->> 'thread_id';
      perform public.forum_lock_thread(thread_key, true);
      if change ->> 'parent_id' is not null and not exists (
        select 1 from public.replies where id = change ->> 'parent_id'
          and thread_id = thread_key and not hidden and not deleted
      ) then
        raise exception 'Parent reply not available in this thread' using errcode = '42501';
      end if;
      insert into public.replies (id, thread_id, parent_id, author_id, body)
        values (item_id, thread_key, change ->> 'parent_id', actor, change ->> 'body');

    when 'reply_delete' then
      perform public.forum_expect(change, '{"op":"string","id":"string"}');
      select thread_id into thread_key from public.replies where id = item_id and author_id = actor;
      if not found then raise exception 'Reply not owned or not found' using errcode = '42501'; end if;
      -- Same lock ordering as votes/replies, but deletion does not require visibility.
      perform 1 from public.threads where id = thread_key for update;
      delete from public.replies where id = item_id and author_id = actor;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Reply not owned or not found' using errcode = '42501'; end if;

    when 'thread_vote', 'reply_vote' then
      perform public.forum_expect(change, '{"op":"string","id":"string","dir":"string|null"}');
      if change ->> 'dir' is not null and change ->> 'dir' not in ('up', 'down') then
        raise exception 'Invalid vote direction' using errcode = '22023';
      end if;
      if operation = 'thread_vote' then
        thread_key := item_id;
      else
        select thread_id into thread_key from public.replies where id = item_id and not hidden and not deleted;
        if not found then raise exception 'Reply not available' using errcode = '42501'; end if;
      end if;
      perform public.forum_lock_thread(thread_key, true);
      -- Recheck after the thread lock to handle a concurrent reply deletion.
      if operation = 'reply_vote' and not exists (
        select 1 from public.replies where id = item_id and thread_id = thread_key and not hidden and not deleted
      ) then raise exception 'Reply not available' using errcode = '42501'; end if;
      if operation = 'thread_vote' then
        if change ->> 'dir' is null then
          delete from public.thread_votes where thread_id = item_id and user_id = actor;
          get diagnostics affected = row_count;
          if affected <> 1 then raise exception 'Vote not found' using errcode = '42501'; end if;
        else
          insert into public.thread_votes (thread_id, user_id, dir) values (item_id, actor, change ->> 'dir')
            on conflict (thread_id, user_id) do update set dir = excluded.dir;
        end if;
      else
        if change ->> 'dir' is null then
          delete from public.reply_votes where reply_id = item_id and user_id = actor;
          get diagnostics affected = row_count;
          if affected <> 1 then raise exception 'Vote not found' using errcode = '42501'; end if;
        else
          insert into public.reply_votes (reply_id, user_id, dir) values (item_id, actor, change ->> 'dir')
            on conflict (reply_id, user_id) do update set dir = excluded.dir;
        end if;
      end if;

    when 'save' then
      perform public.forum_expect(change, '{"op":"string","id":"string","saved":"boolean"}');
      if (change ->> 'saved')::boolean then
        perform public.forum_lock_thread(item_id, false);
        insert into public.saved_threads (user_id, thread_id) values (actor, item_id)
          on conflict (user_id, thread_id) do nothing;
      else
        -- A member can unsave a thread even after staff hide it.
        delete from public.saved_threads where user_id = actor and thread_id = item_id;
        get diagnostics affected = row_count;
        if affected <> 1 then raise exception 'Saved thread not found' using errcode = '42501'; end if;
      end if;

    when 'poll_vote' then
      perform public.forum_expect(change, '{"op":"string","id":"string","option_index":"number"}');
      if (change ->> 'option_index')::numeric not between 0 and 3 or
        (change ->> 'option_index')::numeric <> trunc((change ->> 'option_index')::numeric) then
        raise exception 'Invalid poll option index' using errcode = '22023';
      end if;
      option_number := (change ->> 'option_index')::numeric::integer;
      perform public.forum_lock_thread(item_id, true);
      -- The PK intentionally rejects a second vote; no update/overwrite operation.
      insert into public.poll_votes (thread_id, user_id, option_index) values (item_id, actor, option_number);

    when 'report' then
      perform public.forum_expect(change, '{"op":"string","id":"string","kind":"string","target_id":"string","reason":"string"}');
      if change ->> 'kind' = 'thread' then
        perform public.forum_lock_thread(change ->> 'target_id', false);
        insert into public.reports (id, reporter_id, thread_id, reason)
          values (item_id, actor, change ->> 'target_id', change ->> 'reason');
      elsif change ->> 'kind' = 'reply' then
        select thread_id into thread_key from public.replies
          where id = change ->> 'target_id' and not hidden and not deleted;
        if not found then raise exception 'Reply not available' using errcode = '42501'; end if;
        perform public.forum_lock_thread(thread_key, false);
        if not exists (select 1 from public.replies where id = change ->> 'target_id'
          and thread_id = thread_key and not hidden and not deleted) then
          raise exception 'Reply not available' using errcode = '42501';
        end if;
        insert into public.reports (id, reporter_id, reply_id, reason)
          values (item_id, actor, change ->> 'target_id', change ->> 'reason');
      else
        raise exception 'Invalid report kind' using errcode = '22023';
      end if;

    when 'notification_read' then
      perform public.forum_expect(change, '{"op":"string","id":"string"}');
      update public.notifications set read = true where id = item_id::uuid and user_id = actor;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Notification not owned or not found' using errcode = '42501'; end if;

    else
      raise exception 'Unknown operation: %', operation using errcode = '22023';
    end case;
  end loop;
  return jsonb_build_object('applied', jsonb_array_length(changes));
end;
$$;
revoke all on function public.forum_apply_changes(jsonb) from public, anon, authenticated;
grant execute on function public.forum_apply_changes(jsonb) to authenticated;

-- Needed for trusted service-role inserts that evaluate the tags CHECK.
grant execute on function public.forum_valid_tags(text[]) to service_role;
-- Not granted: community creation, content editing, role changes, moderation flags,
-- arbitrary notification inserts, or any client-supplied author/created fields.
notify pgrst, 'reload schema';
commit;
