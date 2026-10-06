/* ============================================================
   bashForum — the community for shell tinkerers.
   Reddit-style feed: votes, karma, communities, sorting.
   ============================================================ */
(() => {
  'use strict';

  const KEY = 'bashforum.v1';
  const LEGACY_KEY = 'vibecode.forum.v1';
  const HOUR = 3600e3;
  const DAY = 86400e3;

  /* the staff account — these credentials always sign you in with command access */
  const ADMIN_EMAIL = 'admin@admin.com';
  const ADMIN_PASS = 'admin99';

  const COMMUNITIES = [
    { id: 'announcements', name: 'Announcements',  icon: '📢', desc: 'News and updates from the team' },
    { id: 'general',       name: 'General',        icon: '💬', desc: 'Anything worth talking about' },
    { id: 'help',          name: 'Help & Support', icon: '🛠️', desc: 'Ask questions, get unstuck' },
    { id: 'showcase',      name: 'Show & Tell',    icon: '🎨', desc: 'Share what you built' },
    { id: 'offtopic',      name: 'Off-Topic',      icon: '🎲', desc: 'The chill corner' },
  ];

  const SORTS = [
    { id: 'hot',    label: 'Hot',    icon: 'flame' },
    { id: 'new',    label: 'New',    icon: 'clock' },
    { id: 'top',    label: 'Top',    icon: 'trophy' },
    { id: 'rising', label: 'Rising', icon: 'trend' },
  ];

  /* ---------------- helpers ---------------- */

  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const categoryIcon = (id) => icon(({ announcements: 'megaphone', general: 'chat', help: 'help', showcase: 'sparkles', offtopic: 'coffee' })[id] || 'grid');
  const visibleThreads = () => db.threads.filter((t) => !t.deleted && (!t.hidden || isStaff()) && canRead(t.cat));

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

  const fmtNum = (n) =>
    Math.abs(n) >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

  const avatar = (u, size = 36) => {
    const style = `--h:${hue(u ? u.id : 'x')};width:${size}px;height:${size}px`;
    if (u && u.pfp) {
      if (/^data:image\//.test(u.pfp)) {
        return `<span class="avatar has-img" style="${style}"><img src="${esc(u.pfp)}" alt="" /></span>`;
      }
      return `<span class="avatar pfp" style="${style};font-size:${Math.round(size * 0.55)}px">${esc(u.pfp)}</span>`;
    }
    const init = String(u ? u.name : '?').trim().split(/\s+/).slice(0, 2)
      .map((w) => w[0].toUpperCase()).join('') || '?';
    return `<span class="avatar" style="${style};font-size:${Math.round(size * 0.37)}px">${esc(init)}</span>`;
  };

  const tagHue = (t) => {
    let h = 0;
    for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  };
  const tagChip = (t) => `<span class="tag" style="--tagh:${tagHue(t)}">#${esc(t)}</span>`;

  /* local credential helpers — salted, iterated digest (accounts live on this device) */
  const normEmail = (v) => String(v || '').trim().toLowerCase();

  function hashPass(password, salt) {
    const input = salt + ' ' + password;
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let round = 0; round < 512; round++) {
      for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i) + round;
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
        h2 = (h2 ^ (h2 >>> 13)) >>> 0;
      }
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  function authError(msg) {
    const box = $('#authErr');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
  }

  /* markdown-lite: `inline code`, ```fenced blocks```, **bold**, *italic*, links */
  const mdLink = (u) => {
    try {
      const url = new URL(u, location.href);
      return /^(https?:|mailto:)$/.test(url.protocol) ? url.href : null;
    } catch (e) { return null; }
  };

  function md(text) {
    const blocks = [];
    const codes = [];
    const links = [];
    let s = String(text || '').replace(/\u0000/g, '');

    /* fenced code blocks — extracted first so nothing else touches them */
    s = s.replace(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push({ lang, code });
      return '\u0000B' + (blocks.length - 1) + '\u0000';
    });

    /* inline code */
    s = s.replace(/`([^`\n]+)`/g, (m, code) => {
      codes.push(code);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    s = esc(s);

    /* [label](url) — http(s)/mailto/relative only; anything else renders as plain label */
    s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (m, label, href) => {
      const safe = mdLink(href);
      if (!safe) return label;
      links.push({ label, href: esc(safe) });
      return '\u0000L' + (links.length - 1) + '\u0000';
    });

    /* bold, then italic */
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');

    /* bare URLs */
    s = s.replace(/(^|[\s(])https?:\/\/[^\s<]+/g, (m, pre) => {
      const full = m.slice(pre.length);
      const raw = full.replace(/[.,;:!?)\]]+$/, '');
      const safe = mdLink(raw);
      if (!safe) return m;
      return pre + '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' +
        raw + '</a>' + full.slice(raw.length);
    });

    /* paragraphs — block placeholders stay outside <p> */
    const html = s.split(/\n{2,}/).map((chunk) => {
      const inner = chunk.replace(/\n/g, '<br>');
      return /^\u0000B\d+\u0000$/.test(inner) ? inner : '<p>' + inner + '</p>';
    }).join('');

    /* restore protected pieces */
    return html
      .replace(/\u0000B(\d+)\u0000/g, (m, i) => {
        const b = blocks[+i];
        return '<pre class="md-pre">' +
          (b.lang ? '<span class="md-lang">' + esc(b.lang) + '</span>' : '') +
          '<code>' + esc(b.code.replace(/\n$/, '')) + '</code></pre>';
      })
      .replace(/\u0000C(\d+)\u0000/g, (m, i) => '<code class="md-code">' + esc(codes[+i]) + '</code>')
      .replace(/\u0000L(\d+)\u0000/g, (m, i) => '<a href="' + links[+i].href +
        '" target="_blank" rel="noopener noreferrer">' + links[+i].label + '</a>');
  }

  const plain = (text) => String(text).replace(/\s+/g, ' ').trim();

  /* ---------------- seed / storage ---------------- */

  function seed() {
    const now = Date.now();
    const users = {};
    const addUser = (id, name, joined, bio) => (users[id] = { id, name, joined, bio, pfp: '' });

    addUser('u_mira', 'Mira Chen',    now - 90 * DAY, 'Keeper of the keys. I write the changelog so you do not have to.');
    addUser('u_ada',  'Ada Lovelace', now - 60 * DAY, 'Prompt archaeologist. Ask me anything about exit codes.');
    addUser('u_theo', 'Theo Park',    now - 31 * DAY, 'Automating myself out of one job and into the next.');
    addUser('u_nova', 'Nova Reyes',   now - 22 * DAY, 'Two-hundred-lines-or-less enthusiast. Ships small, ships often.');
    addUser('u_sam',  'Sam Okafor',   now - 9 * DAY,  'If it can be a shell function, I have already made it one.');

    const t = (o) => Object.assign({
      id: uid('t'), up: [], down: [], replies: [], tags: [], created: now - DAY,
    }, o);
    const r = (o) => Object.assign({ id: uid('r'), up: [], down: [], parent: null, created: now - HOUR }, o);

    const threads = [
      t({
        title: 'Welcome to bashForum 👋',
        cat: 'announcements', author: 'u_mira', tags: ['meta'], created: now - 6 * DAY,
        body: 'Glad you are here!\n\nbashForum is a place to talk shell: configs, scripts, prompts, and the tiny ergonomics that make a terminal feel like home.\n\nA few ground rules:\n\nBe kind — every expert was once confused by `grep`.\nSearch before posting; your answer may already be one thread over.\nKeep it on topic-ish. Off-Topic exists for a reason.\nHave fun, and post the snippet you were about to close the tab on.',
        up: ['u_ada', 'u_theo', 'u_nova', 'u_sam'],
        replies: [
          r({ author: 'u_ada', created: now - 5 * DAY, up: ['u_mira'],
              body: 'Finally, a place to admit how many hours I have spent on my prompt alone.' }),
          r({ author: 'u_theo', created: now - 4 * DAY, up: ['u_mira', 'u_nova'],
              body: 'Subscribed. Today I open-sourced my 400-line git helper, one alias at a time.' }),
        ],
      }),
      t({
        title: "What's in your .bashrc that you can't live without?",
        cat: 'general', author: 'u_ada', created: now - 2 * DAY, tags: ['weekly'],
        body: 'Weekly check-in thread. Small confessions.\n\nMine: a `mkcd` alias, and a prompt segment that shows the exit code of the last command. I fixed more bugs with that one line than any linter ever caught.',
        up: ['u_mira', 'u_nova', 'u_sam'],
        replies: [
          r({ author: 'u_nova', created: now - 40 * HOUR, up: ['u_ada', 'u_mira'],
              body: 'fzf-backed history search. I stopped typing full commands weeks ago — the arrow key feels antique now.' }),
          r({ author: 'u_sam', created: now - 30 * HOUR, up: ['u_ada'],
              body: 'A `serve` alias that spins up a static file server in whatever directory I am standing in.' }),
          r({ author: 'u_ada', created: now - 26 * HOUR, parent: null,
              body: 'Twelve aliases for the same tar command is a lifestyle, not a bug.' }),
        ],
      }),
      t({
        title: 'Why does my alias work now but vanish in new terminal sessions?',
        cat: 'help', author: 'u_theo', created: now - 19 * HOUR, tags: ['shell'],
        body: 'I add an alias, it works immediately, then it is gone the next morning.\n\nAm I putting it in the wrong file? I bounce between `.bashrc` and `.bash_profile` and I have lost track of which one my login shell actually reads.',
        up: ['u_sam', 'u_mira'],
        replies: [
          r({ author: 'u_mira', created: now - 17 * HOUR, up: ['u_theo', 'u_sam', 'u_nova'],
              body: 'Classic split: interactive shells read `.bashrc`, login shells read `.bash_profile`.\n\nPut this at the top of `.bash_profile` and you only ever maintain one file:\n\n[[ -f ~/.bashrc ]] && . ~/.bashrc' }),
          r({ author: 'u_sam', created: now - 15 * HOUR, up: ['u_theo'],
              body: 'Also worth knowing: aliases do not expand in non-interactive scripts. That is what functions are for — they work everywhere.' }),
        ],
      }),
      t({
        title: 'Shipped: a 200-line pomodoro timer in pure bash',
        cat: 'showcase', author: 'u_nova', created: now - 3 * DAY, tags: ['bash', 'tiny'],
        body: 'No dependencies beyond `sleep` and a chime from `printf "\\a"`. It does four things: start, pause, reset, and interrupt you when the session ends.\n\nThe surprisingly hard part was making Ctrl-C behave — trapping signals so a stray keystroke does not leave a zombie timer counting down in the background.',
        up: ['u_ada', 'u_mira', 'u_theo', 'u_sam'],
        replies: [
          r({ author: 'u_sam', created: now - 2 * DAY, up: ['u_nova', 'u_ada'],
              body: 'The signal trapping is the whole craft. Mine still only dies gracefully-ish, but it dies on purpose.' }),
        ],
      }),
      t({
        title: 'Favourite terminal colour schemes for long sessions?',
        cat: 'offtopic', author: 'u_sam', created: now - 30 * HOUR,
        body: 'My current theme is doing my eyes in after hour six.\n\nConvince me: solarized, gruvbox, or one of the sixteen-colour classics — and does anyone actually code on the default black-on-white?',
        up: ['u_theo'],
        replies: [
          r({ author: 'u_theo', created: now - 22 * HOUR, up: ['u_sam'],
              body: 'Low-contrast gruvbox. My eyes and my night-owl schedule finally reached an accord.' }),
        ],
      }),
    ];

    return {
      version: 1,
      users,
      threads,
      accounts: {},
      currentUserId: null,
      prefs: { named: false, theme: document.documentElement.dataset.theme || 'dark' },
    };
  }

  /* upgrade data written by an earlier version of the app */
  function migrate(d) {
    if (!d || !Array.isArray(d.threads)) return null;
    const fix = (item) => {
      if (!Array.isArray(item.up)) {
        item.up = Array.isArray(item.likes) ? item.likes.slice() : [];
      }
      if (!Array.isArray(item.down)) item.down = [];
      delete item.likes;
    };
    d.threads.forEach((th) => { fix(th); th.replies.forEach(fix); });
    Object.values(d.users || {}).forEach((u) => {
      if (typeof u.joined !== 'number') u.joined = Date.now();
    });
    d.prefs = d.prefs || { named: false };
    d.accounts = (d.accounts && typeof d.accounts === 'object') ? d.accounts : {};
    return defaults(d);
  }

  /* every field the moderation layer reads is guaranteed to exist */
  function defaults(d) {
    d.audit = Array.isArray(d.audit) ? d.audit : [];
    d.banner = typeof d.banner === 'string' && d.banner ? d.banner : null;
    d.maintenance = !!d.maintenance;
    d.plugins = (d.plugins && typeof d.plugins === 'object') ? d.plugins : {};
    d.cats = Array.isArray(d.cats) ? d.cats : [];
    d.catState = (d.catState && typeof d.catState === 'object') ? d.catState : {};
    d.catOrder = Array.isArray(d.catOrder) ? d.catOrder : [];
    d.lastStats = d.lastStats || null;
    d.lastIndexed = d.lastIndexed || null;
    d.notes = Array.isArray(d.notes) ? d.notes : [];
    Object.values(d.users || {}).forEach((u) => {
      u.warnings = Array.isArray(u.warnings) ? u.warnings : [];
      if (u.role == null) u.role = '';
      if (u.rank == null) u.rank = '';
      u.verified = !!u.verified;
      u.muffled = !!u.muffled;
      u.banned = !!u.banned;
      u.suspended = !!u.suspended;
      u.bannedUntil = typeof u.bannedUntil === 'number' ? u.bannedUntil : 0;
      if (u.banReason == null) u.banReason = '';
      u.saves = Array.isArray(u.saves) ? u.saves : [];
    });
    (d.threads || []).forEach((t) => {
      t.reports = Array.isArray(t.reports) ? t.reports : [];
      t.locked = !!t.locked; t.pinned = !!t.pinned; t.featured = !!t.featured;
      t.hidden = !!t.hidden; t.deleted = !!t.deleted;
      (t.replies || []).forEach((r) => {
        r.reports = Array.isArray(r.reports) ? r.reports : [];
        r.hidden = !!r.hidden; r.deleted = !!r.deleted;
      });
    });
    return d;
  }

  /* make sure the staff sign-in always exists and always works */
  function ensureAdmin() {
    const existing = db.accounts[ADMIN_EMAIL];
    let target = (existing && db.users[existing.userId]) ||
      Object.values(db.users).find((x) => x.role === 'admin') || null;
    if (!target) {
      const id = uid('u_admin');
      target = { id, name: 'Forum Admin', joined: Date.now(), bio: 'Staff account.', pfp: '', role: 'admin' };
      db.users[id] = target;
    }
    target.role = 'admin';
    target.banned = false;
    target.suspended = false;
    target.bannedUntil = 0;
    target.muffled = false;
    const keepSalt = existing && existing.hash === hashPass(ADMIN_PASS, existing.salt) && existing.salt;
    const salt = keepSalt || uid('s');
    db.accounts[ADMIN_EMAIL] = {
      email: ADMIN_EMAIL,
      salt,
      hash: hashPass(ADMIN_PASS, salt),
      userId: target.id,
      created: (existing && existing.created) || Date.now(),
    };
    defaults(db);
  }

  function load() {
    for (const key of [KEY, LEGACY_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const d = migrate(JSON.parse(raw));
          if (d && d.users) {
            if (key !== KEY) save(d); // keep the current key canonical
            return d;
          }
        }
      } catch (e) { /* corrupted data — fall through */ }
    }
    const fresh = defaults(seed());
    save(fresh);
    return fresh;
  }

  let db = load();

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data || db));
    } catch (e) {
      toast('⚠️ Could not save your changes');
    }
  }

  /* a signed-out visitor starts with no session until they sign in */
  if (db.currentUserId && !db.users[db.currentUserId]) db.currentUserId = null;
  db.prefs = db.prefs || { named: false };
  db.accounts = (db.accounts && typeof db.accounts === 'object') ? db.accounts : {};
  ensureAdmin();

  /* ---------------- state helpers ---------------- */

  const ui = { draft: '', replyTo: null, lastPath: null, cSort: 'best', collapsed: new Set() };
  const me = () => db.users[db.currentUserId];
  const user = (id) => db.users[id] || { id, name: 'Deleted user', joined: Date.now() };
  const community = (id) => allCats().find((c) => c.id === id) ||
    { id, name: id, icon: '•', desc: '', locked: false };
  const thread = (id) => db.threads.find((t) => t.id === id);
  const lastActivity = (t) => t.replies.reduce((max, r) => Math.max(max, r.created), t.created);

  const score = (item) => (item.up ? item.up.length : 0) - (item.down ? item.down.length : 0);
  const voteState = (item) => {
    if (item.up && item.up.includes(db.currentUserId)) return 'up';
    if (item.down && item.down.includes(db.currentUserId)) return 'down';
    return '';
  };
  const ageHours = (item) => (Date.now() - item.created) / HOUR;
  const hotRank = (item) => score(item) / Math.pow(ageHours(item) + 2, 0.75);

  function stats(id) {
    let k = 0, up = 0, down = 0, posts = 0, comments = 0;
    db.threads.forEach((t) => {
      if (t.author === id) {
        posts++; k += score(t);
        up += (t.up || []).length; down += (t.down || []).length;
      }
      (t.replies || []).forEach((r) => {
        if (r.author === id) {
          comments++; k += score(r);
          up += (r.up || []).length; down += (r.down || []).length;
        }
      });
    });
    return {
      karma: k, posts, comments,
      rating: up + down ? Math.round((up / (up + down)) * 100) : null,
    };
  }
  const karma = (id) => stats(id).karma;

  /* ---------------- moderation state ---------------- */

  const isAdmin = () => { const u = me(); return !!u && u.role === 'admin'; };
  const isStaff = () => { const u = me(); return !!u && (u.role === 'admin' || u.role === 'mod'); };
  const myGroup = () => (me() && me().role) || 'member';

  const allCats = () => {
    const merged = COMMUNITIES.concat(db.cats).map(
      (c) => Object.assign({}, c, db.catState[c.id] || {}));
    if (!db.catOrder.length) return merged;
    const pos = (id) => { const i = db.catOrder.indexOf(id); return i < 0 ? 1e9 : i; };
    return merged.slice().sort((a, b) => pos(a.id) - pos(b.id));
  };

  const canRead = (catId) => {
    if (isAdmin()) return true;
    const st = db.catState[catId] || {};
    return (st.perms && st.perms[myGroup()]) !== 'none';
  };

  const canWrite = (catId) => {
    if (!me()) return false;
    if (isAdmin()) return true;
    const st = db.catState[catId] || {};
    return ((st.perms && st.perms[myGroup()]) || 'write') === 'write';
  };

  const catLocked = (catId) => !!(db.catState[catId] || {}).locked;
  const canPost = (catId) => canWrite(catId) && (isStaff() || !catLocked(catId));
  const canReplyTo = (t) => !!t && canWrite(t.cat) && (isStaff() || !t.locked);

  /* why an account can't sign in or post right now — null when it's fine */
  function statusOf(u) {
    if (!u) return null;
    if (u.banned) {
      return { kind: 'banned', msg: u.banReason
        ? 'This account is banned — ' + u.banReason
        : 'This account was banned by moderators.' };
    }
    if (u.suspended) {
      return { kind: 'suspended', msg: 'This account is frozen while staff finish a review.' };
    }
    if (u.bannedUntil && u.bannedUntil > Date.now()) {
      return { kind: 'tempban', msg: 'This account is suspended until ' +
        new Date(u.bannedUntil).toLocaleString() + '.' };
    }
    return null;
  }

  const badges = (u) => {
    if (!u) return '';
    let s = '';
    if (u.verified) s += `<span class="badge verified" title="Verified">✓</span>`;
    if (u.role === 'admin') s += `<span class="badge role admin" title="Administrator">admin</span>`;
    else if (u.role === 'mod') s += `<span class="badge role mod" title="Moderator">mod</span>`;
    if (u.rank) s += `<span class="badge rank" title="Rank">${esc(u.rank)}</span>`;
    return s;
  };

  const isSaved = (id) => {
    const u = me();
    return !!(u && Array.isArray(u.saves) && u.saves.includes(id));
  };

  const stChips = (item) => {
    let s = '';
    if (item.pinned) s += `<span class="st-chip pin" title="Pinned">📌 pinned</span>`;
    if (item.featured) s += `<span class="st-chip feat" title="Featured">⭐ featured</span>`;
    if (item.locked) s += `<span class="st-chip lock" title="Locked">🔒 locked</span>`;
    if (item.hidden) s += `<span class="st-chip hid" title="Hidden">🙈 hidden</span>`;
    if (item.deleted) s += `<span class="st-chip del" title="Deleted">🗑 deleted</span>`;
    if (item.poll) s += `<span class="st-chip poll" title="Poll">📊 poll</span>`;
    return s;
  };

  /* finders the moderation console leans on */
  const findUser = (key) => {
    const k = String(key || '').trim();
    if (!k) return null;
    if (db.users[k]) return db.users[k];
    const nk = k.toLowerCase();
    const exact = Object.values(db.users).find((x) => x.name.toLowerCase() === nk);
    if (exact) return exact;
    const loose = Object.values(db.users).filter((x) => x.name.toLowerCase().includes(nk));
    return loose.length === 1 ? loose[0] : null;
  };

  const findThreadAny = (key) => {
    const k = String(key || '').trim();
    if (!k) return null;
    const exact = db.threads.find((t) => t.id === k);
    if (exact) return exact;
    const hits = db.threads.filter((t) => t.id.startsWith(k));
    return hits.length === 1 ? hits[0] : null;
  };

  const findReplyAny = (key) => {
    const k = String(key || '').trim();
    if (!k) return null;
    let exact = null;
    const hits = [];
    db.threads.forEach((t) => t.replies.forEach((r) => {
      if (r.id === k) exact = { t, r };
      else if (r.id.startsWith(k)) hits.push({ t, r });
    }));
    return exact || (hits.length === 1 ? hits[0] : null);
  };

  const findItem = (key) => {
    const t = findThreadAny(key);
    if (t) return { kind: 'thread', t };
    const f = findReplyAny(key);
    if (f) return { kind: 'reply', t: f.t, r: f.r };
    return null;
  };

  const findCat = (key) => {
    const k = String(key || '').trim().toLowerCase().replace(/^~\/?/, '');
    if (!k) return null;
    const list = allCats();
    return list.find((c) => c.id.toLowerCase() === k) ||
      list.find((c) => c.name.toLowerCase() === k) ||
      list.find((c) => c.id.toLowerCase().startsWith(k)) ||
      list.find((c) => c.name.toLowerCase().startsWith(k)) ||
      null;
  };

  const parseDur = (s) => {
    const m = String(s || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
    if (!m) return 0;
    const units = {
      s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3,
      m: 60e3, min: 60e3, mins: 60e3, minute: 60e3, minutes: 60e3,
      h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
      d: DAY, day: DAY, days: DAY, w: 7 * DAY, week: 7 * DAY, weeks: 7 * DAY,
    };
    const mult = units[m[2] || 'd'];
    const duration = mult ? Math.round(parseFloat(m[1]) * mult) : 0;
    return Number.isSafeInteger(duration) && duration > 0 &&
      Number.isFinite(new Date(Date.now() + duration).getTime()) ? duration : 0;
  };

  /* staff actions are recorded for /viewlogs */
  /* inbox notifications (replies, karma milestones) */
  function notify(to, text, href) {
    if (!to || !db.users[to]) return;
    db.notes.unshift({
      id: uid('n'), to, text: String(text).slice(0, 140),
      href: href || '#/', at: Date.now(), read: false,
    });
    if (db.notes.length > 60) db.notes.length = 60;
  }

  function audit(cmd, detail) {
    db.audit.unshift({
      at: Date.now(), by: db.currentUserId || 'system',
      cmd, detail: String(detail || '').slice(0, 160),
    });
    if (db.audit.length > 400) db.audit.length = 400;
  }

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

  /* ---------------- chrome ---------------- */

  function renderHeader() {
    const u = me();
    $('#userChip').innerHTML = u
      ? avatar(u, 26) +
        `<span class="name">${esc(u.name)}</span>` +
        (u.role ? `<span class="badge role ${esc(u.role)}" title="${u.role === 'admin' ? 'Administrator' : 'Moderator'}">${esc(u.role)}</span>` : '') +
        `<span class="karma" title="karma">${fmtNum(karma(u.id))}</span>`
      : `${icon('user')}<span class="name">Sign in</span>`;
    $('#userChip').setAttribute('aria-label', u ? 'Your profile' : 'Sign in');
    $('#userChip').title = u ? 'Your profile' : 'Sign in';
    const isLight = document.documentElement.dataset.theme === 'light';
    $('#themeBtn').innerHTML = icon(isLight ? 'moon' : 'sun');
    $('#themeBtn').setAttribute('aria-label', `Switch to ${isLight ? 'dark' : 'light'} theme`);

    const unread = db.notes.filter((n) => n.to === db.currentUserId && !n.read).length;
    const bellCount = $('#bellCount');
    if (bellCount) {
      bellCount.textContent = unread > 9 ? '9+' : String(unread);
      bellCount.classList.toggle('hidden', !unread);
      $('#bellBtn').classList.toggle('has-notes', !!unread);
    }
    const panel = $('#notePanel');
    if (panel) {
      const mine = db.notes.filter((n) => n.to === db.currentUserId);
      panel.innerHTML = !db.currentUserId
        ? '<div class="note-empty">Sign in to get reply &amp; karma alerts.</div>'
        : !mine.length
          ? '<div class="note-empty">No notifications yet — you are all caught up.</div>'
          : mine.slice(0, 12).map((n) => `
            <button class="note-item${n.read ? '' : ' unread'}" data-action="note-open" data-id="${n.id}">
              <span class="note-dot" aria-hidden="true"></span>
              <span class="note-text">${esc(n.text)}</span>
              <span class="note-when">${fmtTime(n.at)}</span>
            </button>`).join('');
    }
  }

  function renderNavCats(q, path) {
    const catId = q.get('cat');
    const counts = {};
    allCats().forEach((c) => (counts[c.id] = 0));
    const posts = visibleThreads();
    posts.forEach((t) => { if (counts[t.cat] != null) counts[t.cat]++; });
    const onFeed = path === '/' || path === '';

    $('#navCats').innerHTML = `
      <a class="nav-cat ${onFeed && !catId ? 'active' : ''}" href="#/" ${onFeed && !catId ? 'aria-current="page"' : ''}>
        ${icon('grid')} <span>All discussions</span><span class="nav-count">${posts.length}</span></a>
      ${allCats().filter((c) => canRead(c.id)).map((c) => `
        <a class="nav-cat ${onFeed && catId === c.id ? 'active' : ''}" href="#/?cat=${encodeURIComponent(c.id)}"
           ${onFeed && catId === c.id ? 'aria-current="page"' : ''} title="${esc(c.desc)}">${categoryIcon(c.id)} <span>${esc(c.name)}</span><span class="nav-count">${counts[c.id]}</span></a>`).join('')}`;
  }

  function renderAbout() {
    const posts = db.threads.length;
    const comments = db.threads.reduce((n, t) => n + t.replies.length, 0);
    const members = Object.keys(db.users).length;
    const counts = {};
    allCats().forEach((c) => (counts[c.id] = 0));
    db.threads.forEach((t) => { if (counts[t.cat] != null) counts[t.cat]++; });

    $('#main').innerHTML = `
      <section class="card about-hero">
        <div class="about-logo">&gt;_</div>
        <h1>bashForum</h1>
        <p class="tagline">A community for shell tinkerers, script addicts and prompt customizers — share configs, trade aliases, debug together.</p>
        <div class="about-stats">
          <div><b>${fmtNum(members)}</b><span>Members</span></div>
          <div><b>${fmtNum(posts)}</b><span>Posts</span></div>
          <div><b>${fmtNum(comments)}</b><span>Comments</span></div>
        </div>
      </section>

      <div class="about-grid">
        <section class="card about-sec">
          <h3>ℹ️ About this forum</h3>
          <p>bashForum is a place to talk shell: dotfiles, scripts, prompts and the tiny ergonomics that make a terminal feel like home. Post a question, share a snippet, or just lurk — every community below is open.</p>
          <div class="comm-list">
            ${allCats().map((c) => `
              <a class="comm-item" href="#/?cat=${c.id}">
                <span class="ci-icon">${c.icon}</span>
                <span>
                  <span class="ci-name">~/${c.id}</span><br>
                  <span class="ci-desc">${esc(c.desc)}</span>
                </span>
                <span class="ci-count">${counts[c.id]}</span>
              </a>`).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-head">Forum Rules</div>
          <ol class="rules">
            <li><b>Be kind.</b> Every expert was once confused by <code>grep</code>.</li>
            <li><b>Search first.</b> Your answer may already be one thread over.</li>
            <li><b>Show your work.</b> Paste the command, the output and what you expected.</li>
            <li><b>No spam.</b> Share code and context, not links for links' sake.</li>
            <li><b>Keep it terminal-adjacent.</b> Off-Topic exists for the rest.</li>
          </ol>
        </section>
      </div>

      <section class="card credits">
        <div class="card-head">Credits</div>
        <div class="made-by">Made by</div>
        <div class="credit-badge">
          <span class="cb-mark">&gt;_</span>
          <span class="cb-name">Tanishq Lalwani<span>Design &amp; Development</span></span>
        </div>
        <p class="credit-note">bashForum was designed and built from scratch — interface, styling and everything in between. Thanks for hanging out in our corner of the terminal.</p>
        <button class="btn btn-ghost btn-sm" data-action="reset">Reset forum</button>
        <div class="about-foot">bashForum — talk shell. © 2026</div>
      </section>`;
  }

  /* ---------------- feed ---------------- */

  function voteColumn(item, kind, tid) {
    const v = voteState(item);
    const s = score(item);
    const idAttr = kind === 'thread' ? `data-id="${item.id}"` : `data-id="${item.id}" data-tid="${tid}"`;
    return `
      <div class="vote-col">
        <button class="vbtn up ${v === 'up' ? 'on' : ''}" data-action="vote" data-dir="up"
                data-kind="${kind}" ${idAttr} title="Upvote" aria-label="Upvote">▲</button>
        <span class="score ${s > 0 ? 'pos' : s < 0 ? 'neg' : ''}">${fmtNum(s)}</span>
        <button class="vbtn down ${v === 'down' ? 'on' : ''}" data-action="vote" data-dir="down"
                data-kind="${kind}" ${idAttr} title="Downvote" aria-label="Downvote">▼</button>
      </div>`;
  }

  function miniVote(item, kind, tid) {
    const v = voteState(item);
    const s = score(item);
    const idAttr = kind === 'thread' ? `data-id="${item.id}"` : `data-id="${item.id}" data-tid="${tid}"`;
    return `
      <span class="mini-vote">
        <button class="mv up ${v === 'up' ? 'on' : ''}" data-action="vote" data-dir="up"
                data-kind="${kind}" ${idAttr} title="Upvote" aria-label="Upvote">▲</button>
        <b class="score ${s > 0 ? 'pos' : s < 0 ? 'neg' : ''}">${fmtNum(s)}</b>
        <button class="mv down ${v === 'down' ? 'on' : ''}" data-action="vote" data-dir="down"
                data-kind="${kind}" ${idAttr} title="Downvote" aria-label="Downvote">▼</button>
      </span>`;
  }

  function postRow(t) {
    const a = user(t.author);
    const mine = t.author === db.currentUserId;
    const excerpt = plain(t.body).slice(0, 240);
    const canFlag = !!db.currentUserId && !mine;

    return `
      <article class="post-row" data-action="open" data-href="#/t/${t.id}">
        ${voteColumn(t, 'thread')}
        <div class="post-main">
          <div class="post-meta">
            ${avatar(a, 22)}
            <a class="comm-pill" href="#/?cat=${t.cat}" data-action="open" data-href="#/?cat=${t.cat}">${esc(community(t.cat).name)}</a>
            <span class="dot">•</span>
            <a class="author" href="#/user/${t.author}" data-action="open" data-href="#/user/${t.author}">${esc(a.name)}</a>${badges(a)}
            <span class="dot">•</span>
            <span>${fmtTime(t.created)}</span>
            ${stChips(t)}
          </div>
          <h2 class="post-title"><a href="#/t/${t.id}">${esc(t.title)}</a></h2>
          <p class="excerpt">${esc(excerpt)}${t.body.length > 240 ? '…' : ''}</p>
          ${t.tags.length ? `<div class="feed-tags">${t.tags.map(tagChip).join('')}</div>` : ''}
          <div class="post-foot">
            <a class="foot-item" href="#/t/${t.id}" data-action="open" data-href="#/t/${t.id}">
              ${icon('chat')} ${t.replies.length} ${t.replies.length === 1 ? 'comment' : 'comments'}
            </a>
            <button class="foot-item" data-action="share" data-id="${t.id}">${icon('share')} Share</button>
            <button class="foot-item save-post${isSaved(t.id) ? ' saved' : ''}" data-action="save" data-id="${t.id}" aria-label="${isSaved(t.id) ? 'Unsave' : 'Save'} post">${icon('bookmark')}<span>${isSaved(t.id) ? 'Saved' : 'Save'}</span></button>
            ${canFlag ? `<button class="foot-item" data-action="report" data-kind="thread" data-id="${t.id}">⚑ Report</button>` : ''}
            ${mine ? `<button class="foot-item danger" data-action="del-thread" data-id="${t.id}">Delete</button>` : ''}
          </div>
        </div>
      </article>`;
  }

  function leaderboardStrip() {
    const top = Object.values(db.users)
      .map((u) => ({ u, k: karma(u.id) }))
      .sort((a, b) => b.k - a.k)
      .slice(0, 3);
    if (!top.length) return '';
    return `
      <section class="card lb-card">
        <div class="card-head">🏆 Top members</div>
        <div class="lb-row">
          ${top.map((x, i) => `
            <a class="lb-item" href="#/user/${x.u.id}">
              <span class="lb-rank">#${i + 1}</span>
              ${avatar(x.u, 26)}
              <span class="lb-name">${esc(x.u.name)}</span>
              <span class="lb-k">${fmtNum(x.k)} ✦</span>
            </a>`).join('')}
        </div>
      </section>`;
  }

  /* ---------------- views ---------------- */

  function renderHome(params) {
    const catId = params.get('cat');
    const sort = SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'hot';
    const q = (params.get('q') || '').trim().toLowerCase();

    let list = db.threads.filter((t) =>
      (catId ? t.cat === catId : true) &&
      !t.deleted && (!t.hidden || isStaff()) && canRead(t.cat));

    if (q) {
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q.replace(/^#/, ''))) ||
        user(t.author).name.toLowerCase().includes(q) ||
        t.replies.some((r) => r.body.toLowerCase().includes(q) || user(r.author).name.toLowerCase().includes(q)));
    }

    if (sort === 'rising') list = list.filter((t) => ageHours(t) <= 72);

    const cmp = {
      hot:    (a, b) => hotRank(b) - hotRank(a),
      new:    (a, b) => b.created - a.created,
      top:    (a, b) => score(b) - score(a) || lastActivity(b) - lastActivity(a),
      rising: (a, b) => score(b) - score(a) || lastActivity(b) - lastActivity(a),
    }[sort];
    list = list.slice().sort((a, b) =>
      ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) ||
      ((b.featured ? 1 : 0) - (a.featured ? 1 : 0)) ||
      cmp(a, b));

    const c = catId ? community(catId) : null;

    const tabs = SORTS.map((s) => {
      const p = new URLSearchParams(params);
      p.set('sort', s.id);
      return `<a class="tab ${sort === s.id ? 'active' : ''}" href="${homeHash(p)}" ${sort === s.id ? 'aria-current="true"' : ''}>
                ${icon(s.icon)}${s.label}
              </a>`;
    }).join('');

    const posts = visibleThreads();
    const members = Object.keys(db.users).length;
    const totalComments = posts.reduce((n, x) => n + x.replies.length, 0);
    const topicCounts = new Map();
    posts.forEach((t) => t.tags.forEach((tag) => topicCounts.set(tag, (topicCounts.get(tag) || 0) + 1)));
    const topics = [...topicCounts].sort((a, b) => b[1] - a[1]).slice(0, 6);

    $('#main').innerHTML = `
      <div class="page-eyebrow"><span>THE COMMUNITY</span><span class="eyebrow-path">~/ ${c ? esc(c.id) : 'home'}</span></div>
      <section class="feed-hero${q || c ? ' contextual-hero' : ''}">
        <div class="hero-body">
          <div class="hero-kicker"><span class="status-dot"></span> A home for the terminally curious</div>
          <h1>${q ? `Find your next <span>aha moment.</span>` : c ? esc(c.name) : 'Your people.<br>Your <span>command line.</span>'}</h1>
          <p class="hero-sub">${q ? `Searching discussions for “${esc(params.get('q'))}”` : c ? esc(c.desc) : 'Share a script. Find an answer. Make your terminal feel a little more like home.'}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#/new">Start a discussion ${icon('arrow')}</a>
            <a class="hero-about" href="#/about">Meet the community <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <div class="hero-terminal" aria-hidden="true">
          <div class="terminal-top"><span class="terminal-dots"><i></i><i></i><i></i></span><span>you@bashforum: ~</span>${icon('terminal')}</div>
          <div class="terminal-content">
            <div><span class="terminal-green">❯</span> whoami</div>
            <div class="terminal-output">a tinkerer. a builder. one of us.</div>
            <div class="terminal-command"><span class="terminal-green">❯</span> cat community.sh</div>
            <div><span class="terminal-purple">while</span> curious; <span class="terminal-purple">do</span></div>
            <div class="terminal-indent">learn <span class="terminal-dim">&amp;&amp;</span> share <span class="terminal-dim">&amp;&amp;</span> grow</div>
            <div><span class="terminal-purple">done</span></div>
            <div class="terminal-command"><span class="terminal-green">❯</span> <span class="caret">▍</span></div>
          </div>
          <div class="terminal-bottom"><span class="status-dot"></span> endless possibilities. zero dependencies.</div>
        </div>
      </section>

      <div class="home-columns">
        <section class="discussions" aria-label="Discussions">
          <div class="feed-heading"><h2>${q ? 'Search results' : c ? esc(c.name) : 'All discussions'}</h2><span>${list.length} ${list.length === 1 ? 'discussion' : 'discussions'}</span></div>
          <div class="feed-toolbar"><nav class="tabs" aria-label="Sort discussions">${tabs}</nav><span class="feed-view" title="Discussion view" aria-hidden="true">${icon('grid')}</span></div>
          ${list.length
            ? `<div class="feed">${list.map(postRow).join('')}</div>`
            : `<div class="empty">
                <div class="empty-icon">${icon('search')}</div>
                <h3>${q ? 'No matches this time' : sort === 'rising' ? 'A quiet moment' : 'Start something good'}</h3>
                <p>${q ? 'Try another keyword, or explore all discussions.' : 'Your next question could start a great conversation.'}</p>
                <a class="btn btn-primary" href="${q ? '#/' : '#/new'}">${q ? 'Explore discussions' : 'Create a post'}</a>
              </div>`}
          <div class="feed-end"><span>&gt;_</span> ${list.length ? "You're all caught up. Go make something." : 'Every great idea starts with a question.'}</div>
        </section>
        <aside class="community-rail" aria-label="Community information">
          <section class="card community-card">
            <div class="rail-heading"><span class="rail-mark">&gt;_</span><h2>A small corner.<br>Big shell energy.</h2></div>
            <p>For shell tinkerers, script lovers, and anyone who's ever spent too long on their prompt.</p>
            <div class="community-stats"><div><b>${fmtNum(members)}</b><span>members</span></div><div><b>${fmtNum(posts.length)}</b><span>discussions</span></div><div><b>${fmtNum(totalComments)}</b><span>replies</span></div></div>
            <a class="rail-link" href="#/about">Get to know bashForum ${icon('arrow')}</a>
          </section>
          ${db.plugins.leaderboard ? leaderboardStrip() : ''}
          ${topics.length ? `<section class="card topics-card"><h2>${icon('trend')} Around the terminal</h2><p>Find your next rabbit hole.</p><div class="topic-list">${topics.map(([tag, count]) => `<a href="#/?q=${encodeURIComponent('#' + tag)}"><span>#${esc(tag)}</span><span>${count} ${count === 1 ? 'post' : 'posts'} ${icon('arrow')}</span></a>`).join('')}</div></section>` : ''}
          <section class="rail-guidelines"><h2>${icon('sparkles')} Good people. Good conversations.</h2><p>Be curious. Be kind. Share what you know.<br>Every expert was a beginner once.</p><a href="#/about">Our community guidelines <span aria-hidden="true">↗</span></a></section>
        </aside>
      </div>`;
  }

  /* ---------------- poll rendering ---------------- */

  function renderPoll(t) {
    const p = t.poll;
    if (!p || !Array.isArray(p.opts) || !p.opts.length) return '';
    const meId = db.currentUserId;
    const total = p.opts.reduce((n, o) => n + ((o.voters || []).length), 0);
    const votedIdx = meId ? p.opts.findIndex((o) => (o.voters || []).includes(meId)) : -1;
    const voted = votedIdx >= 0;
    return `
      <div class="poll" data-tid="${t.id}">
        <div class="poll-q">📊 ${esc(p.q)}</div>
        ${p.opts.map((o, i) => {
          const n = (o.voters || []).length;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return voted
            ? `<div class="poll-opt${i === votedIdx ? ' mine' : ''}">
                 <div class="poll-bar" style="width:${pct}%"></div>
                 <span class="poll-label">${esc(o.text)}</span>
                 <span class="poll-pct">${pct}%</span>
               </div>`
            : `<button type="button" class="poll-opt pick" data-action="poll-vote" data-i="${i}">${esc(o.text)}</button>`;
        }).join('')}
        <div class="poll-foot">${voted
          ? `${total} vote${total === 1 ? '' : 's'} · you voted “${esc(p.opts[votedIdx].text)}”`
          : `${total} vote${total === 1 ? '' : 's'} · pick one`}</div>
      </div>`;
  }

  function renderThread(id) {
    const t = thread(id);
    if (!t || !canRead(t.cat) || ((t.deleted || t.hidden) && !isStaff())) {
      $('#main').innerHTML = `
        <div class="empty"><div class="big">🕳️</div><h3>Post not found</h3>
        <p>It may have been removed.</p>
        <a class="btn btn-primary" href="#/">Back to the feed</a></div>`;
      return;
    }

    const a = user(t.author);
    const mine = t.author === db.currentUserId;

    const byParent = {};
    t.replies.forEach((r) => {
      const key = r.parent || 'root';
      (byParent[key] = byParent[key] || []).push(r);
    });

    const countKids = (id) => (byParent[id] || []).reduce((n, k) => n + 1 + countKids(k.id), 0);
    const conRatio = (r) => {
      const u = (r.up || []).length;
      const d = (r.down || []).length;
      return Math.max(u, d) ? Math.min(u, d) / Math.max(u, d) : 0;
    };
    const cmpBy = {
      new: (x, y) => y.created - x.created,
      top: (x, y) => (score(y) - score(x)) || (y.created - x.created),
      best: (x, y) => (score(y) * 2 + countKids(y.id) * 3 - score(x) * 2 - countKids(x.id) * 3) ||
        (y.created - x.created),
      controversial: (x, y) => (conRatio(y) - conRatio(x)) ||
        (Math.abs(score(x)) - Math.abs(score(y))) || (y.created - x.created),
    };
    const cmpComments = cmpBy[ui.cSort] || cmpBy.best;
    Object.values(byParent).forEach((arr) => arr.sort(cmpComments));

    const renderComment = (r) => {
      const ru = user(r.author);
      const kids = byParent[r.id] || [];
      const own = r.author === db.currentUserId;

      if (r.deleted && !isStaff()) return '';

      if (r.hidden && !isStaff()) {
        return `
          <div class="comment hidden-note" id="reply-${r.id}">
            <div class="c-head">
              ${avatar(ru, 22)}
              <b>${esc(ru.name)}</b>${badges(ru)}
              <span class="when">· hidden</span>
            </div>
            <div class="c-hidden">🙈 This comment was hidden by moderators.</div>
            ${kids.length ? `<div class="c-kids">${kids.map(renderComment).join('')}</div>` : ''}
          </div>`;
      }

      const collapsed = ui.collapsed.has(r.id);
      const kc = kids.length ? countKids(r.id) : 0;
      return `
        <div class="comment${collapsed ? ' is-folded' : ''}" id="reply-${r.id}">
          <div class="c-head">
            ${avatar(ru, 22)}
            <a class="author" href="#/user/${r.author}">${esc(ru.name)}</a>${badges(ru)}
            <span class="when">· ${fmtTime(r.created)}</span>
            ${stChips(r)}
            ${miniVote(r, 'reply', t.id)}
          </div>
          <div class="c-body">${md(r.body)}</div>
          <div class="c-actions">
            ${mayReply ? `<button class="link-btn" data-action="reply-to" data-id="${r.id}" data-name="${esc(ru.name)}">↩ Reply</button>` : ''}
            ${kids.length ? `<button class="link-btn" data-action="fold" data-id="${r.id}">▾ Fold${kc ? ' (' + kc + ')' : ''}</button>` : ''}
            ${own ? `<button class="link-btn danger" data-action="del-reply" data-id="${r.id}" data-tid="${t.id}">Delete</button>` : ''}
            ${!own ? `<button class="link-btn" data-action="report" data-kind="reply" data-id="${r.id}" data-tid="${t.id}">⚑ Report</button>` : ''}
          </div>
          ${kids.length ? (collapsed
            ? `<button class="c-fold" data-action="fold" data-id="${r.id}">▸ ${kc} ${kc === 1 ? 'reply hidden' : 'replies hidden'} — click to expand</button>`
            : `<div class="c-kids">${kids.map(renderComment).join('')}</div>`) : ''}
        </div>`;
    };

    const mayReply = canReplyTo(t);
    const roots = (byParent.root || []).map(renderComment).join('');
    const replyTarget = ui.replyTo ? t.replies.find((r) => r.id === ui.replyTo) : null;
    const n = t.replies.length;

    $('#main').innerHTML = `
      <a class="back-link" href="${homeHash(new URLSearchParams('cat=' + t.cat))}">← ~/${t.cat}</a>

      <div class="thread-layout">
        ${voteColumn(t, 'thread')}
        <div class="thread-body">
          <article class="card post">
            <div class="post-head">
              <div class="who">
                <b>${esc(a.name)}</b>${badges(a)}
                <span>~/${t.cat} · posted ${fmtTime(t.created)}</span>
              </div>
              <div class="actions">
                ${mine ? `<button class="btn btn-danger btn-sm" data-action="del-thread" data-id="${t.id}">Delete</button>` : ''}
              </div>
            </div>

            <h1 class="post-title">${esc(t.title)}</h1>
            ${stChips(t) ? `<div class="st-row">${stChips(t)}</div>` : ''}
            ${t.tags.length ? `<div class="post-tags">${t.tags.map(tagChip).join('')}</div>` : ''}
            <div class="post-body">${md(t.body)}</div>
            ${t.poll ? renderPoll(t) : ''}

            <div class="post-foot solid">
              <span class="foot-item">💬 ${n} ${n === 1 ? 'Comment' : 'Comments'}</span>
              <button class="foot-item" data-action="share">⤴ Share</button>
              ${db.currentUserId ? `<button class="foot-item${isSaved(t.id) ? ' saved' : ''}" data-action="save" data-id="${t.id}">${isSaved(t.id) ? '🔖 Saved' : '🔖 Save'}</button>` : ''}
              ${mayReply ? `<button class="foot-item" data-action="focus-comment">↩ Reply</button>` : ''}
            </div>
          </article>

          ${mayReply ? `
          <form class="card composer" id="replyForm" data-tid="${t.id}">
            <div class="composer-head">
              ${avatar(me(), 26)}
              <span>Comment as <b>${esc(me().name)}</b>${badges(me())}</span>
              ${replyTarget
                ? `<span class="chip">replying to ${esc(user(replyTarget.author).name)}</span>
                   <button type="button" class="link-btn" data-action="cancel-reply">✕</button>`
                : ''}
            </div>
            <textarea name="body" id="replyBody" rows="3" placeholder="Add a comment…">${esc(ui.draft)}</textarea>
            <div class="composer-foot">
              <span class="hint">Markdown: \`code\`, **bold**, blank line = new paragraph</span>
              <button class="btn btn-primary" type="submit">Comment</button>
            </div>
          </form>` : `
          <div class="card lock-note">${t.locked
            ? '🔒 This conversation is locked — no new comments.'
            : !me() ? 'Join the conversation. <button class="link-btn" data-action="auth-open">Sign in to leave a reply →</button>'
            : "You don't have permission to comment in this board."}</div>`}

          <div class="comments-head">
            <span>${n} ${n === 1 ? 'Comment' : 'Comments'}</span>
            <span class="c-sortbar">
              ${[['best', 'Best'], ['top', 'Top'], ['new', 'New'], ['controversial', 'Controversial']]
                .map(([k, lbl]) => `<button type="button" class="c-sort${ui.cSort === k ? ' active' : ''}" data-action="c-sort" data-sort="${k}" aria-pressed="${ui.cSort === k}">${lbl}</button>`)
                .join('')}
            </span>
          </div>
          <div class="comments">
            ${roots || `<div class="empty"><div class="big">💬</div><h3>No comments yet</h3>
                        <p>Say something — the first comment always matters most.</p></div>`}
          </div>
        </div>
      </div>`;

    const box = $('#replyBody');
    if (box) {
      box.addEventListener('input', () => { ui.draft = box.value; });
      box.style.height = 'auto';
      box.style.height = Math.min(box.scrollHeight, 320) + 'px';
    }
  }

  function renderNew(params) {
    const cats = allCats();
    let preCat = params.get('cat');
    if (!preCat || !canPost(preCat)) {
      preCat = (cats.find((c) => canPost(c.id)) || cats[0] || { id: 'general' }).id;
    }
    const muted = !!(me() && me().muffled);
    $('#main').innerHTML = `
      <a class="back-link" href="#/">← Back to the feed</a>
      <div class="page-head"><div>
        <h1>Create a post</h1>
        <div class="sub">Posting as ${esc(me().name)}${badges(me())}</div>
        ${muted ? '<div class="muted-warn">🔇 You are muffled — you can read, but not post.</div>' : ''}
      </div></div>

      <form class="card form" id="newThreadForm">
        <div class="field">
          <label for="nt-title">Title</label>
          <input class="input" id="nt-title" name="title" maxlength="140" placeholder="What is this post about?" required autofocus />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="nt-cat">Community</label>
            <select class="input" id="nt-cat" name="cat">
              ${cats.map((c) => {
                const ok = canPost(c.id);
                return `<option value="${c.id}" ${c.id === preCat && ok ? 'selected' : ''} ${ok ? '' : 'disabled'}>${c.icon} ~/${c.id}${c.locked ? ' 🔒' : ''}${ok ? '' : ' — no access'}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="field">
            <label for="nt-tags">Flairs <span style="color:var(--faint);font-weight:500">(optional)</span></label>
            <input class="input" id="nt-tags" name="tags" maxlength="80" placeholder="bash, help, meta" />
            <div class="help">Comma separated, up to 4.</div>
          </div>
        </div>

        <div class="field">
          <label for="nt-body">Text</label>
          <textarea id="nt-body" name="body" rows="9" placeholder="Write your post…" required></textarea>
          <div class="help md-hint">Markdown: \`code\`, **bold**, *italic*, [links](https://example.com), \`\`\` fenced blocks. Blank line = new paragraph.</div>
          <button type="button" class="btn btn-ghost btn-sm md-prev-btn" data-action="md-preview">👁 Preview</button>
          <div class="md-preview hidden" id="ntPreview"></div>
        </div>

        <div class="field">
          <button type="button" class="btn btn-ghost btn-sm" data-action="poll-toggle" id="pollToggle">📊 Add a poll (optional)</button>
          <div class="poll-fields hidden" id="pollFields">
            <label for="nt-pollq">Question</label>
            <input class="input" id="nt-pollq" name="pollq" maxlength="120" placeholder="Which alias saves your day?" />
            <label for="nt-pollopts">Options <span style="color:var(--faint);font-weight:500">(2–4, one per line)</span></label>
            <textarea id="nt-pollopts" name="pollopts" rows="4" placeholder="mkcd&#10;ll -la&#10;cd -"></textarea>
          </div>
        </div>

        <div class="form-actions">
          <a class="btn btn-ghost" href="#/">Cancel</a>
          <button class="btn btn-primary" type="submit">Post</button>
        </div>
      </form>`;

    const ntBody = $('#nt-body');
    if (ntBody) ntBody.addEventListener('input', () => {
      const prev = $('#ntPreview');
      if (prev && !prev.classList.contains('hidden')) {
        prev.innerHTML = ntBody.value.trim()
          ? md(ntBody.value)
          : '<span class="dim-note">Nothing to preview yet.</span>';
      }
    });
  }

  function renderUser(id) {
    const u = db.users[id];
    if (!u) {
      $('#main').innerHTML = `<div class="empty"><div class="big">👤</div><h3>User not found</h3>
        <p>This profile does not exist.</p>
        <a class="btn btn-primary" href="#/">Back to the feed</a></div>`;
      return;
    }

    const mine = u.id === db.currentUserId;
    const readable = visibleThreads();
    const started = readable.filter((t) => t.author === u.id).sort((a, b) => b.created - a.created);
    const saved = mine
      ? (u.saves || []).map((id) => readable.find((t) => t.id === id)).filter(Boolean)
      : [];
    const s = stats(u.id);
    const joined = new Date(u.joined).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const handle = 'u/' + u.name.toLowerCase().replace(/\s+/g, '').slice(0, 24);

    $('#main').innerHTML = `
      ${mine ? '' : `<a class="back-link" href="#/">← Back to the feed</a>`}

      <div class="card profile-card">
        ${avatar(u, 64)}
        <div class="info">
          <h1>${esc(u.name)}${badges(u)}${mine ? ' <span class="tag">you</span>' : ''}</h1>
          <div class="sub">${esc(handle)} · joined ${joined}</div>
          <p class="bio ${u.bio ? '' : 'empty-bio'}">${u.bio
            ? esc(u.bio)
            : mine ? 'Add a description of yourself below.' : 'No description yet.'}</p>
        </div>
        <div class="stats">
          <div><b class="unit">${fmtNum(s.karma)}</b><span>Karma</span></div>
          <div><b>${s.rating === null ? '—' : s.rating + '%'}</b><span title="Upvote ratio">Rating</span></div>
          <div><b>${s.posts}</b><span>Posts</span></div>
          <div><b>${s.comments}</b><span>Comments</span></div>
        </div>
      </div>

      ${mine ? `
        <form class="card form" id="editProfileForm">
          <div class="field-row">
            <div class="field">
              <label for="ep-name">Username</label>
              <input class="input" id="ep-name" name="name" maxlength="32" value="${esc(u.name)}" />
            </div>
            <div class="field">
              <label>Profile picture</label>
              <div class="pfp-preview">
                <span class="pfp-frame">${avatar(u, 46)}</span>
                <div class="pfp-btns">
                  <label class="btn btn-ghost btn-sm" for="ep-pfp">📤 Upload image</label>
                  ${u.pfp ? `<button class="btn btn-ghost btn-sm" type="button" data-action="pfp-remove">Remove</button>` : ''}
                </div>
              </div>
              <input class="file-input" type="file" id="ep-pfp" accept="image/png,image/jpeg,image/webp,image/gif" />
              <div class="help">PNG, JPG or WebP — cropped square and resized automatically.</div>
            </div>
          </div>
          <div class="field">
            <label for="ep-bio">Description</label>
            <textarea id="ep-bio" name="bio" rows="2" maxlength="180" placeholder="Tell the forum about yourself…">${esc(u.bio || '')}</textarea>
          </div>
          <div class="form-actions">
            <button class="btn btn-ghost" type="button" data-action="logout">Log out</button>
            <button class="btn btn-primary" type="submit">Save profile</button>
          </div>
        </form>` : ''}

      ${(mine || isStaff()) && u.warnings.length ? `
        <div class="section-title">Infractions</div>
        <div class="card infract-card">
          <ul class="infractions">
            ${u.warnings.map((wr) => `
              <li><b>${esc(wr.reason)}</b>
                <span>${new Date(wr.at).toLocaleString()} · issued by ${esc(user(wr.by).name)}</span></li>`).join('')}
          </ul>
        </div>` : ''}

      ${mine && u.muffled
        ? '<div class="card lock-note">🔇 You are muffled — you can read, but not post.</div>' : ''}

      ${saved.length ? `
        <div class="section-title">🔖 Saved</div>
        <div class="feed">${saved.map(postRow).join('')}</div>` : ''}

      <div class="section-title">Posts by ${esc(u.name)}</div>
      ${started.length
        ? `<div class="feed">${started.map(postRow).join('')}</div>`
        : `<div class="empty"><div class="big">📝</div><h3>No posts yet</h3><p>${esc(u.name)} has not posted anything.</p></div>`}`;
  }

  /* ---------------- render ---------------- */

  function renderBanner() {
    const el = $('#siteBanner');
    if (!el) return;
    if (db.banner) {
      el.className = 'site-banner';
      el.innerHTML = `<span aria-hidden="true">📣</span><span>${esc(db.banner)}</span>`;
    } else if (db.maintenance && isAdmin()) {
      el.className = 'site-banner warn';
      el.innerHTML = `<span aria-hidden="true">🛠</span><span>Maintenance mode is on — visitors see an offline screen. <code>/maintenance off</code> restores access.</span>`;
    } else {
      el.className = 'site-banner hidden';
      el.innerHTML = '';
    }
  }

  function renderMaintenance() {
    $('#main').innerHTML = `
      <div class="empty maint-card">
        <div class="big">🔧</div>
        <h3>Maintenance in progress</h3>
        <p>We are performing scheduled updates. Check back in a few minutes.</p>
      </div>`;
  }

  function renderBlocked(u, st) {
    $('#main').innerHTML = `
      <div class="empty blocked-card">
        <div class="big">⛔</div>
        <h3>Access suspended</h3>
        <p>${esc(st.msg)}</p>
        ${u.warnings && u.warnings.length
          ? `<p class="dim-note">${u.warnings.length} infraction${u.warnings.length === 1 ? '' : 's'} on file.</p>`
          : ''}
        <div class="btn-row">
          <button class="btn btn-ghost" data-action="logout">Sign out</button>
          <a class="btn btn-primary" href="#/about">Read the rules</a>
        </div>
      </div>`;
  }

  function render() {
    clearTimeout(searchTimer);
    const { path, q } = parse();
    renderHeader();
    renderNavCats(q, path);
    renderBanner();

    const u = me();
    const maint = db.maintenance && !isAdmin();
    const held = !!u && !isAdmin() && !!statusOf(u);
    const authModal = $('#authModal');
    let special = false;

    if (maint) {
      /* offline for everyone but admins */
      special = true;
      renderMaintenance();
      closeAuth();
    } else if (!u && (path === '/new' || path === '/profile')) {
      /* Reading is open; creating and personal profiles require an account. */
      renderHome(q);
      openAuth();
    } else if (held) {
      /* banned or suspended account */
      special = true;
      closeAuth();
      renderBlocked(u, statusOf(u));
    } else {
      if (!authModal.classList.contains('hidden')) closeAuth();

      if (path === '/' || path === '') renderHome(q);
      else if (path === '/about') renderAbout();
      else if (path === '/profile') renderUser(db.currentUserId);
      else if (path === '/new') renderNew(q);
      else if (path.startsWith('/t/')) renderThread(path.slice(3));
      else if (path.startsWith('/user/')) renderUser(path.slice(6));
      else $('#main').innerHTML = `<div class="empty"><div class="big">🧭</div><h3>Page not found</h3>
        <p>That URL does not exist here.</p><a class="btn btn-primary" href="#/">Back to the feed</a></div>`;
    }

    const view = special ? 'main'
      : path === '/about' ? 'about'
      : (path === '/profile' || path.startsWith('/user/')) ? 'profile'
      : 'main';
    const catSel = q.get('cat');
    const onFeed = path === '/' || path === '';
    document.querySelectorAll('.nav-tab').forEach((a) => {
      const isMain = a.dataset.view === 'main';
      const active = a.dataset.view === view && !(isMain && onFeed && catSel);
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const search = $('#search');
    if (document.activeElement !== search) search.value = q.get('q') || '';

    if (ui.lastPath !== null && ui.lastPath !== path) window.scrollTo({ top: 0 });
    ui.lastPath = path;
  }

  /* ---------------- actions ---------------- */

  let authOpener = null;
  function openAuth() {
    const modal = $('#authModal');
    if (!modal.classList.contains('hidden')) return;
    authOpener = document.activeElement;
    modal.classList.remove('hidden');
    document.body.classList.add('auth-open');
    document.querySelectorAll('.header, .layout, .site-foot, .site-banner').forEach((el) => { el.inert = true; });
    const input = modal.querySelector('.auth-form:not(.hidden) input');
    if (input) input.focus();
  }

  function closeAuth() {
    const modal = $('#authModal');
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    document.body.classList.remove('auth-open');
    document.querySelectorAll('[inert]').forEach((el) => { el.inert = false; });
    if (authOpener && authOpener.isConnected) authOpener.focus();
    else $('#main').focus();
  }

  $('#authModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('[data-action="auth-close"]').click();
  });
  $('#authModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      $('[data-action="auth-close"]').click();
    }
    if (e.key !== 'Tab') return;
    const controls = [...e.currentTarget.querySelectorAll('button, input')].filter((el) => el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function applyVote(kind, id, tid, dir) {
    if (!me()) { openAuth(); return; }
    const item = kind === 'thread'
      ? thread(id)
      : ((thread(tid) || {}).replies || []).find((r) => r.id === id);
    if (!item) return;

    if (!Array.isArray(item.up)) item.up = [];
    if (!Array.isArray(item.down)) item.down = [];
    const prevScore = score(item);

    const who = db.currentUserId;
    const bucket = dir === 'up' ? item.up : item.down;
    const other = dir === 'up' ? item.down : item.up;
    const at = bucket.indexOf(who);
    const oi = other.indexOf(who);

    if (at >= 0) bucket.splice(at, 1);        // click again → undo
    else {
      if (oi >= 0) other.splice(oi, 1);       // switch sides
      bucket.push(who);
    }

    if (kind === 'thread') {
      if (score(item) < 10) item.milestone10 = false;
      else if (!item.milestone10 && prevScore < 10 && who !== item.author) {
        item.milestone10 = true;
        notify(item.author, `“${plain(item.title).slice(0, 40)}” just passed +10 karma 🎉`, '#/t/' + item.id);
      }
    }

    save();
    render();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'skip-main') { e.preventDefault(); $('#main').focus(); return; }
    if (action === 'auth-open') { openAuth(); return; }
    if (action === 'auth-close') {
      closeAuth();
      const { path } = parse();
      if (!me() && (path === '/new' || path === '/profile')) location.hash = '#/';
      return;
    }
    if (action === 'kb-open') { openKb(); return; }
    if (!me() && ['save', 'poll-vote', 'report', 'reply-to', 'del-thread', 'del-reply', 'pfp-remove', 'reset'].includes(action)) {
      openAuth(); return;
    }

    if (action === 'auth-tab') {
      const which = el.dataset.which || 'login';
      document.querySelectorAll('.auth-tab').forEach((b) =>
        b.classList.toggle('active', b.dataset.which === which));
      $('#loginForm').classList.toggle('hidden', which !== 'login');
      $('#registerForm').classList.toggle('hidden', which !== 'register');
      $('#authErr').textContent = '';
      return;
    }

    if (action === 'cmd-open') { openCmd(); return; }
    if (action === 'cmd-close') { closeCmd(); return; }

    if (action === 'bell') {
      const panel = $('#notePanel');
      if (panel) panel.classList.toggle('hidden');
      return;
    }

    if (action === 'note-open') {
      const n = db.notes.find((x) => x.id === el.dataset.id);
      if (!n) return;
      n.read = true;
      save();
      const panel = $('#notePanel');
      if (panel) panel.classList.add('hidden');
      if (n.href) location.hash = n.href;
      render();
      return;
    }

    if (action === 'save') {
      if (!me()) { toast('Sign in to save posts'); return; }
      const u = me();
      u.saves = u.saves || [];
      const sIdx = u.saves.indexOf(el.dataset.id);
      if (sIdx >= 0) { u.saves.splice(sIdx, 1); toast('Removed from saved'); }
      else { u.saves.unshift(el.dataset.id); toast('Saved to your profile 🔖'); }
      save();
      render();
      return;
    }

    if (action === 'poll-vote') {
      if (!me()) { toast('Sign in to vote'); return; }
      const wrap = el.closest('.poll');
      const pThread = wrap && thread(wrap.dataset.tid);
      if (!pThread || !pThread.poll) return;
      if (pThread.poll.opts.some((o) => (o.voters || []).includes(db.currentUserId))) {
        toast('You already voted in this poll');
        return;
      }
      const pOpt = pThread.poll.opts[+el.dataset.i];
      if (!pOpt) return;
      (pOpt.voters = pOpt.voters || []).push(db.currentUserId);
      save();
      render();
      toast('Vote counted 📊');
      return;
    }

    if (action === 'poll-toggle') {
      const f = $('#pollFields');
      if (!f) return;
      const show = f.classList.contains('hidden');
      f.classList.toggle('hidden', !show);
      el.textContent = show ? '📊 Hide poll' : '📊 Add a poll (optional)';
      return;
    }

    if (action === 'kb-close') { closeKb(); return; }

    if (action === 'c-sort') { ui.cSort = el.dataset.sort || 'best'; render(); return; }

    if (action === 'fold') {
      const fid = el.dataset.id;
      if (ui.collapsed.has(fid)) ui.collapsed.delete(fid);
      else ui.collapsed.add(fid);
      render();
      return;
    }

    if (action === 'md-preview') {
      const prev = $('#ntPreview');
      const box = $('#nt-body');
      if (!prev || !box) return;
      const show = prev.classList.contains('hidden');
      if (show) {
        prev.innerHTML = box.value.trim()
          ? md(box.value)
          : '<span class="dim-note">Nothing to preview yet.</span>';
      }
      prev.classList.toggle('hidden', !show);
      el.textContent = show ? '🙈 Hide preview' : '👁 Preview';
      return;
    }

    if (action === 'report') {
      if (!db.currentUserId) { toast('Sign in to flag content'); return; }
      let item = null;
      if (el.dataset.kind === 'thread') item = thread(el.dataset.id);
      else {
        const parent = thread(el.dataset.tid);
        item = parent && parent.replies.find((r) => r.id === el.dataset.id);
      }
      if (!item) return;
      item.reports = item.reports || [];
      if (item.reports.some((rp) => rp.by === db.currentUserId)) { toast('You already flagged this'); return; }
      item.reports.push({ id: uid('rp'), by: db.currentUserId, at: Date.now(), reason: 'Flagged by a member' });
      save();
      toast('Flagged for staff review ✓');
      return;
    }

    if (action === 'logout') {
      db.currentUserId = null;
      save();
      location.hash = '#/';
      /* land back on the Sign in tab with a clean error line */
      $('#loginForm').classList.remove('hidden');
      $('#registerForm').classList.add('hidden');
      document.querySelectorAll('.auth-tab').forEach((b) =>
        b.classList.toggle('active', b.dataset.which === 'login'));
      $('#authErr').textContent = '';
      render();
      toast('Signed out');
      return;
    }

    if (action === 'pfp-remove') {
      me().pfp = '';
      save(); render(); toast('Picture removed');
      return;
    }

    if (action === 'theme') {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('bashforum.theme', next); } catch (err) {}
      db.prefs.theme = next;
      save();
      renderHeader();
    }

    if (action === 'me') { if (me()) location.hash = '#/profile'; else openAuth(); }

    if (action === 'open') {
      const anchor = e.target.closest('a');
      if (anchor) return;               // let real links navigate themselves
      location.hash = el.dataset.href;
    }

    if (action === 'vote') {
      applyVote(el.dataset.kind, el.dataset.id, el.dataset.tid, el.dataset.dir);
    }

    if (action === 'share') {
      const url = el.dataset.id ? new URL('#/t/' + el.dataset.id, location.href).href : location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url)
          .then(() => toast('Link copied'), () => toast('Could not copy link'));
      } else toast(url);
    }

    if (action === 'reply-to') {
      ui.replyTo = el.dataset.id;
      ui.draft = ui.draft || '@' + el.dataset.name + ' ';
      render();
      const box = $('#replyBody');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }

    if (action === 'cancel-reply') { ui.replyTo = null; render(); }

    if (action === 'focus-comment') {
      const box = $('#replyBody');
      if (box) { box.focus(); box.scrollIntoView({ block: 'center' }); }
    }

    if (action === 'del-thread') {
      if (confirm('Delete this post and all of its comments? This cannot be undone.')) {
        db.threads = db.threads.filter((t) => t.id !== el.dataset.id);
        save();
        if (location.hash.startsWith('#/t/')) location.hash = '#/';
        render();
        toast('Post deleted');
      }
    }

    if (action === 'del-reply') {
      const t = thread(el.dataset.tid);
      if (!t) return;
      const drop = new Set([el.dataset.id]);
      let grew = true;
      while (grew) {                          // take nested replies down with it
        grew = false;
        t.replies.forEach((r) => {
          if (r.parent && drop.has(r.parent) && !drop.has(r.id)) {
            drop.add(r.id); grew = true;
          }
        });
      }
      t.replies = t.replies.filter((r) => !drop.has(r.id));
      save(); render(); toast('Comment deleted');
    }

    if (action === 'reset') {
      if (confirm('Reset bashForum to its original content? All posts and comments will be removed.')) {
        try {
          localStorage.removeItem(KEY);
          localStorage.removeItem(LEGACY_KEY);
        } catch (err) {}
        location.hash = '#/';
        location.reload();
      }
    }
  });

  /* ---------------- forms ---------------- */

  document.addEventListener('submit', (e) => {
    const form = e.target;

    if (form.id === 'loginForm') {
      e.preventDefault();
      const fd = new FormData(form);
      const email = normEmail(fd.get('email'));
      const pass = String(fd.get('password') || '');
      const acc = db.accounts[email];
      if (!acc) { authError('No account found with that email'); return; }
      if (acc.hash !== hashPass(pass, acc.salt)) { authError('Incorrect password'); return; }
      const target = db.users[acc.userId];
      const held = target && statusOf(target);
      if (held) { authError(held.msg); return; }
      db.currentUserId = acc.userId;
      db.prefs.named = true;
      save();
      form.reset();
      render();
      toast('Welcome back, ' + user(acc.userId).name + '!');
      return;
    }

    if (form.id === 'registerForm') {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim().slice(0, 32);
      const email = normEmail(fd.get('email'));
      const pass = String(fd.get('password') || '');
      if (!name) { authError('Choose a display name'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authError('Enter a valid email address'); return; }
      if (pass.length < 6) { authError('Password must be at least 6 characters'); return; }
      if (db.accounts[email]) { authError('That email is already registered — use Sign in'); return; }

      const id = uid('u');
      const salt = uid('s');
      db.users[id] = { id, name, joined: Date.now(), bio: '', pfp: '' };
      db.accounts[email] = { email, salt, hash: hashPass(pass, salt), userId: id, created: Date.now() };
      defaults(db);
      db.currentUserId = id;
      db.prefs.named = true;
      save();
      form.reset();
      render();
      toast('Welcome to bashForum, ' + name + '!');
      return;
    }

    if (['editProfileForm', 'newThreadForm', 'replyForm'].includes(form.id) && !me()) {
      e.preventDefault(); openAuth(); return;
    }

    if (form.id === 'editProfileForm') {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim().slice(0, 32);
      const bio = String(fd.get('bio') || '').trim().slice(0, 180);
      if (!name) { toast('Username is required'); return; }
      me().name = name;
      me().bio = bio;
      save(); render(); toast('Profile updated');
      return;
    }

    if (form.id === 'newThreadForm') {
      e.preventDefault();
      const fd = new FormData(form);
      const title = String(fd.get('title') || '').trim();
      const body = String(fd.get('body') || '').trim();
      if (!title || !body) { toast('Title and text are required'); return; }

      const author = me();
      const heldPost = statusOf(author);
      if (heldPost) { toast('Your account is suspended'); return; }
      if (author.muffled) { toast("You're muffled — reading is fine, posting is not"); return; }
      const cat = String(fd.get('cat') || 'general');
      if (!canPost(cat)) {
        toast(catLocked(cat) ? 'That board is locked for new topics' : "You don't have permission to post there");
        return;
      }

      const tags = String(fd.get('tags') || '')
        .split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean).slice(0, 4);

      const t = {
        id: uid('t'),
        title: title.slice(0, 140),
        body,
        cat,
        author: db.currentUserId,
        tags,
        created: Date.now(),
        up: [], down: [],
        replies: [],
      };
      const pollQ = String(fd.get('pollq') || '').trim();
      const pollOpts = String(fd.get('pollopts') || '').split(/\r?\n/)
        .map((s) => s.trim()).filter(Boolean).slice(0, 4);
      let pollNote = '';
      if (pollQ && pollOpts.length >= 2) {
        t.poll = {
          q: pollQ.slice(0, 120),
          opts: pollOpts.map((text) => ({ text: text.slice(0, 60), voters: [] })),
        };
      } else if (pollQ || pollOpts.length) {
        pollNote = ' — poll skipped (needs a question and 2–4 options)';
      }
      db.threads.unshift(t);
      save();
      location.hash = '#/t/' + t.id;
      toast('Post published 🎉'.replace(' 🎉', pollNote ? pollNote : ' 🎉'));
      return;
    }

    if (form.id === 'replyForm') {
      e.preventDefault();
      const body = String(new FormData(form).get('body') || '').trim();
      const t = thread(form.dataset.tid);
      if (!body || !t) { toast('Write something first'); return; }

      const commenter = me();
      const heldReply = statusOf(commenter);
      if (heldReply) { toast('Your account is suspended'); return; }
      if (commenter.muffled) { toast("You're muffled — reading is fine, commenting is not"); return; }
      if (!canReplyTo(t)) {
        toast(t.locked ? 'This thread is locked' : "You don't have permission to comment here");
        return;
      }

      const newRid = uid('r');
      t.replies.push({
        id: newRid,
        parent: ui.replyTo && t.replies.some((r) => r.id === ui.replyTo) ? ui.replyTo : null,
        author: db.currentUserId,
        body,
        created: Date.now(),
        up: [], down: [],
      });
      if (t.author !== db.currentUserId) {
        notify(t.author, `${user(db.currentUserId).name} commented on “${plain(t.title).slice(0, 40)}”`, '#/t/' + t.id);
      }
      const parentId = (t.replies.find((r) => r.id === newRid) || {}).parent;
      if (parentId) {
        const pr = t.replies.find((r) => r.id === parentId);
        if (pr && pr.author !== db.currentUserId && pr.author !== t.author) {
          notify(pr.author, `${user(db.currentUserId).name} replied to your comment`, '#/t/' + t.id);
        }
      }
      ui.draft = '';
      ui.replyTo = null;
      save();
      render();
      toast('Comment posted');
      const added = t.replies[t.replies.length - 1];
      const el = added && $('#reply-' + added.id);
      if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); }
    }
  });

  /* ---------------- profile picture upload ---------------- */

  function readPfp(file) {
    if (!file || !String(file.type).startsWith('image/')) { toast('Please choose an image file'); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('⚠️ Could not read that file');
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => toast('⚠️ That image could not be processed');
      img.onload = () => {
        try {
          const MAX = 192;
          const iw = img.naturalWidth || img.width;
          const ih = img.naturalHeight || img.height;
          const side = Math.min(iw, ih);
          const c = document.createElement('canvas');
          c.width = c.height = MAX;
          const ctx = c.getContext('2d');
          if (!ctx) { toast('⚠️ Could not process that image'); return; }
          ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, MAX, MAX);
          let data = '';
          try { data = c.toDataURL('image/webp', 0.82); } catch (err) { data = ''; }
          if (!/^data:image\/webp/.test(data)) data = c.toDataURL('image/jpeg', 0.85);
          me().pfp = data;
          save(); render(); toast('Picture updated 📷');
        } catch (err) {
          toast('⚠️ Could not process that image');
        }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el && el.id === 'ep-pfp' && el.files && el.files[0]) {
      readPfp(el.files[0]);
      el.value = '';
    }
  });

  /* ---------------- live search ---------------- */

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    const value = e.target.value.trim();
    const { path, q } = parse();
    if (path !== '/' && path !== '') return;   // only filter while on the feed

    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (value) q.set('q', value); else q.delete('q');
      history.replaceState(null, '', homeHash(q));
      ui.lastPath = path;                       // keep scroll position while typing
      render();
      const input = $('#search');
      input.focus();
      // Search inputs do not support setSelectionRange; the focused value is unchanged.
    }, 140);
  });

  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = e.target.value.trim();
      location.hash = homeHash(new URLSearchParams(v ? 'q=' + encodeURIComponent(v) : ''));
      e.target.blur();
    }
    if (e.key === 'Escape') {
      clearTimeout(searchTimer);
      e.target.value = '';
      e.target.blur();
      const { path, q } = parse();
      if (path === '/' || path === '') {
        q.delete('q');
        history.replaceState(null, '', homeHash(q));
        render();
      }
    }
  });

  /* ---------------- moderation console ---------------- */

  const cmdState = { greeted: false, hist: [], hi: -1 };

  function cmdOut(text, cls) {
    const log = $('#cmdLog');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'cmd-line' + (cls ? ' ' + cls : '');
    line.textContent = String(text);
    log.appendChild(line);
    while (log.children.length > 260) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function openCmd() {
    const m = $('#cmdModal');
    if (!m) return;
    const opening = m.classList.contains('hidden');
    m.classList.remove('hidden');
    if (opening) {
      if (!cmdState.greeted) {
        cmdState.greeted = true;
        cmdOut('bashForum moderation console — /help lists every command.', 'info');
      }
      if (isAdmin()) cmdOut('✓ Signed in with an admin account — commands allowed.', 'info');
      else cmdOut('⛔ Admin access required — sign in with the staff account to run commands.', 'err');
    }
    const inp = $('#cmdInput');
    if (inp) setTimeout(() => inp.focus(), 40);
  }

  function closeCmd() {
    const m = $('#cmdModal');
    if (m) m.classList.add('hidden');
    const inp = $('#cmdInput');
    if (inp) inp.blur();
  }

  const tokenize = (s) => {
    const out = [];
    let cur = '';
    let q = '';
    for (const ch of String(s)) {
      if (q) {
        if (ch === q) q = '';
        else cur += ch;
      } else if (ch === '"' || ch === "'") q = ch;
      else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };

  const NO_AUDIT = new Set(['help', 'commands', 'version']);

  function runCommand(raw) {
    const str = String(raw || '').trim();
    if (!str) return;
    cmdOut('❯ ' + str, 'cmd-echo');

    const body = str.replace(/^\s*\/+/, '');
    const m = body.match(/^(\S+)\s*/);
    const name = m ? body.slice(0, m[0].length).trim() : body;
    const rest = m ? body.slice(m[0].length) : '';
    const key = name.toLowerCase();
    const spec = COMMANDS[key];

    if (!spec) {
      cmdOut('✗ Unknown command: /' + name + ' — try /help', 'err');
      return;
    }
    if (!isAdmin()) {
      cmdOut('⛔ Admin access required — sign in with the staff account to run commands.', 'err');
      audit(key, 'denied — not an admin');
      save();
      return;
    }

    const c = {
      a: tokenize(rest),
      rest,
      usage: spec.usage,
      out: (t, cls) => cmdOut(t, cls || 'ok'),
      info: (t) => cmdOut(t, 'info'),
      err: (t) => cmdOut('✗ ' + t, 'err'),
    };
    try {
      spec.run(c);
    } catch (err) {
      cmdOut('⚠ Command failed: ' + (err && err.message ? err.message : err), 'err');
    }
    if (!NO_AUDIT.has(key)) audit(key, rest);
    save();
    render();
  }

  /* ---- console argument helpers ---- */

  const usageErr = (c) => { c.err('Usage: ' + c.usage); };

  /* longest exact id/name match first, so multi-word names + trailing args work */
  function takeUser(c) {
    if (!c.a.length) { usageErr(c); return null; }
    for (let n = Math.min(5, c.a.length); n >= 1; n--) {
      const key = c.a.slice(0, n).join(' ');
      const u = db.users[key] ||
        Object.values(db.users).find((x) => x.name.toLowerCase() === key.toLowerCase());
      if (u) return { u, tail: c.a.slice(n) };
    }
    const u = findUser(c.a[0]);
    if (!u) { c.err('No user matches "' + c.a.join(' ') + '"'); return null; }
    return { u, tail: c.a.slice(1) };
  }

  const needUser = (c) => { const t = takeUser(c); return t ? t.u : null; };

  const needThread = (c, i = 0) => {
    const k = c.a[i];
    if (!k) { usageErr(c); return null; }
    const t = findThreadAny(k);
    if (!t) { c.err('No thread matches "' + k + '"'); return null; }
    return t;
  };

  const needReply = (c) => {
    const k = c.a[0];
    if (!k) { usageErr(c); return null; }
    const f = findReplyAny(k);
    if (!f) { c.err('No comment matches "' + k + '"'); return null; }
    return f;
  };

  const needItem = (c, i = 0) => {
    const k = c.a[i];
    if (!k) { usageErr(c); return null; }
    const it = findItem(k);
    if (!it) { c.err('No post or comment matches "' + k + '"'); return null; }
    return it;
  };

  const needCat = (c, i = 0) => {
    const k = c.a[i];
    if (!k) { usageErr(c); return null; }
    const cat = findCat(k);
    if (!cat) { c.err('No board matches "' + k + '"'); return null; }
    return cat;
  };

  const staffProtected = (c, u) => {
    if (u.role === 'admin') { c.err('The admin account is protected.'); return false; }
    return true;
  };

  const allItems = () => {
    const out = [];
    db.threads.forEach((t) => { out.push(t); (t.replies || []).forEach((r) => out.push(r)); });
    return out;
  };

  /* Keep large result sets readable without overflowing the console log. */
  const cmdList = (c, title, rows) => {
    c.info(title + ' (' + rows.length + '):');
    if (!rows.length) { c.info('  No matches.'); return; }
    rows.slice(0, 50).forEach((row) => c.info('  ' + row));
    if (rows.length > 50) c.info('  … ' + (rows.length - 50) + ' more; showing the first 50.');
  };

  const itemFlags = (it) => ['deleted', 'hidden', 'locked', 'pinned', 'featured']
    .filter((key) => it[key]).map((key) => '[' + key + ']').join(' ');
  const itemLine = (it) => it.id + ' · ' + user(it.author).name + ' · ' +
    plain(it.title || it.body).slice(0, 90) + (itemFlags(it) ? ' ' + itemFlags(it) : '');
  const newestFirst = (items) => items.slice().sort((a, b) => b.created - a.created);
  const userLine = (u) => u.id + ' · ' + u.name + ' · ' + (u.role || 'member') +
    (statusOf(u) ? ' [' + statusOf(u).kind + ']' : '') + (u.muffled ? ' [muffled]' : '');
  const itemFrom = (it) => it.kind === 'thread' ? it.t : it.r;
  const commandMatches = (name, spec, query) =>
    [name, spec.group, spec.usage, spec.desc].join(' ').toLowerCase().includes(query);

  function commandText(c, words, max) {
    const text = words.join(' ').trim();
    if (!text || text.length > max) {
      c.err('Usage: ' + c.usage + ' — text must be 1–' + max + ' characters.');
      return null;
    }
    return text;
  }

  function commandTags(c, text) {
    const tags = [];
    for (const part of text.split(',')) {
      const tag = part.trim().replace(/^#/, '').trim();
      if (!tag || tag.length > 20) {
        c.err('Tags must be 1–20 characters each, separated by commas.');
        return null;
      }
      if (!tags.some((x) => x.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    }
    if (tags.length > 4) { c.err('A thread can have at most 4 tags.'); return null; }
    return tags;
  }

  /* ---- the commands ---- */

  const COMMANDS = {};
  const def = (name, group, usage, desc, run) => { COMMANDS[name] = { group, usage, desc, run }; };

  /* Console */
  const helpRun = (c) => {
    const query = c.a.join(' ').toLowerCase().replace(/^\//, '');
    const matches = Object.entries(COMMANDS).filter(([name, s]) => commandMatches(name, s, query));
    c.out('bashForum moderation commands — ' + matches.length + ' of ' + Object.keys(COMMANDS).length, 'info');
    if (!matches.length) { c.info('No matching commands. Try /help without a filter.'); return; }
    ['Console', 'Users', 'Threads', 'Boards', 'Queue', 'System'].forEach((g) => {
      const rows = matches.filter(([, s]) => s.group === g);
      if (!rows.length) return;
      c.info('');
      c.info('  ' + g);
      rows.forEach(([, s]) => c.info('    ' + s.usage.padEnd(48) + s.desc));
    });
    c.info('');
    c.info('  Every command needs an admin sign-in.');
    c.info('  Use /help <group or keyword> to filter; quote names with spaces.');
  };
  def('help', 'Console', '/help [group or keyword]', 'List commands with usage, optionally filtered', helpRun);
  def('commands', 'Console', '/commands [group or keyword]', 'Same as /help', helpRun);
  def('version', 'Console', '/version', 'Show the running software version', (c) => {
    c.out('bashForum v1.0.0 · schema v' + (db.version || 1), 'info');
    c.info('   boards ' + allCats().length + ' · users ' + Object.keys(db.users).length +
      ' · accounts ' + Object.keys(db.accounts).length +
      ' · plugins ' + Object.keys(db.plugins).length);
  });

  def('clear', 'Console', '/clear', 'Clear console output without deleting the audit log', (c) => {
    const log = $('#cmdLog');
    if (log) log.textContent = '';
    c.out('Console cleared. Audit entries and command history are unchanged.');
  });

  def('history', 'Console', '/history', 'Show commands entered in this console session', (c) => {
    cmdList(c, 'Session history (newest first)', cmdState.hist.slice().reverse());
  });

  def('whoami', 'Console', '/whoami', 'Show the signed-in profile and role', (c) => {
    c.info(userLine(me()));
  });

  def('findcommand', 'Console', '/findcommand <query>', 'Find commands by name, group, or description', (c) => {
    const query = c.a.join(' ').trim().toLowerCase().replace(/^\//, '');
    if (!query) { usageErr(c); return; }
    cmdList(c, 'Matching commands', Object.entries(COMMANDS)
      .filter(([name, spec]) => commandMatches(name, spec, query))
      .map(([, spec]) => spec.usage + ' — ' + spec.desc));
  });

  def('go', 'Console', '/go <thread_id>', 'Open a thread and close the console', (c) => {
    const t = needThread(c);
    if (!t) return;
    if (t.deleted) { c.err('This thread is deleted. Use /restore ' + t.id + ' first.'); return; }
    location.hash = '#/t/' + t.id;
    c.out('Opening ' + t.id + '.');
    closeCmd();
  });

  def('search', 'Console', '/search <query>', 'Search the discussion feed and close the console', (c) => {
    const query = c.a.join(' ').trim();
    if (!query) { usageErr(c); return; }
    location.hash = homeHash(new URLSearchParams({ q: query }));
    c.out('Searching the feed for “' + query + '”.');
    closeCmd();
  });

  /* Users */
  def('ban', 'Users', '/ban <user> [reason]', 'Permanently block a user from the forum', (c) => {
    const t = takeUser(c);
    if (!t || !staffProtected(c, t.u)) return;
    if (t.u.banned) { c.info(t.u.name + ' is already banned.'); return; }
    t.u.banned = true;
    t.u.bannedUntil = 0;
    t.u.suspended = false;
    t.u.banReason = t.tail.join(' ').slice(0, 160);
    c.out('⛔ ' + t.u.name + ' is permanently banned' + (t.u.banReason ? ' — ' + t.u.banReason : '') + '.');
  });

  def('unban', 'Users', '/unban <user>', 'Restore a banned user’s access', (c) => {
    const u = needUser(c);
    if (!u) return;
    const had = u.banned || u.bannedUntil;
    u.banned = false;
    u.banReason = '';
    u.bannedUntil = 0;
    c.out(had ? '✅ ' + u.name + ' can sign in again.' : u.name + ' was not banned.');
  });

  def('tempban', 'Users', '/tempban <user> <duration>', 'Suspend an account for a set time (30m, 12h, 7d)', (c) => {
    const t = takeUser(c);
    if (!t || !staffProtected(c, t.u)) return;
    const d = parseDur(t.tail[0]);
    if (!d) { c.err('Usage: ' + c.usage + '  — e.g. /tempban sam 7d'); return; }
    t.u.bannedUntil = Date.now() + d;
    t.u.banned = false;
    t.u.suspended = false;
    c.out('⏳ ' + t.u.name + ' suspended until ' + new Date(t.u.bannedUntil).toLocaleString() + '.');
  });

  def('muffle', 'Users', '/muffle <user>', 'Mute posting rights (run again to unmuffle)', (c) => {
    const u = needUser(c);
    if (!u) return;
    u.muffled = !u.muffled;
    c.out(u.muffled
      ? '🔇 ' + u.name + ' is muffled — can read but not post. Run again to unmuffle.'
      : '🔊 ' + u.name + ' can post again.');
  });

  def('warn', 'Users', '/warn <user> [reason]', 'Issue an official infraction notice', (c) => {
    const t = takeUser(c);
    if (!t) return;
    const reason = t.tail.join(' ').slice(0, 160) || 'No reason given';
    t.u.warnings.unshift({ at: Date.now(), by: db.currentUserId, reason });
    c.out('⚠ Warning issued to ' + t.u.name + ': ' + reason +
      ' (total: ' + t.u.warnings.length + ')');
  });

  def('warnhistory', 'Users', '/warnhistory <user>', 'Show every infraction on a profile', (c) => {
    const u = needUser(c);
    if (!u) return;
    if (!u.warnings.length) { c.out('No infractions on record for ' + u.name + '.'); return; }
    c.out('Infractions for ' + u.name + ' (' + u.warnings.length + '):', 'info');
    u.warnings.forEach((wr, i) => c.info('  ' + (i + 1) + '. ' + new Date(wr.at).toLocaleString() +
      ' — ' + wr.reason + ' (issued by ' + user(wr.by).name + ')'));
  });

  def('suspend', 'Users', '/suspend <user>', 'Freeze an account during an investigation', (c) => {
    const u = needUser(c);
    if (!u || !staffProtected(c, u)) return;
    if (u.suspended) { c.info(u.name + ' is already suspended.'); return; }
    u.suspended = true;
    c.out('🧊 ' + u.name + '’s account is frozen — sign-in blocked until /approve ' + u.name + '.');
  });

  def('approve', 'Users', '/approve <user> | /approve post <id>',
    'Lift a suspension, or clear a flagged post', (c) => {
    if ((c.a[0] || '').toLowerCase() === 'post') {
      const it = needItem(c, 1);
      if (!it) return;
      const item = it.kind === 'thread' ? it.t : it.r;
      item.reports = [];
      item.hidden = false;
      item.deleted = false;
      c.out('✅ ' + item.id + ' approved — back in public view.');
      return;
    }
    const u = needUser(c);
    if (!u) return;
    if (!u.suspended) { c.info(u.name + ' has no pending hold — nothing to approve.'); return; }
    u.suspended = false;
    c.out('✅ ' + u.name + ' is approved — sign-in restored.');
  });

  def('deleteuser', 'Users', '/deleteuser <user>', 'Purge a profile and its sign-in account', (c) => {
    const u = needUser(c);
    if (!u || !staffProtected(c, u)) return;
    const posts = db.threads.filter((t) => t.author === u.id).length;
    let accs = 0;
    Object.keys(db.accounts).forEach((k) => {
      if (db.accounts[k].userId === u.id) { delete db.accounts[k]; accs++; }
    });
    delete db.users[u.id];
    c.out('🗑 Purged ' + u.name + ' — account removed (' + accs + ' sign-in' +
      (accs === 1 ? '' : 's') + '), ' + posts + ' post' + (posts === 1 ? '' : 's') +
      ' now show as “Deleted user”.');
  });

  def('anonymize', 'Users', '/anonymize <user>', 'Strip personal data, keep the posts', (c) => {
    const u = needUser(c);
    if (!u || !staffProtected(c, u)) return;
    const posts = db.threads.filter((t) => t.author === u.id).length;
    u.name = 'Anonymous';
    u.bio = '';
    u.pfp = '';
    u.rank = '';
    u.verified = false;
    let newEmail = null;
    Object.keys(db.accounts).forEach((k) => {
      const acc = db.accounts[k];
      if (acc.userId === u.id) {
        delete db.accounts[k];
        newEmail = 'anon' + Math.random().toString(36).slice(2, 8) + '@removed.local';
        db.accounts[newEmail] = Object.assign({}, acc, { email: newEmail });
      }
    });
    c.out('🕵 Profile anonymized — name, bio and picture cleared; ' + posts +
      ' post' + (posts === 1 ? '' : 's') + ' preserved.');
    if (newEmail) c.info('   Sign-in email is now ' + newEmail + ' (password unchanged).');
  });

  def('setrole', 'Users', '/setrole <user> <member|mod|admin>', 'Assign a permission group', (c) => {
    const t = takeUser(c);
    if (!t) return;
    const raw = (t.tail[0] || '').toLowerCase();
    const map = { member: '', mem: '', mod: 'mod', moderator: 'mod', admin: 'admin', administrator: 'admin' };
    if (!(raw in map)) { c.err('Usage: ' + c.usage + '  — groups: member, mod, admin'); return; }
    if (t.u.id === db.currentUserId) { c.err('You cannot change your own role.'); return; }
    const next = map[raw];
    if (t.u.role === 'admin' && next !== 'admin' &&
        Object.values(db.users).filter((x) => x.role === 'admin').length <= 1) {
      c.err('There must always be at least one admin.');
      return;
    }
    t.u.role = next;
    c.out('🛡 ' + t.u.name + ' is now ' +
      (next === 'admin' ? 'an admin' : next === 'mod' ? 'a moderator' : 'a regular member') + '.');
  });

  def('changerank', 'Users', '/changerank <user> <rank>', 'Set a custom title next to the name', (c) => {
    const t = takeUser(c);
    if (!t) return;
    const rank = t.tail.join(' ').slice(0, 48);
    if (!rank) { c.err('Usage: ' + c.usage); return; }
    t.u.rank = rank;
    c.out('🎖 ' + t.u.name + '’s rank is now “' + t.u.rank + '”.');
  });

  def('verify', 'Users', '/verify <user>', 'Grant the verified badge', (c) => {
    const u = needUser(c);
    if (!u) return;
    if (u.verified) { c.info(u.name + ' is already verified.'); return; }
    u.verified = true;
    c.out('✓ ' + u.name + ' is now verified.');
  });

  def('resetpassword', 'Users', '/resetpassword <user>', 'Force a password reset for a locked-out user', (c) => {
    const u = needUser(c);
    if (!u) return;
    const entry = Object.values(db.accounts).find((a) => a.userId === u.id);
    if (!entry) { c.err(u.name + ' has no sign-in account (only registered emails can reset).'); return; }
    const tmp = Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
    const salt = uid('s');
    entry.salt = salt;
    entry.hash = hashPass(tmp, salt);
    c.out('🔑 Forced reset for ' + u.name + '. Temporary password: ' + tmp);
    c.info('   Shown once — hand it over through a trusted channel.');
  });

  def('ipcheck', 'Users', '/IPcheck <user>', 'Show registered addresses for an account', (c) => {
    const u = needUser(c);
    if (!u) return;
    c.out('Network addresses for ' + u.name + ': none on record.', 'info');
    const entry = Object.values(db.accounts).find((a) => a.userId === u.id);
    c.info('   Contact on file: ' + (entry ? entry.email : '—') +
      ' · profile created ' + new Date(u.joined).toLocaleDateString());
  });

  def('users', 'Users', '/users [query]', 'List user IDs, names, roles, and account holds', (c) => {
    const query = c.a.join(' ').toLowerCase();
    const rows = Object.values(db.users).filter((u) =>
      (u.id + ' ' + u.name).toLowerCase().includes(query));
    cmdList(c, 'Users', rows.map(userLine));
  });

  def('userinfo', 'Users', '/userinfo <user>', 'Inspect a profile, restrictions, and contribution totals', (c) => {
    const u = needUser(c);
    if (!u) return;
    const s = stats(u.id);
    c.info(userLine(u));
    c.info('Joined: ' + new Date(u.joined).toLocaleString() + ' · verified: ' + u.verified);
    c.info('Rank: ' + (u.rank || 'none') + ' · bio: ' + (u.bio || 'none'));
    c.info('Posts: ' + s.posts + ' · comments: ' + s.comments + ' · karma: ' + s.karma);
    c.info('Warnings: ' + u.warnings.length + ' · saved threads: ' + u.saves.length);
    const held = statusOf(u);
    if (held) c.info(held.msg);
  });

  def('staff', 'Users', '/staff', 'List all administrators and moderators', (c) => {
    cmdList(c, 'Staff', Object.values(db.users)
      .filter((u) => u.role === 'admin' || u.role === 'mod').map(userLine));
  });

  def('bannedusers', 'Users', '/bannedusers', 'List active bans, temporary bans, and suspensions', (c) => {
    cmdList(c, 'Restricted accounts', Object.values(db.users).filter((u) => statusOf(u)).map(userLine));
  });

  def('mutedusers', 'Users', '/mutedusers', 'List accounts whose posting rights are muffled', (c) => {
    cmdList(c, 'Muffled accounts', Object.values(db.users).filter((u) => u.muffled).map(userLine));
  });

  def('unmuffle', 'Users', '/unmuffle <user>', 'Restore posting rights without toggling the mute', (c) => {
    const u = needUser(c);
    if (!u) return;
    u.muffled = false;
    c.out(u.name + ' is no longer muffled. Other account holds are unchanged.');
  });

  def('unverify', 'Users', '/unverify <user>', 'Remove a profile’s verified badge', (c) => {
    const u = needUser(c);
    if (!u) return;
    u.verified = false;
    c.out('Verified badge removed from ' + u.name + '.');
  });

  def('clearrank', 'Users', '/clearrank <user>', 'Remove a custom profile title', (c) => {
    const u = needUser(c);
    if (!u) return;
    u.rank = '';
    c.out('Custom rank cleared for ' + u.name + '.');
  });

  def('renameuser', 'Users', '/renameuser <user> <name>', 'Change a display name (2–32 characters, unique)', (c) => {
    const found = takeUser(c);
    if (!found) return;
    const name = commandText(c, found.tail, 32);
    if (name == null) return;
    if (name.length < 2) { c.err('Names must be at least 2 characters.'); return; }
    if (Object.values(db.users).some((u) => u.id !== found.u.id && u.name.toLowerCase() === name.toLowerCase())) {
      c.err('Another user already has that display name.'); return;
    }
    const old = found.u.name;
    found.u.name = name;
    c.out('Renamed ' + old + ' → ' + name + '. Sign-in credentials are unchanged.');
  });

  def('setbio', 'Users', '/setbio <user> <text>', 'Replace a profile bio (up to 180 characters)', (c) => {
    const found = takeUser(c);
    if (!found) return;
    const text = commandText(c, found.tail, 180);
    if (text == null) return;
    found.u.bio = text;
    c.out('Bio updated for ' + found.u.name + '.');
  });

  def('clearavatar', 'Users', '/clearavatar <user>', 'Remove a profile picture or emoji avatar', (c) => {
    const u = needUser(c);
    if (!u) return;
    u.pfp = '';
    c.out('Avatar removed for ' + u.name + '.');
  });

  def('userposts', 'Users', '/userposts <user>', 'List a user’s threads, including hidden/deleted ones', (c) => {
    const u = needUser(c);
    if (!u) return;
    cmdList(c, 'Threads by ' + u.name, newestFirst(db.threads.filter((t) => t.author === u.id)).map(itemLine));
  });

  def('usercomments', 'Users', '/usercomments <user>', 'List a user’s comments with their thread IDs', (c) => {
    const u = needUser(c);
    if (!u) return;
    const rows = [];
    db.threads.forEach((t) => t.replies.forEach((r) => {
      if (r.author === u.id) rows.push({ r, tid: t.id });
    }));
    rows.sort((a, b) => b.r.created - a.r.created);
    cmdList(c, 'Comments by ' + u.name, rows.map(({ r, tid }) => itemLine(r) + ' · thread ' + tid));
  });

  def('unwarn', 'Users', '/unwarn <user> <number>', 'Remove one warning by its /warnhistory number', (c) => {
    const found = takeUser(c);
    if (!found) return;
    const index = Number(found.tail[0]);
    if (found.tail.length !== 1 || !Number.isInteger(index) || index < 1 || index > found.u.warnings.length) {
      c.err('Usage: ' + c.usage + ' — choose a current /warnhistory number.'); return;
    }
    const removed = found.u.warnings.splice(index - 1, 1)[0];
    c.out('Warning removed for ' + found.u.name + ': ' + removed.reason);
  });

  /* Threads */
  def('lock', 'Threads', '/lock <thread_id>', 'Halt all new replies on a thread', (c) => {
    const t = needThread(c);
    if (!t) return;
    if (t.locked) { c.info(t.id + ' is already locked.'); return; }
    t.locked = true;
    c.out('🔒 ' + t.id + ' locked — no new replies.');
  });

  def('unlock', 'Threads', '/unlock <thread_id>', 'Re-open a locked thread', (c) => {
    const t = needThread(c);
    if (!t) return;
    const was = t.locked;
    t.locked = false;
    c.out(was ? '🔓 ' + t.id + ' is open again.' : t.id + ' was not locked.');
  });

  def('pin', 'Threads', '/pin <thread_id>', 'Fix a thread to the top of the feed', (c) => {
    const t = needThread(c);
    if (!t) return;
    if (t.pinned) { c.info(t.id + ' is already pinned.'); return; }
    t.pinned = true;
    c.out('📌 ' + t.id + ' pinned to the top.');
  });

  def('unpin', 'Threads', '/unpin <thread_id>', 'Return a thread to normal sorting', (c) => {
    const t = needThread(c);
    if (!t) return;
    const was = t.pinned;
    t.pinned = false;
    c.out(was ? '📍 ' + t.id + ' unpinned.' : t.id + ' was not pinned.');
  });

  def('sticky', 'Threads', '/sticky <thread_id>', 'Alternative name for /pin', (c) => {
    const t = needThread(c);
    if (!t) return;
    t.pinned = true;
    c.out('📌 ' + t.id + ' stuck to the top.');
  });

  def('move', 'Threads', '/move <thread_id> <board>', 'Relocate a topic to another board', (c) => {
    const t = needThread(c, 0);
    if (!t) return;
    const cat = needCat(c, 1);
    if (!cat) return;
    t.cat = cat.id;
    c.out('📦 Moved “' + plain(t.title).slice(0, 40) + '” → ~/' + cat.id + '.');
  });

  def('merge', 'Threads', '/merge <thread_1> <thread_2>', 'Combine two threads into one', (c) => {
    const t1 = needThread(c, 0);
    if (!t1) return;
    const t2 = needThread(c, 1);
    if (!t2) return;
    if (t1.id === t2.id) { c.err('Pick two different threads.'); return; }
    const moved = t2.replies.length;
    t1.replies = t1.replies.concat(t2.replies);
    t2.replies = [];
    t2.deleted = true;
    c.out('🔗 Merged ' + moved + ' repl' + (moved === 1 ? 'y' : 'ies') + ' from ' +
      t2.id + ' into ' + t1.id + '. ' + t2.id + ' archived — /restore ' + t2.id + ' brings it back.');
  });

  def('split', 'Threads', '/split <comment_id>', 'Spin a comment out into its own topic', (c) => {
    const f = needReply(c);
    if (!f) return;
    const t = f.t;
    const r = f.r;
    const sub = new Set([r.id]);
    let grew = true;
    while (grew) {                          // take the comment's descendants with it
      grew = false;
      t.replies.forEach((x) => {
        if (x.parent && sub.has(x.parent) && !sub.has(x.id)) { sub.add(x.id); grew = true; }
      });
    }
    const moving = t.replies.filter((x) => sub.has(x.id));
    t.replies = t.replies.filter((x) => !sub.has(x.id));
    const root = moving.find((x) => x.id === r.id);
    if (root) root.parent = null;           // it's the root of its own thread now
    const title = (plain(r.body).slice(0, 70) || 'Untitled') +
      (plain(r.body).length > 70 ? '…' : '');
    const nt = {
      id: uid('t'), title, body: r.body, cat: t.cat, author: r.author,
      tags: ['split'], created: Date.now(), up: [], down: [], replies: moving,
      locked: false, pinned: false, featured: false, hidden: false, deleted: false, reports: [],
    };
    db.threads.unshift(nt);
    c.out('✂ Split ' + r.id + ' into ' + nt.id + ' (“' + title + '”) in ~/' +
      nt.cat + ' — ' + moving.length + ' comment' + (moving.length === 1 ? '' : 's') +
      ' moved with it.');
  });

  def('hide', 'Threads', '/hide <post_id>', 'Mask a post from public view (staff keep it)', (c) => {
    const it = needItem(c);
    if (!it) return;
    if (it.kind === 'thread') {
      it.t.hidden = true;
      c.out('🙈 Thread ' + it.t.id + ' hidden — staff can still see it.');
    } else {
      it.r.hidden = true;
      c.out('🙈 Comment ' + it.r.id + ' hidden — preserved for staff review.');
    }
  });

  def('delete', 'Threads', '/delete <post_id>', 'Remove a post or comment from public view', (c) => {
    const it = needItem(c);
    if (!it) return;
    const item = it.kind === 'thread' ? it.t : it.r;
    if (item.deleted) { c.info(item.id + ' is already deleted.'); return; }
    item.deleted = true;
    c.out('🗑 ' + item.id + ' removed — /restore ' + item.id + ' recovers it.');
  });

  def('restore', 'Threads', '/restore <post_id>', 'Recover a deleted post or thread', (c) => {
    const it = needItem(c);
    if (!it) return;
    const item = it.kind === 'thread' ? it.t : it.r;
    if (!item.deleted) { c.info(item.id + ' was not deleted.'); return; }
    item.deleted = false;
    c.out('♻ ' + item.id + ' is back in public view.');
  });

  def('feature', 'Threads', '/feature <thread_id>', 'Spotlight a thread on the feed', (c) => {
    const t = needThread(c);
    if (!t) return;
    if (t.featured) { c.info(t.id + ' is already featured.'); return; }
    t.featured = true;
    c.out('⭐ ' + t.id + ' featured at the top of the feed.');
  });

  def('unfeature', 'Threads', '/unfeature <thread_id>', 'Remove the featured spotlight', (c) => {
    const t = needThread(c);
    if (!t) return;
    const was = t.featured;
    t.featured = false;
    c.out(was ? ' ' + t.id + ' no longer featured.'.replace(' ', '') : t.id + ' was not featured.');
  });

  def('editpost', 'Threads', '/editpost <post_id> <new text>', 'Rewrite the text of a post', (c) => {
    const it = needItem(c);
    if (!it) return;
    const text = c.a.slice(1).join(' ').trim();
    if (!text) { c.err('Usage: ' + c.usage); return; }
    if (it.kind === 'thread') it.t.body = text;
    else it.r.body = text;
    c.out('✏ Edited ' + (it.kind === 'thread' ? 'post ' : 'comment ') +
      (it.kind === 'thread' ? it.t.id : it.r.id) + '.');
  });

  def('threads', 'Threads', '/threads [board]', 'List thread IDs, newest first, optionally by board', (c) => {
    const cat = c.a.length ? needCat(c) : null;
    if (c.a.length && !cat) return;
    const rows = db.threads.filter((t) => !cat || t.cat === cat.id);
    cmdList(c, 'Threads (including hidden/deleted)', newestFirst(rows).map((t) => itemLine(t) + ' · ~/' + t.cat));
  });

  def('threadinfo', 'Threads', '/threadinfo <thread_id>', 'Inspect a thread’s metadata and moderation state', (c) => {
    const t = needThread(c);
    if (!t) return;
    c.info(itemLine(t));
    c.info('Board: ~/' + t.cat + ' · created: ' + new Date(t.created).toLocaleString());
    c.info('Comments: ' + t.replies.length + ' · score: ' + score(t) + ' · reports: ' + (t.reports || []).length);
    c.info('Tags: ' + ((t.tags || []).join(', ') || 'none') + ' · poll: ' + (t.poll ? 'yes' : 'no'));
    c.info('Link: ' + new URL('#/t/' + t.id, location.href).href);
  });

  def('comments', 'Threads', '/comments <thread_id>', 'List comment IDs and parent IDs in a thread', (c) => {
    const t = needThread(c);
    if (!t) return;
    cmdList(c, 'Comments in ' + t.id, newestFirst(t.replies)
      .map((r) => itemLine(r) + ' · parent ' + (r.parent || 'root')));
  });

  def('findposts', 'Threads', '/findposts <query>', 'Search content, tags, authors, and IDs, including removed posts', (c) => {
    const query = c.a.join(' ').trim().toLowerCase();
    if (!query) { usageErr(c); return; }
    const rows = allItems().filter((it) =>
      [it.id, it.title || '', it.body, user(it.author).name, ...(it.tags || [])]
        .join(' ').toLowerCase().includes(query));
    cmdList(c, 'Matching posts and comments', newestFirst(rows).map(itemLine));
  });

  def('retitle', 'Threads', '/retitle <thread_id> <title>', 'Change a thread title (up to 140 characters)', (c) => {
    const t = needThread(c);
    if (!t) return;
    const title = commandText(c, c.a.slice(1), 140);
    if (title == null) return;
    t.title = title;
    c.out('Title updated for ' + t.id + '.');
  });

  def('unhide', 'Threads', '/unhide <post_id>', 'Remove a hidden flag without restoring deleted content', (c) => {
    const found = needItem(c);
    if (!found) return;
    const it = itemFrom(found);
    it.hidden = false;
    c.out(it.id + ' is no longer hidden.' + (it.deleted ? ' It is still deleted; use /restore to recover it.' : ''));
  });

  def('addtag', 'Threads', '/addtag <thread_id> <tag>', 'Add one tag, keeping existing tags (maximum 4)', (c) => {
    const t = needThread(c);
    if (!t) return;
    const tags = commandTags(c, c.a.slice(1).join(' '));
    if (!tags) return;
    if (tags.length !== 1) { usageErr(c); return; }
    const current = t.tags || [];
    if (current.some((tag) => tag.toLowerCase() === tags[0].toLowerCase())) {
      c.info('That tag is already on ' + t.id + '.'); return;
    }
    if (current.length >= 4) { c.err('A thread can have at most 4 tags.'); return; }
    t.tags = current.concat(tags);
    c.out('Added #' + tags[0] + ' to ' + t.id + '.');
  });

  def('removetag', 'Threads', '/removetag <thread_id> <tag>', 'Remove a tag (case-insensitive)', (c) => {
    const t = needThread(c);
    if (!t) return;
    const tags = commandTags(c, c.a.slice(1).join(' '));
    if (!tags) return;
    if (tags.length !== 1) { usageErr(c); return; }
    const current = t.tags || [];
    const next = current.filter((tag) => tag.toLowerCase() !== tags[0].toLowerCase());
    if (current.length === next.length) { c.info('That tag is not on ' + t.id + '.'); return; }
    t.tags = next;
    c.out('Removed #' + tags[0] + ' from ' + t.id + '.');
  });

  def('settags', 'Threads', '/settags <thread_id> <tag,tag,…|clear>', 'Replace all tags, or clear them (maximum 4)', (c) => {
    const t = needThread(c);
    if (!t) return;
    const text = c.a.slice(1).join(' ').trim();
    const tags = text.toLowerCase() === 'clear' ? [] : commandTags(c, text);
    if (!tags) return;
    t.tags = tags;
    c.out('Tags for ' + t.id + ': ' + (tags.join(', ') || 'none') + '.');
  });

  def('pollresults', 'Threads', '/pollresults <thread_id>', 'Show poll option totals and percentages', (c) => {
    const t = needThread(c);
    if (!t) return;
    if (!t.poll) { c.info('This thread has no poll.'); return; }
    const total = t.poll.opts.reduce((n, opt) => n + (opt.voters || []).length, 0);
    c.info(t.poll.q + ' — ' + total + ' vote(s)');
    t.poll.opts.forEach((opt, i) => {
      const n = (opt.voters || []).length;
      c.info('  ' + (i + 1) + '. ' + opt.text + ': ' + n + ' (' + (total ? Math.round(n / total * 100) : 0) + '%)');
    });
  });

  def('voteinfo', 'Threads', '/voteinfo <post_id>', 'Inspect upvotes, downvotes, and net score', (c) => {
    const found = needItem(c);
    if (!found) return;
    const it = itemFrom(found);
    c.info(it.id + ' · upvotes: ' + (it.up || []).length + ' · downvotes: ' + (it.down || []).length + ' · score: ' + score(it));
  });

  def('pinned', 'Threads', '/pinned', 'List pinned threads, including removed ones', (c) => {
    cmdList(c, 'Pinned threads', newestFirst(db.threads.filter((t) => t.pinned)).map(itemLine));
  });

  def('locked', 'Threads', '/locked', 'List locked threads, including removed ones', (c) => {
    cmdList(c, 'Locked threads', newestFirst(db.threads.filter((t) => t.locked)).map(itemLine));
  });

  def('featured', 'Threads', '/featured', 'List featured threads, including removed ones', (c) => {
    cmdList(c, 'Featured threads', newestFirst(db.threads.filter((t) => t.featured)).map(itemLine));
  });

  /* Boards */
  def('lockcategory', 'Boards', '/lockcategory <board>', 'Freeze a board to new topics', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    const st = db.catState[cat.id] = db.catState[cat.id] || {};
    st.locked = true;
    c.out('🧊 ~/' + cat.id + ' locked — no new topics (existing threads stay open).');
  });

  def('unlockcategory', 'Boards', '/unlockcategory <board>', 'Re-open a board to new topics', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    const st = db.catState[cat.id] = db.catState[cat.id] || {};
    st.locked = false;
    c.out('🔓 ~/' + cat.id + ' accepts new topics again.');
  });

  def('createcategory', 'Boards', '/createcategory <name>', 'Create a brand new board', (c) => {
    const name = c.a.join(' ').trim();
    if (!name) { c.err('Usage: ' + c.usage); return; }
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || uid('c');
    let id = base;
    let n = 2;
    while (allCats().some((x) => x.id === id)) id = base + '-' + (n++);
    db.cats.push({ id, name: name.slice(0, 40), icon: '📂', desc: 'Created by staff' });
    c.out('📁 Created board ~/' + id + ' (“' + name + '”).');
  });

  def('deletecategory', 'Boards', '/deletecategory <board>', 'Remove a board and its content', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    if (COMMUNITIES.some((x) => x.id === cat.id)) {
      c.err('Built-in boards can be locked or renamed, but not deleted.');
      return;
    }
    const n = db.threads.filter((t) => t.cat === cat.id).length;
    db.threads = db.threads.filter((t) => t.cat !== cat.id);
    db.cats = db.cats.filter((x) => x.id !== cat.id);
    delete db.catState[cat.id];
    db.catOrder = db.catOrder.filter((x) => x !== cat.id);
    c.out('🗑 Removed ~/' + cat.id + ' along with ' + n + ' thread' + (n === 1 ? '' : 's') + '.');
  });

  def('renamecategory', 'Boards', '/renamecategory <board> <new name>', 'Rename a board', (c) => {
    const cat = needCat(c, 0);
    if (!cat) return;
    const name = c.a.slice(1).join(' ').trim();
    if (!name) { c.err('Usage: ' + c.usage); return; }
    const st = db.catState[cat.id] = db.catState[cat.id] || {};
    st.name = name.slice(0, 40);
    c.out('✏ Board ~/' + cat.id + ' is now “' + st.name + '”.');
  });

  def('setpermissions', 'Boards', '/setpermissions <board> <group> <access>',
    'Set read/write access (write | read | none)', (c) => {
      const cat = needCat(c, 0);
      if (!cat) return;
      const g = (c.a[1] || '').toLowerCase();
      const lvl = (c.a[2] || '').toLowerCase();
      const groups = { member: 'member', members: 'member', everyone: 'member', mod: 'mod', moderator: 'mod', admin: 'admin' };
      const levels = { write: 'write', post: 'write', read: 'read', none: 'none' };
      if (!groups[g] || !levels[lvl]) {
        c.err('Usage: ' + c.usage + '  — groups: member|mod|admin, access: write|read|none');
        return;
      }
      const st = db.catState[cat.id] = db.catState[cat.id] || {};
      st.perms = st.perms || {};
      st.perms[groups[g]] = levels[lvl];
      c.out('🔐 ~/' + cat.id + ': ' + groups[g] + ' now has ' + levels[lvl] + ' access.');
    });

  def('reorderboards', 'Boards', '/reorderboards <id,id,…>', 'Change the board display order', (c) => {
    if (!c.a.length) {
      c.err('Usage: ' + c.usage + '  — e.g. /reorderboards general,help,showcase');
      c.info('Current order: ' + allCats().map((x) => x.id).join(', '));
      return;
    }
    const keys = c.rest.split(/[,\s]+/).filter(Boolean);
    const ids = [];
    keys.forEach((k) => { const cat = findCat(k); if (cat && !ids.includes(cat.id)) ids.push(cat.id); });
    if (!ids.length) { c.err('No matching boards in that list.'); return; }
    db.catOrder = ids;
    c.out('↕ Order set: ' + allCats().map((x) => x.id).join(' → '));
    const skipped = keys.length - ids.length;
    if (skipped > 0) c.info('   ' + skipped + ' unknown id' + (skipped === 1 ? '' : 's') + ' skipped.');
  });

  def('boards', 'Boards', '/boards', 'List board IDs, names, and topic locks in display order', (c) => {
    cmdList(c, 'Boards', allCats().map((cat) => '~/' + cat.id + ' · ' + cat.name + (cat.locked ? ' [locked]' : '')));
  });

  def('boardinfo', 'Boards', '/boardinfo <board>', 'Show a board’s description, lock, and origin', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    c.info('~/' + cat.id + ' · ' + cat.name);
    c.info('Description: ' + cat.desc);
    c.info('New topics: ' + (cat.locked ? 'locked (staff exempt)' : 'open, subject to permissions'));
    c.info('Type: ' + (COMMUNITIES.some((x) => x.id === cat.id) ? 'built-in' : 'custom'));
  });

  def('describecategory', 'Boards', '/describecategory <board> <text>', 'Set a board description (up to 200 characters)', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    const text = commandText(c, c.a.slice(1), 200);
    if (text == null) return;
    const st = db.catState[cat.id] = db.catState[cat.id] || {};
    st.desc = text;
    c.out('Description updated for ~/' + cat.id + '.');
  });

  def('boardstats', 'Boards', '/boardstats <board>', 'Count a board’s content, votes, and reports', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    const topics = db.threads.filter((t) => t.cat === cat.id);
    const items = topics.flatMap((t) => [t, ...t.replies]);
    c.info('~/' + cat.id + ' totals (including hidden/deleted content):');
    c.info('Threads: ' + topics.length + ' · comments: ' + (items.length - topics.length));
    c.info('Hidden items: ' + items.filter((it) => it.hidden).length + ' · deleted items: ' + items.filter((it) => it.deleted).length);
    c.info('Votes: ' + items.reduce((n, it) => n + (it.up || []).length + (it.down || []).length, 0) +
      ' · reports: ' + items.reduce((n, it) => n + (it.reports || []).length, 0));
  });

  def('boardpermissions', 'Boards', '/boardpermissions <board>', 'Show effective read/write access for each group', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    const perms = cat.perms || {};
    c.info('Permissions for ~/' + cat.id + ':');
    ['member', 'mod'].forEach((group) => c.info('  ' + group + ': ' + (perms[group] || 'write') +
      (Object.hasOwn(perms, group) ? ' (override)' : ' (default)')));
    c.info('  admin: write (administrators bypass board restrictions)');
    if (cat.locked) c.info('  New topics are locked for non-staff; existing replies follow permissions.');
  });

  def('resetpermissions', 'Boards', '/resetpermissions <board> <member|mod|admin>', 'Remove one group’s board permission override', (c) => {
    const cat = needCat(c);
    if (!cat) return;
    const group = (c.a[1] || '').toLowerCase();
    if (c.a.length !== 2 || !['member', 'mod', 'admin'].includes(group)) { usageErr(c); return; }
    const st = db.catState[cat.id];
    if (st && st.perms) delete st.perms[group];
    c.out('~/' + cat.id + ': ' + group + ' permission override removed. Other settings are unchanged.');
  });

  /* Queue */
  def('reviewqueue', 'Queue', '/reviewqueue', 'Open the moderation dashboard', (c) => {
    const rows = [];
    db.threads.forEach((t) => {
      if (t.reports && t.reports.length) rows.push([t, 'post']);
      (t.replies || []).forEach((r) => { if (r.reports && r.reports.length) rows.push([r, 'comment']); });
    });
    if (!rows.length) { c.out('✅ Review queue is empty — nothing awaiting staff review.'); return; }
    c.out(rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' awaiting review:', 'info');
    rows.forEach(([item, kind]) => {
      const escalated = item.reports.some((rp) => rp.escalated) ? ' [escalated]' : '';
      const label = kind === 'post'
        ? '“' + plain(item.title).slice(0, 46) + '”'
        : 'comment on ' + threadOfItem(item);
      c.info('  ' + item.id + '  ' + kind + '  by ' + user(item.author).name + ' — ' +
        label + ' — ' + item.reports.length + ' flag' +
        (item.reports.length === 1 ? '' : 's') + escalated);
    });
    c.info('Use: /approve post <id>, /reject post <id>, /clearreports <id>, /escalate <report_id>');
  });

  const threadOfItem = (r) => {
    const t = db.threads.find((x) => (x.replies || []).some((y) => y.id === r.id));
    return t ? plain(t.title).slice(0, 34) : 'a thread';
  };

  def('clearreports', 'Queue', '/clearreports <post_id>', 'Dismiss flags on an accepted item', (c) => {
    const it = needItem(c);
    if (!it) return;
    const item = it.kind === 'thread' ? it.t : it.r;
    if (!item.reports.length) { c.info('No reports on record for ' + item.id + '.'); return; }
    const n = item.reports.length;
    item.reports = [];
    c.out('🧹 Cleared ' + n + ' flag' + (n === 1 ? '' : 's') + ' on ' + item.id + '.');
  });

  def('reject', 'Queue', '/reject post <post_id>', 'Discard a flagged post and penalise the author', (c) => {
    if ((c.a[0] || '').toLowerCase() !== 'post') { c.err('Usage: ' + c.usage); return; }
    const it = needItem(c, 1);
    if (!it) return;
    const item = it.kind === 'thread' ? it.t : it.r;
    item.hidden = true;
    item.reports = [];
    const au = db.users[item.author];
    if (au) {
      au.warnings = au.warnings || [];
      au.warnings.unshift({ at: Date.now(), by: db.currentUserId, reason: 'Post rejected in review queue' });
    }
    c.out('❌ ' + item.id + ' rejected and hidden — automatic penalty recorded' +
      (au ? ' for ' + au.name : '') + '.');
  });

  def('escalate', 'Queue', '/escalate <report_id>', 'Pass a report up to senior staff', (c) => {
    const key = c.a[0];
    if (!key) { usageErr(c); return; }
    let n = 0;
    const byReport = [];
    allItems().forEach((it) => (it.reports || []).forEach((rp) => {
      if (rp.id === key) byReport.push(rp);
      else if (it.id === key && !rp.escalated) { rp.escalated = true; n++; }
    }));
    byReport.forEach((rp) => { if (!rp.escalated) { rp.escalated = true; n++; } });
    if (!n) { c.err('No pending report matches "' + key + '"'); return; }
    c.out('⬆ Escalated ' + n + ' report' + (n === 1 ? '' : 's') + ' to senior staff.');
  });

  def('reports', 'Queue', '/reports <post_id>', 'Show report IDs, reasons, reporters, and escalation state', (c) => {
    const found = needItem(c);
    if (!found) return;
    const it = itemFrom(found);
    const rows = (it.reports || []).slice().sort((a, b) => b.at - a.at);
    cmdList(c, 'Reports on ' + it.id, rows.map((rp) => rp.id + ' · ' + new Date(rp.at).toLocaleString() +
      ' · ' + user(rp.by).name + ' · ' + rp.reason + (rp.escalated ? ' [escalated]' : '')));
  });

  def('report', 'Queue', '/report <post_id> <reason>', 'Flag a post or comment with a reason for staff review', (c) => {
    const found = needItem(c);
    if (!found) return;
    const reason = commandText(c, c.a.slice(1), 160);
    if (reason == null) return;
    const it = itemFrom(found);
    const reports = it.reports || [];
    if (reports.some((rp) => rp.by === db.currentUserId)) { c.err('You already reported this item.'); return; }
    const rp = { id: uid('rp'), by: db.currentUserId, at: Date.now(), reason };
    it.reports = reports.concat(rp);
    c.out('Report ' + rp.id + ' added to ' + it.id + '. Use /reports ' + it.id + ' to inspect it.');
  });

  def('reportedusers', 'Queue', '/reportedusers', 'Summarize unresolved reports by content author', (c) => {
    const counts = new Map();
    allItems().forEach((it) => {
      if (!(it.reports || []).length) return;
      const row = counts.get(it.author) || { items: 0, reports: 0 };
      row.items++;
      row.reports += it.reports.length;
      counts.set(it.author, row);
    });
    cmdList(c, 'Authors with reported content', [...counts].sort((a, b) => b[1].reports - a[1].reports)
      .map(([id, row]) => id + ' · ' + user(id).name + ' · ' + row.items + ' item(s) · ' + row.reports + ' report(s)'));
  });

  def('hiddenposts', 'Queue', '/hiddenposts', 'List hidden posts and comments for staff review', (c) => {
    cmdList(c, 'Hidden posts and comments', newestFirst(allItems().filter((it) => it.hidden)).map(itemLine));
  });

  def('deletedposts', 'Queue', '/deletedposts', 'List soft-deleted posts and comments that can be restored', (c) => {
    cmdList(c, 'Deleted posts and comments', newestFirst(allItems().filter((it) => it.deleted)).map(itemLine));
  });

  /* System */
  def('maintenance', 'System', '/maintenance on|off', 'Take the forum offline or bring it back', (c) => {
    const v = (c.a[0] || '').toLowerCase();
    if (v !== 'on' && v !== 'off') { c.err('Usage: ' + c.usage); return; }
    db.maintenance = v === 'on';
    c.out(db.maintenance
      ? '🛠 Maintenance mode ON — non-admin visitors now see an offline screen.'
      : '🚀 Maintenance mode OFF — public access restored.');
  });

  def('clearcache', 'System', '/clearcache', 'Flush UI state and rebuild every view', (c) => {
    ui.draft = '';
    ui.replyTo = null;
    ui.lastPath = null;
    ui.cSort = 'best';
    ui.collapsed.clear();
    c.out('🧹 UI state cleared — layout rebuilt on the next paint.');
  });

  def('rebuildindices', 'System', '/rebuildindices', 'Re-index all posts for search', (c) => {
    const docs = db.threads.reduce((n, t) => n + 1 + t.replies.length, 0);
    db.lastIndexed = { at: Date.now(), docs };
    c.out('🔍 Search index rebuilt — ' + docs + ' documents (posts + comments).');
  });

  def('backup', 'System', '/backup now', 'Export a snapshot of the whole community', (c) => {
    if ((c.a[0] || '').toLowerCase() !== 'now') { c.err('Usage: ' + c.usage); return; }
    try {
      const json = JSON.stringify(db, null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bashforum-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      c.out('💾 Snapshot exported — ' + db.threads.length + ' threads, ' +
        Object.keys(db.users).length + ' users, ' + Object.keys(db.accounts).length + ' accounts.');
    } catch (err) {
      c.err('Export failed here: ' + err.message);
    }
  });

  def('runstats', 'System', '/runstats', 'Recalculate global forum statistics', (c) => {
    const users = Object.keys(db.users).length;
    const threads = db.threads.length;
    const comments = db.threads.reduce((n, t) => n + t.replies.length, 0);
    const votes = allItems().reduce((n, it) => n + (it.up || []).length + (it.down || []).length, 0);
    db.lastStats = { at: Date.now(), users, threads, comments, votes };
    c.out('📊 Statistics recomputed and cached:', 'info');
    c.info('   members ' + users + ' · threads ' + threads + ' · comments ' + comments + ' · votes ' + votes);
    c.info('   stamped ' + new Date(db.lastStats.at).toLocaleTimeString());
  });

  def('viewlogs', 'System', '/viewlogs', 'Open the staff audit log', (c) => {
    if (!db.audit.length) { c.out('No audit entries yet.'); return; }
    c.out('Audit log — ' + db.audit.length + ' entr' + (db.audit.length === 1 ? 'y' : 'ies') +
      ' (newest first):', 'info');
    db.audit.slice(0, 40).forEach((e) => c.info('  ' + new Date(e.at).toLocaleString() +
      '  ' + user(e.by).name + '  /' + e.cmd + '  ' + (e.detail || '')));
    if (db.audit.length > 40) c.info('  … ' + (db.audit.length - 40) + ' older entries');
  });

  def('broadcast', 'System', '/broadcast <message>', 'Post a site-wide banner (or “clear”)', (c) => {
    const msg = c.a.join(' ').trim();
    if (!msg) { c.err('Usage: ' + c.usage + '  |  /broadcast clear'); return; }
    if (msg.toLowerCase() === 'clear') {
      db.banner = null;
      c.out('🧹 Broadcast cleared.');
      return;
    }
    db.banner = msg.slice(0, 200);
    c.out('📣 Broadcast set — now visible to everyone: “' + db.banner + '”');
  });

  def('plugin', 'System', '/plugin enable <name>', 'Enable or disable an add-on module', (c) => {
    const sub = (c.a[0] || '').toLowerCase();
    const name = (c.a[1] || '').toLowerCase();
    if (sub === 'enable' && name) {
      db.plugins[name] = true;
      c.out('🧩 Plugin “' + name + '” enabled.');
      if (name === 'leaderboard') c.info('   Top members now show in the community sidebar.');
    } else if (sub === 'disable' && name) {
      delete db.plugins[name];
      c.out('🧩 Plugin “' + name + '” disabled.');
    } else if (!sub) {
      const on = Object.keys(db.plugins).filter((k) => db.plugins[k]);
      c.info('Usage: /plugin enable <name> | /plugin disable <name>');
      c.info('Active: ' + (on.length ? on.join(', ') : 'none') + ' · bundled: leaderboard');
    } else {
      c.err('Usage: ' + c.usage);
    }
  });

  def('status', 'System', '/status', 'Show forum availability, counts, and pending moderation', (c) => {
    const items = allItems();
    c.info('Maintenance: ' + (db.maintenance ? 'on' : 'off') + ' · banner: ' + (db.banner || 'none'));
    c.info('Boards: ' + allCats().length + ' · users: ' + Object.keys(db.users).length +
      ' · threads: ' + db.threads.length + ' · comments: ' + (items.length - db.threads.length));
    c.info('Reported items: ' + items.filter((it) => (it.reports || []).length).length +
      ' · restricted accounts: ' + Object.values(db.users).filter((u) => statusOf(u)).length);
    c.info('Active plugins: ' + (Object.keys(db.plugins).filter((key) => db.plugins[key]).join(', ') || 'none'));
    c.info('Data is stored in this browser on this device, not synced to a server.');
  });

  def('activity', 'System', '/activity [duration]', 'Count new members, posts, and comments (default: 1d)', (c) => {
    const duration = c.a.length ? parseDur(c.a[0]) : DAY;
    const since = Date.now() - duration;
    if (c.a.length > 1 || !Number.isSafeInteger(duration) || duration <= 0 || !Number.isFinite(new Date(since).getTime())) {
      c.err('Usage: ' + c.usage + ' — use a positive duration such as 12h or 7d.'); return;
    }
    const topics = db.threads.filter((t) => t.created >= since);
    const replies = db.threads.flatMap((t) => t.replies).filter((r) => r.created >= since);
    const authors = new Set([...topics, ...replies].map((it) => it.author));
    c.info('Activity since ' + new Date(since).toLocaleString() + ' (including hidden/deleted content):');
    c.info('New members: ' + Object.values(db.users).filter((u) => u.joined >= since).length +
      ' · threads: ' + topics.length + ' · comments: ' + replies.length + ' · contributing authors: ' + authors.size);
  });

  def('topusers', 'System', '/topusers [limit]', 'Rank members by karma (default: 10, maximum: 50)', (c) => {
    const limit = c.a.length ? Number(c.a[0]) : 10;
    if (c.a.length > 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) { usageErr(c); return; }
    const rows = Object.values(db.users).map((u) => ({ u, s: stats(u.id) }))
      .sort((a, b) => b.s.karma - a.s.karma || a.u.name.localeCompare(b.u.name)).slice(0, limit);
    cmdList(c, 'Top members by karma (all stored content)', rows.map(({ u, s }, i) =>
      (i + 1) + '. ' + u.id + ' · ' + u.name + ' · karma ' + s.karma + ' · posts ' + s.posts + ' · comments ' + s.comments));
  });

  def('tagstats', 'System', '/tagstats', 'Count tags on public, non-deleted threads', (c) => {
    const counts = new Map();
    db.threads.filter((t) => !t.hidden && !t.deleted &&
      ((db.catState[t.cat] || {}).perms || {}).member !== 'none').forEach((t) => {
      const tags = new Set((t.tags || []).map((tag) => tag.toLowerCase()));
      tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    cmdList(c, 'Public thread tags', [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => '#' + tag + ' · ' + count + ' thread(s)'));
  });

  def('storage', 'System', '/storage', 'Show local database size without exposing credentials', (c) => {
    const bytes = JSON.stringify(db).length * 2;
    c.info('Storage key: ' + KEY);
    c.info('Estimated database size (UTF-16): ' + bytes.toLocaleString() + ' bytes (' + (bytes / 1024).toFixed(1) + ' KiB).');
    c.info('Accounts: ' + Object.keys(db.accounts).length + ' · audit entries: ' + db.audit.length +
      ' · notifications: ' + db.notes.length);
    c.info('Browser quotas vary. Use /backup now before clearing browser data; backups contain account data.');
  });

  /* ---- console wiring ---- */

  document.addEventListener('submit', (e) => {
    if (!e.target || e.target.id !== 'cmdForm') return;
    e.preventDefault();
    const inp = $('#cmdInput');
    const raw = inp ? inp.value : '';
    if (raw.trim()) {
      cmdState.hist.push(raw.trim());
      if (cmdState.hist.length > 60) cmdState.hist.shift();
    }
    cmdState.hi = cmdState.hist.length;
    if (inp) inp.value = '';
    runCommand(raw);
  });

  const cmdInputEl = $('#cmdInput');
  if (cmdInputEl) cmdInputEl.addEventListener('keydown', (e) => {
    if (!cmdState.hist.length) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdState.hi = Math.max(0, cmdState.hi - 1);
      e.target.value = cmdState.hist[cmdState.hi] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdState.hi = Math.min(cmdState.hist.length, cmdState.hi + 1);
      e.target.value = cmdState.hist[cmdState.hi] || '';
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '`' || e.key === '~')) {
      e.preventDefault();
      const m = $('#cmdModal');
      if (!m) return;
      if (m.classList.contains('hidden')) openCmd();
      else closeCmd();
    } else if (e.key === 'Escape') {
      const m = $('#cmdModal');
      if (m && !m.classList.contains('hidden') && m.contains(document.activeElement)) closeCmd();
    }
  });

  /* ---------------- keyboard shortcuts ---------------- */

  function openKb() { const m = $('#kbModal'); if (m) m.classList.remove('hidden'); }
  function closeKb() { const m = $('#kbModal'); if (m) m.classList.add('hidden'); }

  const typingIn = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' || el.isContentEditable);

  document.addEventListener('keydown', (e) => {
    if (!$('#authModal').classList.contains('hidden')) return;
    const openModal = ['#cmdModal', '#kbModal'].some((s) => {
      const m = $(s);
      return m && !m.classList.contains('hidden');
    });

    if (e.key === 'Escape') {
      const panel = $('#notePanel');
      if (panel && !panel.classList.contains('hidden')) panel.classList.add('hidden');
      closeKb();
      return;
    }
    if (typingIn(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); if (openModal) closeKb(); else openKb(); return; }
    if (openModal) return;
    if (e.key === '/') { e.preventDefault(); const s = $('#search'); if (s) s.focus(); return; }
    if (e.key === 'c') { if (me()) location.hash = '#/new'; return; }
    if (e.key === 'j' || e.key === 'k') {
      const rows = [...document.querySelectorAll('.post-row')];
      if (!rows.length) return;
      e.preventDefault();
      let i = rows.findIndex((r) => r.classList.contains('is-cursor'));
      i = e.key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      rows.forEach((r) => r.classList.remove('is-cursor'));
      rows[i].classList.add('is-cursor');
      rows[i].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && (e.target === document.body || e.target === document.documentElement)) {
      const cur = document.querySelector('.post-row.is-cursor');
      if (cur && cur.dataset.href) {
        e.preventDefault();
        location.hash = cur.dataset.href;
      }
    }
  });

  /* ---------------- boot ---------------- */

  /* handle for automated tests — no user-facing surface */
  window.__bashforum = { db: () => db, render, run: (s) => runCommand(s) };

  if (!location.hash) location.hash = '#/';
  render();
})();
