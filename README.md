# bashForum

A community forum for shell tinkerers, script addicts and prompt customizers.

## Run it

Any static file server works:

```bash
python3 -m http.server 8080
# then open http://127.0.0.1:8080
```

Opening `index.html` directly via `file://` also works in most browsers.

## Features

- Reddit-style feed with upvotes / downvotes, post scores and karma
- Desktop sidebar and scrollable mobile navigation: **Home**, **About the forum**, **Your profile**, and communities
- Terminal-inspired welcome panel, community stats, and clickable topic discovery
- Public browsing of discussions and member profiles; sign in when you're ready to participate
- Profile pages with picture, description, karma, upvote rating, posts and comments
- Threads with nested comments, tags and per-community flairs
- Communities: Announcements, General, Help & Support, Show & Tell, Off-Topic
- Sorting: Hot, New, Top, Rising
- Live search across titles, bodies, authors, tags and comments; press `/` to search
- Email + password sign-in with local accounts (salted, iterated password hashes); your own posts and comments can be deleted
- Refined dark / light themes, responsive layouts, reduced-motion support, and keyboard-friendly sign-in
- Hash-based routing (`#/`, `#/about`, `#/profile`, `#/t/<id>`, `#/new`, `#/user/<id>`)
- Admin moderation console with **101 commands**, including 50 new tools for user lookup, profile edits, tags, reports, board permissions, and forum statistics. Open **`>_`** or press **Ctrl + `**; use `/help` for all commands or `/help Users` to filter. See [COMMANDS.md](COMMANDS.md) for the additions and examples.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Shell: topbar, sidebar, SVG icons, auth modal, toast |
| `styles.css` | Design system (CSS variables for both themes) |
| `app.js` | Storage layer, router, views and event handling |
| `COMMANDS.md` | Moderation command reference, examples, and safety notes |
| `tests/commands.test.cjs` | Command regression tests (`node --test tests/commands.test.cjs`) |

## Structure

```js
{
  users:   { [id]: { id, name, bio, pfp, joined } },
  accounts: { [email]: { salt, hash, userId } },
  threads: [{ id, title, body, cat, author, tags, created, up: [], down: [], replies: [...] }],
  replies: [{ id, parent, author, body, created, up: [], down: [] }],
  currentUserId,
  prefs: { named, theme }
}
```

Comments, votes and profiles all persist between sessions.
