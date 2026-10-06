-- Run AFTER schema.sql against LOCAL Supabase, as postgres/database owner:
--   psql "$LOCAL_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests.sql
-- No extensions required. All fixture users/content/helpers disappear on ROLLBACK.
-- A failure aborts the transaction; do not replace the final ROLLBACK with COMMIT.
begin;

create temporary table forum_test_users (label text primary key, id uuid not null default gen_random_uuid());
insert into forum_test_users (label) values ('alice'), ('bob');
insert into forum_test_users (label) select 'voter' || n from generate_series(3, 10) n;
grant select on forum_test_users to anon, authenticated;
create temporary table forum_test_notes (id uuid primary key);
grant select, insert on forum_test_notes to authenticated;

create function pg_temp.assert_true(ok boolean, message text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', message; end if;
end;
$$;
create function pg_temp.expect_error(statement text, states text[] default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if states is not null and not (sqlstate = any(states)) then
      raise exception 'Unexpected SQLSTATE % for %: %', sqlstate, statement, sqlerrm;
    end if;
    return;
  end;
  raise exception 'FAIL: statement unexpectedly succeeded: %', statement;
end;
$$;
create function pg_temp.sign_in(label text)
returns void language plpgsql as $$
declare subject uuid;
begin
  select u.id into strict subject from pg_temp.forum_test_users u where u.label = sign_in.label;
  perform set_config('request.jwt.claim.sub', subject::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, true);
end;
$$;

-- auth trigger must ignore privilege-bearing or forged metadata.
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'forum-test-' || id || '@example.invalid',
  jsonb_build_object('name', label, 'role', 'admin', 'joined', '2000-01-01',
    'bio', 'forged', 'pfp', 'https://evil.invalid/avatar.svg'), now(), now()
from forum_test_users;
select pg_temp.assert_true((select count(*) = 10 from public.profiles p join forum_test_users u using (id)
  where p.role = '' and p.bio = '' and p.pfp = '' and p.joined = now()), 'secure auth profile provisioning');
select pg_temp.assert_true((select count(*) = 5 from public.communities
  where id in ('announcements', 'general', 'help', 'showcase', 'offtopic')), 'five seeded communities');

-- Verify every application table is RLS-enabled and browser roles have NO write
-- privileges, even when a Supabase installation has permissive default grants.
do $$
declare table_name text; role_name text;
begin
  foreach table_name in array array['profiles','communities','threads','replies','thread_votes',
    'reply_votes','saved_threads','polls','poll_options','poll_votes','reports','notifications'] loop
    perform pg_temp.assert_true((select relrowsecurity from pg_class
      where oid = ('public.' || table_name)::regclass), table_name || ' has RLS');
    foreach role_name in array array['anon', 'authenticated'] loop
      perform pg_temp.assert_true(not has_table_privilege(role_name, 'public.' || table_name,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), role_name || ' cannot mutate ' || table_name);
    end loop;
  end loop;
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.forum_apply_changes(jsonb)', 'EXECUTE'),
    'anonymous cannot execute RPC');
  perform pg_temp.assert_true(has_function_privilege('authenticated', 'public.forum_apply_changes(jsonb)', 'EXECUTE'),
    'members can execute RPC');
  perform pg_temp.assert_true(not has_function_privilege('authenticated', 'public.forum_lock_thread(text,boolean)', 'EXECUTE'),
    'members cannot execute private lock helper');
end;
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select pg_temp.assert_true((select count(*) = 10 from public.profiles where id in (select id from pg_temp.forum_test_users)),
  'profiles publicly readable');
select pg_temp.expect_error($q$select public.forum_apply_changes('[]')$q$, array['42501']);
select pg_temp.expect_error($q$insert into public.communities values ('evil', 'Evil', '!', '')$q$, array['42501']);

set local role authenticated;
select pg_temp.expect_error($q$select public.forum_apply_changes('[]')$q$, array['42501']);
select pg_temp.sign_in('alice');
select pg_temp.assert_true(public.forum_apply_changes('[
  {"op":"profile","name":"Alice","bio":"Real profile","pfp":"data:image/png;base64,AAAA"},
  {"op":"thread_create","id":"t_security_test_a","title":"First thread","body":"First body","cat":"general","tags":["one","two"],"poll":{"q":"Choose?","opts":[{"text":"A"},{"text":"B"}]}},
  {"op":"thread_create","id":"t_security_test_other","title":"Other thread","body":"Other body","cat":"help","tags":[],"poll":null},
  {"op":"reply_create","id":"r_security_test_parent","thread_id":"t_security_test_a","parent_id":null,"body":"Parent reply"},
  {"op":"save","id":"t_security_test_a","saved":true},
  {"op":"poll_vote","id":"t_security_test_a","option_index":0},
  {"op":"thread_vote","id":"t_security_test_a","dir":"up"}
]') = '{"applied":7}'::jsonb, 'two threads, reply, profile, saved state and votes committed');
select pg_temp.assert_true((select author_id = auth.uid() and created = now() and not locked and not pinned
  and not featured and not hidden and not deleted from public.threads where id = 't_security_test_a'),
  'author, timestamp and moderation defaults are server-owned');
select pg_temp.assert_true((select count(*) = 2 from public.poll_options where thread_id = 't_security_test_a'), 'poll created atomically');
select pg_temp.assert_true((select count(*) = 0 from public.notifications), 'no self-reply notification');

-- Direct API writes and privileged RPC fields are rejected, not partially ignored.
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, array['42501']);
select pg_temp.expect_error($q$update public.profiles set joined = '2000-01-01' where id = auth.uid()$q$, array['42501']);
select pg_temp.expect_error($q$insert into public.profiles(id,name,role) values(auth.uid(),'Forged','admin')$q$, array['42501']);
select pg_temp.expect_error($q$update public.threads set author_id = auth.uid(), locked = true where id = 't_security_test_a'$q$, array['42501']);
select pg_temp.expect_error($q$insert into public.notifications(user_id,text,href) values(auth.uid(),'Forged','#/')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"profile","name":"Admin","bio":"","pfp":"","role":"admin"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"profile","name":"Admin","bio":"","pfp":"","id":"00000000-0000-0000-0000-000000000000"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_create","id":"t_security_forged","title":"Forged","body":"x","cat":"general","tags":[],"poll":null,"pinned":true}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_create","id":"r_security_forged","thread_id":"t_security_test_a","parent_id":null,"body":"x","created":"2000-01-01"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":"up","user_id":"00000000-0000-0000-0000-000000000000"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_create","id":"t_security_forged","title":"Forged","body":"x","cat":"general","tags":[],"poll":null,"author_id":"00000000-0000-0000-0000-000000000000"}]')$q$, array['22023']);

