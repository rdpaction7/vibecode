# Moderation console commands

Open the console with the **`>_` button** in the top bar or **Ctrl + `** (Cmd + ` on macOS). Sign in with an administrator account to run commands.

The console now has **101 commands: the original 51 plus 50 additions**. Use `/help` or `/commands` for the complete, live list. `/help Users` filters by group; `/findcommand tag` searches names, usages, groups, and descriptions. Up/Down recalls commands entered during this page session.

## Quick start

```text
/users sam
/userinfo "Sam Okafor"
/threads help
/threadinfo t_example
/retitle t_example "A clearer question about aliases"
/settags t_example bash,help
/report t_example "Possible duplicate; needs review"
/reports t_example
/status
/activity 7d
```

Replace example IDs with those shown by `/users`, `/threads`, and `/comments <thread_id>`. User commands accept IDs or names; quoting multi-word user and board names is recommended. Unique user-name fragments and unique thread/comment ID prefixes also work.

## The 50 new commands

### Console — 6

| Command | Purpose |
| --- | --- |
| `/clear` | Clear console output; keep session history and the audit log. |
| `/history` | Show commands entered in this console session, newest first. |
| `/whoami` | Show your current profile ID, name, role, and restrictions. |
| `/findcommand <query>` | Find commands by name, usage, description, or group. |
| `/go <thread_id>` | Open a thread and close the console. Restore deleted threads first. |
| `/search <query>` | Open the discussion feed with a search filter. |

### Users — 14

| Command | Purpose |
| --- | --- |
| `/users [query]` | List IDs, names, roles, and restrictions; optionally filter by ID/name. |
| `/userinfo <user>` | Inspect a profile, warnings, restrictions, and contribution counts. |
| `/staff` | List administrators and moderators. |
| `/bannedusers` | List active permanent bans, temporary bans, and suspensions. |
| `/mutedusers` | List muffled accounts. |
| `/unmuffle <user>` | Remove a posting mute without toggling it back on or lifting other holds. |
| `/unverify <user>` | Remove the verified badge. |
| `/clearrank <user>` | Remove a custom profile title. |
| `/renameuser <user> <name>` | Set a unique display name, 2–32 characters; leave sign-in credentials alone. |
| `/setbio <user> <text>` | Replace a profile bio, up to 180 characters. |
| `/clearavatar <user>` | Remove an uploaded picture or emoji avatar. |
| `/userposts <user>` | List the user's threads, including hidden/deleted ones. |
| `/usercomments <user>` | List the user's comments and their thread IDs. |
| `/unwarn <user> <number>` | Remove one warning using its current, 1-based `/warnhistory` number. |

### Threads — 14

| Command | Purpose |
| --- | --- |
| `/threads [board]` | List threads newest first, optionally in one board; include hidden/deleted content. |
| `/threadinfo <thread_id>` | Inspect title, author, board, tags, counts, flags, and link. |
| `/comments <thread_id>` | List comment IDs, parent IDs, and moderation flags. |
| `/findposts <query>` | Search post/comment text, titles, tags, author names, and IDs, including removed content. |
| `/retitle <thread_id> <title>` | Replace a thread title, up to 140 characters. |
| `/unhide <post_id>` | Clear the hidden flag on a thread or comment; do not clear its deleted flag. |
| `/addtag <thread_id> <tag>` | Add one tag without replacing existing tags. |
| `/removetag <thread_id> <tag>` | Remove one tag, case-insensitively. |
| `/settags <thread_id> <tag,tag,…\|clear>` | Replace all tags, or remove them with `clear`. |
| `/pollresults <thread_id>` | Show a poll's option totals and percentages, including zero-vote polls. |
| `/voteinfo <post_id>` | Show a thread/comment's upvotes, downvotes, and net score. |
| `/pinned` | List pinned threads. |
| `/locked` | List locked threads. |
| `/featured` | List featured threads. |

Tags allow 1–20 characters each, optional leading `#`, and at most four distinct tags per thread. Duplicate tags are matched case-insensitively. Invalid replacements leave existing tags unchanged. To use a tag literally named `clear`, pass `#clear` to `/settags`.

### Boards — 6

| Command | Purpose |
| --- | --- |
| `/boards` | List board IDs, names, and topic locks in display order. |
| `/boardinfo <board>` | Show description, topic-lock state, and whether a board is built-in or custom. |
| `/describecategory <board> <text>` | Replace the board description, up to 200 characters. |
| `/boardstats <board>` | Count threads, comments, hidden/deleted items, votes, and reports. |
| `/boardpermissions <board>` | Show effective permissions and distinguish overrides from defaults. |
| `/resetpermissions <board> <member\|mod\|admin>` | Remove only that group's permission override; keep other board settings. |

Default board access is `write`. Administrators bypass board permissions; topic locks block new non-staff topics but do not lock existing replies.

### Moderation queue — 5

| Command | Purpose |
| --- | --- |
| `/reports <post_id>` | List report IDs, reasons, reporters, timestamps, and escalation flags. |
| `/report <post_id> <reason>` | Add a report with a 1–160 character reason; one report per account per item. |
| `/reportedusers` | Summarize unresolved reports by content author. |
| `/hiddenposts` | List hidden threads and comments for review. |
| `/deletedposts` | List soft-deleted threads and comments recoverable with `/restore`. |

### System — 5

| Command | Purpose |
| --- | --- |
| `/status` | Show maintenance/banner state, forum counts, reports, restrictions, and active plugins. |
| `/activity [duration]` | Count new members, threads, comments, and contributing authors; defaults to `1d`. |
| `/topusers [limit]` | Rank members by karma; defaults to 10, accepts 1–50. |
| `/tagstats` | Count tags on non-hidden, non-deleted threads in boards readable by members. |
| `/storage` | Estimate local database size and show storage counts without printing credentials. |

Durations accept values such as `30m`, `12h`, or `7d`; a bare number means days. Activity, karma, and board totals include stored hidden/deleted content. List output shows at most 50 rows and reports when additional results were omitted. Narrow searches by user, board, or query where supported.

## Persistence and safety

- These commands use the existing browser-local database, save changes, refresh views, and use the existing staff audit log (`/viewlogs`). They do not call a backend or sync between devices.
- `/clear` only clears visible console output. `/unhide` does not restore deleted content; `/unmuffle` does not lift bans or suspensions.
- IDs and moderation flags are included in content listings so staff can review the correct item before editing it.
- `/backup now` is an existing command for saving a snapshot before major changes. Backups include account data and should be kept private.
- This is a client-side demo: its admin checks are not a substitute for server-enforced authorization in a production forum.

## Tests

From the project root:

```bash
node --check app.js
node --test tests/commands.test.cjs
```
