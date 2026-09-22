# vibecode

A cozy, **local-first forum**. No server, no database, no accounts — everything you post
lives in your browser's `localStorage`.

## Run it

Any static file server works:

```bash
python3 -m http.server 8080
# then open http://127.0.0.1:8080
```

Opening `index.html` directly via `file://` also works in most browsers.

## Features

- Threads, replies (with nesting), likes, and tags
- 5 categories with per-category counts in the sidebar
- Sorting: recent activity, newest, most liked, most discussed
- Live search across titles, bodies, authors, and replies
- Profiles — pick a display name on first visit, rename any time
- Own posts can be deleted; "Reset demo data" restores the seed content
- Dark / light theme, mobile-friendly sidebar
- Hash-based routing (`#/`, `#/t/<id>`, `#/new`, `#/user/<id>`)

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Shell: topbar, sidebar mount, setup modal, toast |
| `styles.css` | Design system (CSS variables for both themes) |
| `app.js` | Storage layer, router, views, and event handling |

## Storage model

All state sits under one key, `vibecode.forum.v1`:

```js
{
  users:   { [id]: { id, name, joined } },
  threads: [{ id, title, body, cat, author, tags, created, likes: [], replies: [...] }],
  replies: [{ id, parent, author, body, created, likes: [] }],
  currentUserId,
  prefs: { named, theme }
}
```

Writes are wrapped in `try/catch` so private-browsing storage restrictions degrade
gracefully instead of failing silently.