-- Bob independently votes, replies, saves and reports, without replacing Alice's rows.
select pg_temp.sign_in('bob');
select public.forum_apply_changes('[
  {"op":"reply_create","id":"r_security_test_b","thread_id":"t_security_test_a","parent_id":"r_security_test_parent","body":"Bob replies"},
  {"op":"thread_vote","id":"t_security_test_a","dir":"down"},
  {"op":"reply_vote","id":"r_security_test_parent","dir":"up"},
  {"op":"poll_vote","id":"t_security_test_a","option_index":1},
  {"op":"save","id":"t_security_test_a","saved":true},
  {"op":"report","id":"report_security_test_b","kind":"thread","target_id":"t_security_test_a","reason":"Please review"},
  {"op":"report","id":"report_security_test_reply","kind":"reply","target_id":"r_security_test_parent","reason":"Please review reply"}
]');
select pg_temp.assert_true((select count(*) = 2 from public.thread_votes where thread_id = 't_security_test_a'), 'two independent thread votes');
select pg_temp.assert_true((select count(*) = 2 from public.poll_votes where thread_id = 't_security_test_a'), 'two independent poll votes');
select pg_temp.assert_true((select count(*) = 1 from public.saved_threads where thread_id = 't_security_test_a'), 'only own saved state');
select pg_temp.assert_true((select count(*) = 0 from public.notifications), 'cannot read another inbox');
select pg_temp.assert_true((select count(*) = 2 from public.reports where id like 'report_security_test%'), 'reporter can read own reports');
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_delete","id":"t_security_test_a"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_delete","id":"r_security_test_parent"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"poll_vote","id":"t_security_test_a","option_index":0}]')$q$, array['23505']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_create","id":"r_security_wrong_parent","thread_id":"t_security_test_other","parent_id":"r_security_test_parent","body":"x"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_create","id":"r_security_missing_parent","thread_id":"t_security_test_a","parent_id":"missing","body":"x"}]')$q$, array['42501']);

