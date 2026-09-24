# bashForum

A community forum for shell tinkerers, script addicts and prompt customizers.

## Run it

Any static file server works:

```bash/
python3 -m http.server 8080
# then open http://127.0.0.1:8080
```

Opening `index.html` directly via `file://` also works in most browsers.

## Features

- Reddit-style feed with upvotes / downvotes, post scores and karma
- Top navigation: **Main** (feed), **About** (info, rules, credits) and **Profile**
- Profile pages with picture, description, karma, upvote rating, posts and comments
- Threads with nested comments, tags and per-community flairs
- Communities: Announcements, General, Help & Support, Show & Tell, Off-Topic
- Sorting: Hot, New, Top, Rising
- Live search across titles, bodies, authors and comments
- Email + password sign-in with local accounts (salted, iterated password hashes); your own posts and comments can be deleted
- Dark / light theme, mobile-friendly drawer navigation
- Hash-based routing (`#/`, `#/about`, `#/profile`, `#/t/<id>`, `#/new`, `#/user/<id>`)

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Shell: topbar, top nav, auth modal, toast |
| `styles.css` | Design system (CSS variables for both themes) |
| `app.js` | Storage layer, router, views and event handling |

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
