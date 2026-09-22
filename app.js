/* ============================================================
   Vibecode Forum — local-first, no backend.
   Everything (users, threads, replies, likes) lives in
   localStorage under a single key. No network requests.
   ============================================================ */
(() => {
  'use strict';

  const KEY = 'vibecode.forum.v1';
  const HOUR = 3600e3;
  const DAY = 86400e3;

  const CATS = [
    { id: 'announcements', name: 'Announcements',  icon: '📢', desc: 'News and updates from the team' },
    { id: 'general',       name: 'General',        icon: '💬', desc: 'Anything worth talking about' },
    { id: 'help',          name: 'Help & Support', icon: '🛠️', desc: 'Ask questions, get unstuck' },
    { id: 'showcase',      name: 'Show & Tell',    icon: '🎨', desc: 'Share what you built' },
    { id: 'offtopic',      name: 'Off-Topic',      icon: '🎲', desc: 'The chill corner' },
  ];

  const SORTS = [
    { id: 'active',    label: 'Recent activity' },
    { id: 'new',       label: 'Newest' },
    { id: 'top',       label: 'Most liked' },
    { id: 'discussed', label: 'Most discussed' },
  ];

  /* ---------------- helpers ---------------- */

  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
  const $ = (s, r = document) => r.querySelector(s);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  function fmtTime(ts) {
    const d = Date.now() - ts;
    if (d < 60e3) return 'just now';
    const m = Math.floor(d / 60e3);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const days = Math.floor(h / 24);
    if (days < 7) return days + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const avatar = (u, size = 36) => {
    const init = String(u ? u.name : '?').trim().split(/\s+/).slice(0, 2)
      .map((w) => w[0].toUpperCase()).join('') || '?';
    return `<span class="avatar" style="--h:${hue(u ? u.id : 'x')};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.37)}px">${esc(init)}</span>`;
  };

  const paragraphs = (text) => String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  /* ---------------- seed / storage ---------------- */

  function seed() {
    const now = Date.now();
    const users = {};
    const addUser = (id, name, joined) => (users[id] = { id, name, joined });

    addUser('u_mira', 'Mira Chen',  now - 90 * DAY);
    addUser('u_ada',  'Ada Lovelace', now - 60 * DAY);
    addUser('u_theo', 'Theo Park',  now - 31 * DAY);
    addUser('u_nova', 'Nova Reyes', now - 22 * DAY);
    addUser('u_sam',  'Sam Okafor', now - 9 * DAY);

    const t = (o) => Object.assign({
      id: uid('t'), likes: [], replies: [], tags: [], created: now - DAY,
    }, o);
    const r = (o) => Object.assign({ id: uid('r'), likes: [], parent: null, created: now - HOUR }, o);

    const threads = [
      t({
        title: 'Welcome to the Vibecode forum 👋',
        cat: 'announcements', author: 'u_mira', tags: ['meta'], created: now - 6 * DAY,
        body: 'Glad you are here!\n\nThis forum runs **entirely in your browser**: there is no server, no database and no account to create. Everything you post is saved to `localStorage` on this device.\n\nA few things to know:\n\nPick a display name when prompted — it is only stored locally.\nThreads, replies and likes persist across reloads.\nThere is a "Reset demo data" button in the sidebar if you want a clean slate.\n\nBe kind, stay curious, and post the thing you were about to close the tab on.',
        likes: ['u_ada', 'u_theo', 'u_nova', 'u_sam'],
        replies: [
          r({ author: 'u_ada', created: now - 5 * DAY, likes: ['u_mira'],
              body: 'Love that this needs zero setup. Opened the page and started typing — that is how it should feel.' }),
          r({ author: 'u_theo', created: now - 4 * DAY,
              body: 'Coming from three different hosted forums, a local-only sandbox is a nice change of pace for prototyping discussion UIs.' }),
        ],
      }),
      t({
        title: 'What are you building this week?',
        cat: 'general', author: 'u_ada', created: now - 2 * DAY, tags: ['weekly'],
        body: 'Weekly check-in thread. Small counts.\n\nI am rewriting my RSS reader so it does not re-layout every time a feed refreshes. Currently stuck on a CSS containment rabbit hole.',
        likes: ['u_mira', 'u_nova'],
        replies: [
          r({ author: 'u_nova', created: now - 40 * HOUR,
              body: 'A pomodoro timer in vanilla JS. Two hundred lines, no dependencies, suspiciously satisfying to use.' }),
          r({ author: 'u_sam', created: now - 30 * HOUR, likes: ['u_ada'],
              body: 'Terminal theme picker. Twelve colors, one config file, far too many hours spent on contrast ratios.' }),
          r({ author: 'u_ada', created: now - 26 * HOUR, parent: null, likes: [],
              body: 'Twelve colors is a lifestyle, not a bug.' }),
        ],
      }),
      t({
        title: 'Why does my saved data disappear in private browsing?',
        cat: 'help', author: 'u_theo', created: now - 19 * HOUR, tags: ['storage'],
        body: 'Everything works in a normal tab, but after I close the private window my posts are gone.\n\nAm I holding localStorage wrong, or is this expected behaviour?',
        likes: ['u_sam'],
        replies: [
          r({ author: 'u_mira', created: now - 17 * HOUR, likes: ['u_theo', 'u_sam'],
              body: 'Expected. Private windows throw away storage when the session ends — that is the whole point of them.\n\nFor a local-only app the usual fix is to detect the failure: wrap your writes in try/catch, and if they throw, tell the user their data will not survive the session.' }),
          r({ author: 'u_sam', created: now - 15 * HOUR,
              body: 'Also worth knowing: Safari blocks storage entirely in some modes, so never assume a write succeeded just because the call returned.' }),
        ],
      }),
      t({
        title: 'Shipped: a Pomodoro timer in 200 lines of vanilla JS',
        cat: 'showcase', author: 'u_nova', created: now - 3 * DAY, tags: ['javascript', 'tiny'],
        body: 'No framework, no build step, one HTML file. It does four things: start, pause, reset, and an obnoxious chime when the session ends.\n\nThe trick that made it feel finished was animating the ring with `stroke-dashoffset` instead of faking progress with JavaScript timers.',
        likes: ['u_ada', 'u_mira', 'u_theo', 'u_sam'],
        replies: [
          r({ author: 'u_sam', created: now - 2 * DAY, likes: ['u_nova'],
              body: 'The SVG ring detail is what makes it. Timers without any visual feedback always feel broken.' }),
        ],
      }),
      t({
        title: 'Favourite keyboard switches for long coding sessions?',
        cat: 'offtopic', author: 'u_sam', created: now - 30 * HOUR,
        body: 'Currently on tactile browns and my fingers are staging a revolt after hour six.\n\nConvince me: linear, tactile, or clicky — and does anyone actually enjoy writing on a laptop keyboard?',
        likes: ['u_theo'],
        replies: [
          r({ author: 'u_theo', created: now - 22 * HOUR,
              body: 'Silent linears. My neighbours have voted, unanimously, in my favour.' }),
        ],
      }),
    ];

    return {
      version: 1,
      users,
      threads,
      currentUserId: null,
      prefs: { named: false, theme: document.documentElement.dataset.theme || 'dark' },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.threads) && d.users) return d;
      }
    } catch (e) { /* corrupted or unavailable storage — fall through to seed */ }
    const fresh = seed();
    try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      toast('⚠️ Could not save — browser storage is unavailable');
    }
  }

  /* ---------------- state ---------------- */

  let db = load();

  // guarantee a current user
  if (!db.currentUserId || !db.users[db.currentUserId]) {
    const id = uid('u');
    db.users[id] = { id, name: 'Guest ' + Math.floor(1000 + Math.random() * 9000), joined: Date.now() };
    db.currentUserId = id;
    db.prefs = db.prefs || { named: false };
    save();
  }
  db.prefs = db.prefs || { named: false };

  const ui = { draft: '', replyTo: null, lastPath: null };
  const me = () => db.users[db.currentUserId];
  const user = (id) => db.users[id] || { id, name: 'Deleted user', joined: Date.now() };
  const cat = (id) => CATS.find((c) => c.id === id) || { id, name: id, icon: '•', desc: '' };
  const thread = (id) => db.threads.find((t) => t.id === id);
  const lastActivity = (t) =>
    t.replies.reduce((max, r) => Math.max(max, r.created), t.created);

  /* ---------------- routing ---------------- */

  function parse() {
    const raw = location.hash.slice(1) || '/';
    const i = raw.indexOf('?');
    const path = i < 0 ? raw : raw.slice(0, i);
    const q = new URLSearchParams(i < 0 ? '' : raw.slice(i + 1));
    return { path, q };
  }

  const homeHash = (params) => {
    const s = params.toString();
    return '#/' + (s ? '?' + s : '');
  };

  window.addEventListener('hashchange', render);

  /* ---------------- sidebar + header ---------------- */

  function renderSidebar(params) {
    const active = params.get('cat');
    const counts = {};
    CATS.forEach((c) => (counts[c.id] = 0));
    db.threads.forEach((t) => { if (counts[t.cat] != null) counts[t.cat]++; });
    const posts = db.threads.reduce((n, t) => n + 1 + t.replies.length, 0);
    const members = Object.keys(db.users).length;

    $('#sidebar').innerHTML = `
      <nav class="side-nav">
        <a class="side-link ${!active ? 'active' : ''}" href="#/">
          <span class="side-icon">🌐</span><span class="side-label">All threads</span>
          <span class="side-count">${db.threads.length}</span>
        </a>
      </nav>

      <div class="side-title">Categories</div>
      <nav class="side-nav">
        ${CATS.map((c) => `
          <a class="side-link ${active === c.id ? 'active' : ''}" href="#/?cat=${c.id}">
            <span class="side-icon">${c.icon}</span>
            <span class="side-label">${c.name}</span>
            <span class="side-count">${counts[c.id]}</span>
          </a>`).join('')}
      </nav>

      <div class="side-card">
        <div class="side-card-title">💬 Local-only forum</div>
        <p>Nothing leaves this browser — posts live in <code>localStorage</code>.</p>
        <div class="mini-stats">
          <div><b>${db.threads.length}</b><span>threads</span></div>
          <div><b>${posts}</b><span>posts</span></div>
          <div><b>${members}</b><span>members</span></div>
        </div>
        <button class="btn btn-ghost btn-sm btn-block" data-action="reset">Reset demo data</button>
      </div>`;
  }

  function renderHeader() {
    const u = me();
    $('#userChip').innerHTML = avatar(u, 26) + `<span>${esc(u.name)}</span>`;
    const theme = document.documentElement.dataset.theme;
    $('#themeBtn').textContent = theme === 'light' ? '🌙' : '☀️';
  }

  /* ---------------- views ---------------- */

  function threadRow(t) {
    const c = cat(t.cat);
    const a = user(t.author);
    const n = t.replies.length;
    return `
      <article class="thread">
        ${avatar(a, 40)}
        <div class="thread-main">
          <div class="thread-title"><a href="#/t/${t.id}">${esc(t.title)}</a></div>
          <div class="thread-meta">
            <span class="pill">${c.icon} ${esc(c.name)}</span>
            <span>${esc(a.name)}</span>
            <span class="dot">•</span>
            <span>${fmtTime(t.created)}</span>
            ${t.tags.map((tag) => `<span class="tag">#${esc(tag)}</span>`).join('')}
          </div>
        </div>
        <div class="thread-stats">
          <div class="stat"><b>${n}</b><span>${n === 1 ? 'reply' : 'replies'}</span></div>
          <div class="stat"><b>${t.likes.length}</b><span>likes</span></div>
          <div class="stat"><b>${fmtTime(lastActivity(t))}</b><span>activity</span></div>
        </div>
      </article>`;
  }

  function renderHome(params) {
    const catId = params.get('cat');
    const sort = SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'active';
    const q = (params.get('q') || '').trim().toLowerCase();

    let list = db.threads.filter((t) => (catId ? t.cat === catId : true));
    if (q) {
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        user(t.author).name.toLowerCase().includes(q) ||
        t.replies.some((r) => r.body.toLowerCase().includes(q) || user(r.author).name.toLowerCase().includes(q)));
    }

    const cmp = {
      active:    (a, b) => lastActivity(b) - lastActivity(a),
      new:       (a, b) => b.created - a.created,
      top:       (a, b) => b.likes.length - a.likes.length || lastActivity(b) - lastActivity(a),
      discussed: (a, b) => b.replies.length - a.replies.length || lastActivity(b) - lastActivity(a),
    }[sort];
    list = list.slice().sort(cmp);

    const c = catId ? cat(catId) : null;

    const tabs = SORTS.map((s) => {
      const p = new URLSearchParams(params);
      p.set('sort', s.id);
      return `<a class="tab ${sort === s.id ? 'active' : ''}" href="${homeHash(p)}">${s.label}</a>`;
    }).join('');

    $('#main').innerHTML = `
      <div class="page-head">
        <div>
          <h1>${c ? `${c.icon} ${esc(c.name)}` : q ? `Search: “${esc(params.get('q'))}”` : 'All threads'}</h1>
          <div class="sub">${c ? esc(c.desc) : `${list.length} thread${list.length === 1 ? '' : 's'} · sorted by ${SORTS.find((s) => s.id === sort).label.toLowerCase()}`}</div>
        </div>
        <div class="spacer"></div>
        <a class="btn btn-primary" href="#/new">+ New thread</a>
      </div>

      <div class="tabs">${tabs}</div>

      ${list.length
        ? `<div class="thread-list">${list.map(threadRow).join('')}</div>`
        : `<div class="empty">
             <div class="big">🔍</div>
             <h3>${q ? 'No matching threads' : 'Nothing here yet'}</h3>
             <p>${q ? 'Try a different search term.' : 'Be the first to start a conversation in this category.'}</p>
             <a class="btn btn-primary" href="#/new">Start a thread</a>
           </div>`}`;
  }

  function renderThread(id) {
    const t = thread(id);
    if (!t) {
      $('#main').innerHTML = `
        <div class="empty"><div class="big">🕳️</div><h3>Thread not found</h3>
        <p>It may have been deleted from this browser.</p>
        <a class="btn btn-primary" href="#/">Back to the forum</a></div>`;
      return;
    }

    const c = cat(t.cat);
    const a = user(t.author);
    const liked = t.likes.includes(db.currentUserId);

    // group replies by parent
    const byParent = {};
    t.replies.forEach((r) => {
      const key = r.parent || 'root';
      (byParent[key] = byParent[key] || []).push(r);
    });
    Object.values(byParent).forEach((arr) => arr.sort((x, y) => x.created - y.created));

    const renderReply = (r, depth) => {
      const ru = user(r.author);
      const rLiked = r.likes.includes(db.currentUserId);
      const kids = byParent[r.id] || [];
      const mine = r.author === db.currentUserId;
      return `
        <div class="reply ${depth ? 'nested' : ''}" id="reply-${r.id}">
          <div class="reply-head">
            ${avatar(ru, 26)}
            <b>${esc(ru.name)}</b>
            <span class="when">${fmtTime(r.created)}</span>
            <span class="spacer"></span>
            <button class="like-btn ${rLiked ? 'liked' : ''}" data-action="like"
                    data-kind="reply" data-id="${r.id}" data-tid="${t.id}" title="Like this reply">
              <span class="heart">♥</span> ${r.likes.length}
            </button>
          </div>
          <div class="reply-body">${paragraphs(r.body)}</div>
          <div class="reply-actions">
            <button class="link-btn" data-action="reply-to" data-id="${r.id}" data-name="${esc(ru.name)}">↩ Reply</button>
            ${mine ? `<button class="link-btn danger" data-action="del-reply" data-id="${r.id}" data-tid="${t.id}">Delete</button>` : ''}
          </div>
          ${kids.map((k) => renderReply(k, Math.min(depth + 1, 4))).join('')}
        </div>`;
    };

    const roots = (byParent.root || []).map((r) => renderReply(r, 0)).join('');
    const replyTarget = ui.replyTo ? t.replies.find((r) => r.id === ui.replyTo) : null;

    $('#main').innerHTML = `
      <a class="back-link" href="${homeHash(new URLSearchParams(t.cat ? 'cat=' + t.cat : ''))}">← Back to ${esc(c.name)}</a>

      <article class="card post">
        <div class="post-head">
          ${avatar(a, 40)}
          <div class="who">
            <b>${esc(a.name)}</b>
            <span>${fmtTime(t.created)} · <span class="pill">${c.icon} ${esc(c.name)}</span></span>
          </div>
          <div class="actions">
            ${t.author === db.currentUserId
              ? `<button class="btn btn-danger btn-sm" data-action="del-thread" data-id="${t.id}">Delete</button>` : ''}
          </div>
        </div>

        <h1>${esc(t.title)}</h1>
        ${t.tags.length ? `<div class="post-tags">${t.tags.map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>` : ''}
        <div class="post-body">${paragraphs(t.body)}</div>

        <div class="post-foot">
          <button class="like-btn ${liked ? 'liked' : ''}" data-action="like" data-kind="thread" data-id="${t.id}">
            <span class="heart">♥</span> ${t.likes.length}
          </button>
          <button class="btn btn-ghost btn-sm" data-action="focus-reply">↩ Reply</button>
          <button class="btn btn-ghost btn-sm" data-action="copy-link">🔗 Copy link</button>
        </div>
      </article>

      <div class="replies-head">${t.replies.length} ${t.replies.length === 1 ? 'reply' : 'replies'}</div>
      <div class="replies">
        ${roots || `<div class="empty"><div class="big">💬</div><h3>No replies yet</h3><p>Say something — the first reply always matters most.</p></div>`}
      </div>

      <form class="card composer" id="replyForm" data-tid="${t.id}">
        <div class="composer-head">
          ${avatar(me(), 28)}
          <b>Reply as ${esc(me().name)}</b>
          ${replyTarget
            ? `<span class="chip">replying to ${esc(user(replyTarget.author).name)}</span>
               <button type="button" class="link-btn" data-action="cancel-reply">✕</button>`
            : ''}
        </div>
        <textarea name="body" id="replyBody" rows="4" placeholder="Write your reply…">${esc(ui.draft)}</textarea>
        <div class="composer-foot">
          <span class="hint">Leave a blank line to start a new paragraph</span>
          <button class="btn btn-primary" type="submit">Post reply</button>
        </div>
      </form>`;

    const box = $('#replyBody');
    if (box) {
      box.addEventListener('input', () => { ui.draft = box.value; });
      box.style.height = 'auto';
      box.style.height = Math.min(box.scrollHeight, 340) + 'px';
    }
  }

  function renderNew(params) {
    const preCat = params.get('cat') || 'general';
    $('#main').innerHTML = `
      <a class="back-link" href="#/">← Back to the forum</a>
      <div class="page-head"><div>
        <h1>Start a new thread</h1>
        <div class="sub">Posted as ${esc(me().name)} · saved locally in this browser</div>
      </div></div>

      <form class="card form" id="newThreadForm">
        <div class="field">
          <label for="nt-title">Title</label>
          <input class="input" id="nt-title" name="title" maxlength="140" placeholder="What is this thread about?" required autofocus />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="nt-cat">Category</label>
            <select class="input" id="nt-cat" name="cat">
              ${CATS.map((c) => `<option value="${c.id}" ${c.id === preCat ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="nt-tags">Tags <span style="color:var(--faint);font-weight:500">(optional)</span></label>
            <input class="input" id="nt-tags" name="tags" maxlength="80" placeholder="javascript, help, meta" />
            <div class="help">Comma separated, up to 4.</div>
          </div>
        </div>

        <div class="field">
          <label for="nt-body">What do you want to say?</label>
          <textarea id="nt-body" name="body" rows="9" placeholder="Write your post…" required></textarea>
          <div class="help">Leave a blank line to start a new paragraph.</div>
        </div>

        <div class="form-actions">
          <a class="btn btn-ghost" href="#/">Cancel</a>
          <button class="btn btn-primary" type="submit">Post thread</button>
        </div>
      </form>`;
  }

  function renderUser(id) {
    const u = db.users[id];
    if (!u) {
      $('#main').innerHTML = `<div class="empty"><div class="big">👤</div><h3>User not found</h3>
        <p>This profile does not exist in local storage.</p>
        <a class="btn btn-primary" href="#/">Back to the forum</a></div>`;
      return;
    }

    const mine = u.id === db.currentUserId;
    const started = db.threads.filter((t) => t.author === u.id).sort((a, b) => b.created - a.created);
    const replyCount = db.threads.reduce(
      (n, t) => n + t.replies.filter((r) => r.author === u.id).length, 0);

    $('#main').innerHTML = `
      <a class="back-link" href="#/">← Back to the forum</a>

      <div class="card profile-card">
        ${avatar(u, 62)}
        <div class="info">
          <h1>${esc(u.name)}${mine ? ' <span class="pill">you</span>' : ''}</h1>
          <div class="sub">Joined ${new Date(u.joined).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        </div>
        <div class="stats">
          <div><b>${started.length}</b><span>threads</span></div>
          <div><b>${replyCount}</b><span>replies</span></div>
        </div>
      </div>

      ${mine ? `
        <form class="card form" id="renameForm" style="gap:12px;padding:18px">
          <div class="field" style="margin:0">
            <label for="rename">Display name</label>
            <div style="display:flex;gap:10px">
              <input class="input" id="rename" name="name" maxlength="32" value="${esc(u.name)}" />
              <button class="btn btn-primary" type="submit">Save</button>
            </div>
          </div>
        </form>` : ''}

      <div class="section-title">Threads started</div>
      ${started.length
        ? `<div class="thread-list">${started.map(threadRow).join('')}</div>`
        : `<div class="empty"><div class="big">📝</div><h3>No threads yet</h3><p>${esc(u.name)} has not started a discussion.</p></div>`}`;
  }

  /* ---------------- render ---------------- */

  function render() {
    const { path, q } = parse();
    renderHeader();
    renderSidebar(q);

    if (path === '/' || path === '') renderHome(q);
    else if (path === '/new') renderNew(q);
    else if (path.startsWith('/t/')) renderThread(path.slice(3));
    else if (path.startsWith('/user/')) renderUser(path.slice(6));
    else $('#main').innerHTML = `<div class="empty"><div class="big">🧭</div><h3>Page not found</h3>
      <p>That URL does not exist here.</p><a class="btn btn-primary" href="#/">Back to the forum</a></div>`;

    const search = $('#search');
    if (document.activeElement !== search) search.value = q.get('q') || '';

    if (ui.lastPath !== null && ui.lastPath !== path) window.scrollTo({ top: 0 });
    ui.lastPath = path;

    document.body.classList.remove('nav-open');

    if (!db.prefs.named) {
      $('#setupModal').classList.remove('hidden');
      setTimeout(() => $('#setupName') && $('#setupName').focus(), 60);
    }
  }

  /* ---------------- actions ---------------- */

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function toggleLike(kind, id, tid) {
    const uid_ = db.currentUserId;
    if (kind === 'thread') {
      const t = thread(id);
      if (!t) return;
      const i = t.likes.indexOf(uid_);
      i < 0 ? t.likes.push(uid_) : t.likes.splice(i, 1);
    } else {
      const t = thread(tid);
      const r = t && t.replies.find((x) => x.id === id);
      if (!r) return;
      const i = r.likes.indexOf(uid_);
      i < 0 ? r.likes.push(uid_) : r.likes.splice(i, 1);
    }
    save();
    render();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'menu') document.body.classList.toggle('nav-open');

    if (action === 'theme') {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('vibecode.theme', next); } catch (err) {}
      db.prefs.theme = next;
      save();
      renderHeader();
    }

    if (action === 'me') location.hash = '#/user/' + db.currentUserId;

    if (action === 'like') {
      toggleLike(el.dataset.kind, el.dataset.id, el.dataset.tid);
    }

    if (action === 'reply-to') {
      ui.replyTo = el.dataset.id;
      ui.draft = ui.draft || '@' + el.dataset.name + ' ';
      render();
      const box = $('#replyBody');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }

    if (action === 'cancel-reply') { ui.replyTo = null; render(); }

    if (action === 'focus-reply') {
      const box = $('#replyBody');
      if (box) { box.focus(); box.scrollIntoView({ block: 'center' }); }
    }

    if (action === 'copy-link') {
      const url = location.href;
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(
        () => toast('Link copied'), () => toast('Could not copy link'));
      else toast(url);
    }

    if (action === 'del-thread') {
      if (confirm('Delete this thread and all of its replies? This cannot be undone.')) {
        db.threads = db.threads.filter((t) => t.id !== el.dataset.id);
        save();
        location.hash = '#/';
        toast('Thread deleted');
        render();
      }
    }

    if (action === 'del-reply') {
      const t = thread(el.dataset.tid);
      if (!t) return;
      const removeIds = new Set([el.dataset.id]);
      let grew = true;
      while (grew) {                       // also drop any nested children
        grew = false;
        t.replies.forEach((r) => {
          if (r.parent && removeIds.has(r.parent) && !removeIds.has(r.id)) {
            removeIds.add(r.id); grew = true;
          }
        });
      }
      t.replies = t.replies.filter((r) => !removeIds.has(r.id));
      save(); render(); toast('Reply deleted');
    }

    if (action === 'reset') {
      if (confirm('Reset the forum back to the demo data? Your posts on this device will be lost.')) {
        try { localStorage.removeItem(KEY); } catch (err) {}
        location.hash = '#/';
        location.reload();
      }
    }
  });

  /* ---------------- forms ---------------- */

  document.addEventListener('submit', (e) => {
    const form = e.target;

    if (form.id === 'setupForm') {
      e.preventDefault();
      const name = String(new FormData(form).get('name') || '').trim().slice(0, 32);
      if (!name) return;
      me().name = name;
      db.prefs.named = true;
      save();
      $('#setupModal').classList.add('hidden');
      toast('Welcome, ' + name + '!');
      render();
      return;
    }

    if (form.id === 'renameForm') {
      e.preventDefault();
      const name = String(new FormData(form).get('name') || '').trim().slice(0, 32);
      if (!name) return;
      me().name = name;
      save(); render(); toast('Name updated');
      return;
    }

    if (form.id === 'newThreadForm') {
      e.preventDefault();
      const fd = new FormData(form);
      const title = String(fd.get('title') || '').trim();
      const body = String(fd.get('body') || '').trim();
      if (!title || !body) { toast('Title and body are required'); return; }

      const tags = String(fd.get('tags') || '')
        .split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean).slice(0, 4);

      const t = {
        id: uid('t'),
        title: title.slice(0, 140),
        body,
        cat: String(fd.get('cat') || 'general'),
        author: db.currentUserId,
        tags,
        created: Date.now(),
        likes: [],
        replies: [],
      };
      db.threads.unshift(t);
      save();
      location.hash = '#/t/' + t.id;
      toast('Thread posted 🎉');
      return;
    }

    if (form.id === 'replyForm') {
      e.preventDefault();
      const body = String(new FormData(form).get('body') || '').trim();
      const t = thread(form.dataset.tid);
      if (!body || !t) { toast('Write something first'); return; }

      t.replies.push({
        id: uid('r'),
        parent: ui.replyTo && t.replies.some((r) => r.id === ui.replyTo) ? ui.replyTo : null,
        author: db.currentUserId,
        body,
        created: Date.now(),
        likes: [],
      });
      ui.draft = '';
      ui.replyTo = null;
      save();
      render();
      toast('Reply posted');
      const el = t.replies.length && $('#reply-' + t.replies[t.replies.length - 1].id);
      if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); }
    }
  });

  /* ---------------- live search ---------------- */

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    const value = e.target.value.trim();
    const { path, q } = parse();
    if (path !== '/' && path !== '') return;   // only filter while on the list view

    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (value) q.set('q', value); else q.delete('q');
      history.replaceState(null, '', homeHash(q));
      ui.lastPath = path;                       // keep scroll position while typing
      render();
      const input = $('#search');
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 140);
  });

  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = e.target.value.trim();
      location.hash = homeHash(new URLSearchParams(v ? 'q=' + encodeURIComponent(v) : ''));
      e.target.blur();
    }
    if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); }
  });

  /* ---------------- boot ---------------- */

  if (!location.hash) location.hash = '#/';
  render();
})();