-- Any bad operation rolls back earlier writes AND their generated notifications.
select pg_temp.expect_error($q$select public.forum_apply_changes('[
  {"op":"reply_create","id":"r_security_rollback","thread_id":"t_security_test_a","parent_id":null,"body":"Must roll back"},
  {"op":"thread_delete","id":"t_security_test_a"}
]')$q$, array['42501']);
select pg_temp.assert_true(not exists (select 1 from public.replies where id = 'r_security_rollback'), 'failed batch rolls back reply');
select pg_temp.expect_error($q$select public.forum_apply_changes('[
  {"op":"profile","name":"Should roll back","bio":"","pfp":""},
  {"op":"unknown"}
]')$q$, array['22023']);
select pg_temp.assert_true((select name = 'bob' from public.profiles where id = auth.uid()), 'failed batch rolls back profile');

select pg_temp.sign_in('alice');
select pg_temp.assert_true((select count(*) = 1 from public.notifications), 'one deduplicated thread/parent notification and no rolled-back notification');
insert into pg_temp.forum_test_notes select id from public.notifications;
select pg_temp.assert_true((select count(*) = 0 from public.reports where id like 'report_security_test%'), 'thread author cannot read other reports');
select public.forum_apply_changes(jsonb_build_array(jsonb_build_object('op', 'notification_read', 'id', (select id from pg_temp.forum_test_notes))));
select pg_temp.assert_true((select bool_and(read) from public.notifications), 'recipient marks own notifications read');
select pg_temp.sign_in('bob');
select pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('op', 'notification_read', 'id', (select id from pg_temp.forum_test_notes)))), array['42501']);

-- Vote changes/removals are per-user; saving true is intentionally idempotent.
select public.forum_apply_changes('[
  {"op":"thread_vote","id":"t_security_test_a","dir":"up"},
  {"op":"reply_vote","id":"r_security_test_parent","dir":"down"},
  {"op":"reply_vote","id":"r_security_test_parent","dir":null},
  {"op":"save","id":"t_security_test_a","saved":true},
  {"op":"save","id":"t_security_test_a","saved":false}
]');
select pg_temp.assert_true((select count(*) = 2 from public.thread_votes where thread_id = 't_security_test_a' and dir = 'up'), 'vote upsert preserves other user');
select pg_temp.assert_true(not exists (select 1 from public.reply_votes where reply_id = 'r_security_test_parent'), 'own reply vote removed');
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_vote","id":"r_security_test_parent","dir":null}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"save","id":"t_security_test_a","saved":false}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_delete","id":"missing"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_delete","id":"missing"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"save","id":"missing","saved":true}]')$q$, array['42501']);

-- Type, shape, bounds and image allow-list checks. Boundary payloads are generated
-- in SQL instead of storing large image/body blobs in this test file.
select pg_temp.expect_error($q$select public.forum_apply_changes(null)$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('{}')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[null]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"profile","name":"Only name"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"profile","name":false,"bio":"","pfp":""}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"save","id":"t_security_test_a","saved":"false"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":"other"}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"poll_vote","id":"t_security_test_a","option_index":0.5}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"poll_vote","id":"t_security_test_a","option_index":4}]')$q$, array['22023']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"report","id":"report_security_bad","kind":"profile","target_id":"x","reason":"x"}]')$q$, array['22023']);

do $$
declare
  payload jsonb;
  bad_value text;
  field text;
begin
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    (select jsonb_agg('{"op":"thread_delete","id":"missing"}'::jsonb) from generate_series(1, 101))), array['22023']);
  foreach bad_value in array array['', repeat('x', 33)] loop
    perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
      jsonb_build_array(jsonb_build_object('op','profile','name',bad_value,'bio','','pfp',''))), array['23514']);
  end loop;
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_build_object('op','profile','name','Bob','bio',repeat('x',181),'pfp',''))), array['23514']);
  foreach bad_value in array array['https://example.invalid/a.png', 'data:image/svg+xml;base64,AAAA',
    'data:text/html;base64,AAAA', 'data:image/png;base64,' || repeat('A', 204800)] loop
    perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
      jsonb_build_array(jsonb_build_object('op','profile','name','Bob','bio','','pfp',bad_value))), array['23514']);
  end loop;
  payload := '{"op":"thread_create","id":"t_security_bounds","title":"Valid","body":"Valid","cat":"general","tags":[],"poll":null}';
  foreach field in array array['title','body'] loop
    perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
      jsonb_build_array(jsonb_set(payload, array[field], to_jsonb(''::text)))), array['23514']);
    perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
      jsonb_build_array(jsonb_set(payload, array[field], to_jsonb(repeat('x', case field when 'title' then 141 else 50001 end))))), array['23514']);
  end loop;
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_set(payload, '{tags}', '["a","b","c","d","e"]'))), array['23514']);
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_set(payload, '{tags}', jsonb_build_array(repeat('x',33))))), array['23514']);
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_set(payload, '{tags}', '[null]'))), array['22023']);
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_set(payload, '{poll}', '{"q":"Question","opts":[{"text":"One"}]}'))), array['22023']);
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_set(payload, '{poll}', jsonb_build_object('q',repeat('q',121),'opts','[{"text":"A"},{"text":"B"}]'::jsonb)))), array['23514']);
  perform pg_temp.expect_error(format('select public.forum_apply_changes(%L::jsonb)',
    jsonb_build_array(jsonb_set(payload, '{poll}', jsonb_build_object('q','Question','opts',jsonb_build_array(jsonb_build_object('text',repeat('x',61)),jsonb_build_object('text','B')))))), array['23514']);
  perform pg_temp.assert_true(not exists (select 1 from public.threads where id = 't_security_bounds'), 'bad poll rolls back thread too');
end;
$$;

-- Test milestone with eight more real auth fixtures. No fake identities are seeded
-- by schema.sql; these fixtures exist only inside this rollback-only transaction.
do $$
declare n integer;
begin
  for n in 3..10 loop
    perform pg_temp.sign_in('voter' || n);
    perform public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":"up"}]');
  end loop;
end;
$$;
select pg_temp.sign_in('alice');
select pg_temp.assert_true((select count(*) = 1 from public.notifications where text like '%+10 karma%'), 'one server-side vote milestone');
select pg_temp.sign_in('voter10');
select public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":"up"}]');
select pg_temp.sign_in('alice');
select pg_temp.assert_true((select count(*) = 1 from public.notifications where text like '%+10 karma%'), 'idempotent upvote does not notify twice');

-- Staff permissions come only from trusted SQL; staff may read reports but still
-- cannot mutate role/flags using the browser. Dashboard changes are supported.
reset role;
update public.profiles set role = 'mod' where id = (select id from pg_temp.forum_test_users where label = 'alice');
update public.threads set locked = true where id = 't_security_test_a';
set local role authenticated;
select pg_temp.sign_in('alice');
select pg_temp.assert_true((select count(*) = 2 from public.reports where id like 'report_security_test%'), 'staff can read reports');
select pg_temp.expect_error($q$update public.profiles set role = 'admin' where id = auth.uid()$q$, array['42501']);
select pg_temp.sign_in('bob');
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_create","id":"r_security_locked","thread_id":"t_security_test_a","parent_id":null,"body":"x"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":"up"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":null}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_vote","id":"r_security_test_parent","dir":"up"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"poll_vote","id":"t_security_test_a","option_index":0}]')$q$, array['42501']);

-- Hidden and deleted content also hides related votes/polls from public readers.
reset role;
update public.threads set locked = false, hidden = true where id = 't_security_test_a';
set local role anon;
select pg_temp.assert_true(not exists (select 1 from public.threads where id = 't_security_test_a'), 'hidden thread unreadable');
select pg_temp.assert_true(not exists (select 1 from public.replies where thread_id = 't_security_test_a'), 'hidden thread replies unreadable');
select pg_temp.assert_true(not exists (select 1 from public.thread_votes where thread_id = 't_security_test_a'), 'hidden thread votes unreadable');
select pg_temp.assert_true(not exists (select 1 from public.polls where thread_id = 't_security_test_a'), 'hidden polls unreadable');
select pg_temp.assert_true(not exists (select 1 from public.poll_options where thread_id = 't_security_test_a'), 'hidden options unreadable');
select pg_temp.assert_true(not exists (select 1 from public.poll_votes where thread_id = 't_security_test_a'), 'hidden poll votes unreadable');
select pg_temp.assert_true(not exists (select 1 from public.saved_threads), 'anonymous cannot read saved rows even with an old subject claim');
select pg_temp.assert_true(not exists (select 1 from public.notifications), 'anonymous cannot read notifications');
select pg_temp.assert_true(not exists (select 1 from public.reports), 'anonymous cannot read reports');
set local role authenticated;
select pg_temp.sign_in('bob');
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"thread_vote","id":"t_security_test_a","dir":"up"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_create","id":"r_security_hidden","thread_id":"t_security_test_a","parent_id":null,"body":"x"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"save","id":"t_security_test_a","saved":true}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"report","id":"report_security_hidden","kind":"reply","target_id":"r_security_test_parent","reason":"x"}]')$q$, array['42501']);
select pg_temp.sign_in('alice');
select public.forum_apply_changes('[{"op":"save","id":"t_security_test_a","saved":false}]');

reset role;
update public.threads set hidden = false, deleted = true where id = 't_security_test_a';
set local role anon;
select pg_temp.assert_true(not exists (select 1 from public.threads where id = 't_security_test_a'), 'deleted thread unreadable');
reset role;
update public.threads set deleted = false where id = 't_security_test_a';
update public.replies set hidden = true where id = 'r_security_test_parent';
-- Also verify the same-thread FK protects trusted direct writes, independent of RPC.
select pg_temp.expect_error(format('insert into public.replies(id,thread_id,parent_id,author_id,body) values (%L,%L,%L,%L,%L)',
  'r_security_fk', 't_security_test_other', 'r_security_test_parent', (select id from pg_temp.forum_test_users where label = 'bob'), 'x'), array['23503']);
set local role authenticated;
select pg_temp.sign_in('bob');
select pg_temp.assert_true(not exists (select 1 from public.replies where id = 'r_security_test_parent'), 'hidden reply unreadable');
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_vote","id":"r_security_test_parent","dir":"up"}]')$q$, array['42501']);
select pg_temp.expect_error($q$select public.forum_apply_changes('[{"op":"reply_create","id":"r_security_hidden_parent","thread_id":"t_security_test_a","parent_id":"r_security_test_parent","body":"x"}]')$q$, array['42501']);

-- Owner deletions work, including hidden replies. Children by other users survive
-- parent removal; deleting a thread cascades all its dependent rows.
select pg_temp.sign_in('alice');
select public.forum_apply_changes('[{"op":"reply_delete","id":"r_security_test_parent"}]');
select pg_temp.assert_true((select parent_id is null from public.replies where id = 'r_security_test_b'), 'deleting parent preserves child as root');
select pg_temp.sign_in('bob');
select public.forum_apply_changes('[{"op":"reply_delete","id":"r_security_test_b"},{"op":"thread_vote","id":"t_security_test_a","dir":null}]');
select pg_temp.assert_true((select count(*) = 9 from public.thread_votes where thread_id = 't_security_test_a'), 'removing own thread vote preserves others');
select pg_temp.sign_in('alice');
select public.forum_apply_changes('[{"op":"thread_delete","id":"t_security_test_a"},{"op":"thread_delete","id":"t_security_test_other"}]');
reset role;
select pg_temp.assert_true(not exists (select 1 from public.threads where id in ('t_security_test_a','t_security_test_other')), 'owned threads deleted');
select pg_temp.assert_true(not exists (select 1 from public.replies where thread_id = 't_security_test_a'), 'replies cascaded');
select pg_temp.assert_true(not exists (select 1 from public.thread_votes where thread_id = 't_security_test_a'), 'votes cascaded');
select pg_temp.assert_true(not exists (select 1 from public.polls where thread_id = 't_security_test_a'), 'poll cascaded');
select pg_temp.assert_true(not exists (select 1 from public.poll_options where thread_id = 't_security_test_a'), 'poll options cascaded');
select pg_temp.assert_true(not exists (select 1 from public.poll_votes where thread_id = 't_security_test_a'), 'poll votes cascaded');
select pg_temp.assert_true(not exists (select 1 from public.saved_threads where thread_id = 't_security_test_a'), 'saved rows cascaded');
select pg_temp.assert_true(not exists (select 1 from public.reports where id like 'report_security_test%'), 'target reports cascaded');

select 'All forum schema/security tests passed; rolling back every fixture.' as result;
rollback;
