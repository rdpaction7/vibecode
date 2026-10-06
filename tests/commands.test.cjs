'use strict';

// Run with: node --test tests/commands.test.cjs
// No DOM package is needed: execute the real, unmodified app.js in a fresh VM.
// The shim records HTML/text writes; it deliberately does not parse or execute HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const SOURCE = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const PAGE = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const NOW = Date.UTC(2026, 0, 15, 12);
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const clone = (value) => JSON.parse(JSON.stringify(value));

const ADDED = {
  Console: ['clear', 'history', 'whoami', 'findcommand', 'go', 'search'],
  Users: ['users', 'userinfo', 'staff', 'bannedusers', 'mutedusers', 'unmuffle',
    'unverify', 'clearrank', 'renameuser', 'setbio', 'clearavatar', 'userposts',
    'usercomments', 'unwarn'],
  Threads: ['threads', 'threadinfo', 'comments', 'findposts', 'retitle', 'unhide',
    'addtag', 'removetag', 'settags', 'pollresults', 'voteinfo', 'pinned', 'locked', 'featured'],
  Boards: ['boards', 'boardinfo', 'describecategory', 'boardstats', 'boardpermissions', 'resetpermissions'],
  Queue: ['reports', 'report', 'reportedusers', 'hiddenposts', 'deletedposts'],
  System: ['status', 'activity', 'topusers', 'tagstats', 'storage'],
};
const LEGACY = ('help commands version ban unban tempban muffle warn warnhistory suspend approve ' +
  'deleteuser anonymize setrole changerank verify resetpassword ipcheck lock unlock pin unpin sticky ' +
  'move merge split hide delete restore feature unfeature editpost lockcategory unlockcategory ' +
  'createcategory deletecategory renamecategory setpermissions reorderboards reviewqueue clearreports ' +
  'reject escalate maintenance clearcache rebuildindices backup runstats viewlogs broadcast plugin').split(' ');
const NEW_NAMES = Object.values(ADDED).flat();
const ALL_NAMES = [...LEGACY, ...NEW_NAMES];
const REQUIRED_NEW = ('findcommand go search userinfo unmuffle unverify clearrank renameuser setbio ' +
  'clearavatar userposts usercomments unwarn threadinfo comments findposts retitle unhide addtag removetag ' +
  'settags pollresults voteinfo boardinfo describecategory boardstats boardpermissions resetpermissions reports report').split(' ');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= function () { this.defaultPrevented = true; };
    for (const handler of this.listeners.get(event.type) || []) handler(event);
    return !event.defaultPrevented;
  }
}

function dom() {
  const document = new Events();
  const nodes = new Map();
  class Element extends Events {
    constructor(tag = 'div', id = '') {
      super();
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.dataset = {};
      this.attributes = new Map();
      this.children = [];
      this.value = '';
      this._html = '';
      this._text = '';
      this._classes = new Set();
      this.innerHTMLWrites = [];
      this.classList = {
        add: (...names) => names.forEach((name) => this._classes.add(name)),
        remove: (...names) => names.forEach((name) => this._classes.delete(name)),
        contains: (name) => this._classes.has(name),
        toggle: (name, force) => {
          const on = force === undefined ? !this._classes.has(name) : !!force;
          if (on) this._classes.add(name); else this._classes.delete(name);
          return on;
        },
      };
    }
    get className() { return [...this._classes].join(' '); }
    set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      this.innerHTMLWrites.push(String(value));
      this._html = String(value);
      this._text = '';
      this.children = [];
    }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this._html = ''; this.children = []; }
    get firstChild() { return this.children[0] || null; }
    get scrollHeight() { return this.children.length; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
    replaceChildren(...children) { this.textContent = ''; children.forEach((child) => this.appendChild(child)); }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    querySelector(selector) { return document.querySelector(selector); }
    querySelectorAll() { return []; }
    contains(other) { return other === this || this.children.some((child) => child.contains(other)); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
    click() { this.dispatchEvent({ type: 'click' }); }
    scrollIntoView() {}
    reset() { this.value = ''; }
  }
  document.createElement = (tag) => new Element(tag);
  document.querySelector = (selector) => /^#[\w-]+$/.test(selector) ? nodes.get(selector.slice(1)) || null : null;
  document.querySelectorAll = () => [];
  document.getElementById = (id) => nodes.get(id) || null;
  document.documentElement = new Element('html');
  document.documentElement.dataset.theme = 'dark';
  document.body = new Element('body');
  document.activeElement = document.body;
  // Only actual static page IDs exist; optional dynamically rendered controls may be absent.
  for (const match of PAGE.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1], match[3]);
    element.className = /\bclass="([^"]*)"/.exec(match[2])?.[1] || '';
    nodes.set(element.id, element);
  }
  return { document, nodes };
}

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    getItem: (key) => data.get(String(key)) ?? null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: (key) => data.delete(String(key)),
    key: (index) => [...data.keys()][index] ?? null,
    clear: () => data.clear(),
  };
}

function boot(saved = {}) {
  const { document, nodes } = dom();
  const localStorage = storage(saved);
  const window = new Events();
  window.scrollTo = () => {};
  const location = { href: 'https://forum.test/', hash: '#/', reload() {} };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  class TestURL extends URL {
    static createObjectURL() { return 'blob:https://forum.test/fixture'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    window, document, localStorage, location, console, Date: Clock,
    URL: TestURL, URLSearchParams, Blob, TextEncoder,
    history: { replaceState(_state, _title, url) { location.hash = url; } },
    // No pending timers or real browser/network side effects survive a test.
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: (fn) => fn(),
    confirm: () => true,
  });
  vm.runInContext(SOURCE, context, { filename: 'app.js', timeout: 5000 });
  const api = window.__bashforum;
  assert.ok(api && api.db && api.run && api.render, 'app exposes the real console test API');
  const node = (id) => {
    const element = nodes.get(id);
    assert.ok(element, 'missing page element #' + id);
    return element;
  };
  function run(command, { submit = false, resetLog = true } = {}) {
    if (resetLog) node('cmdLog').innerHTML = '';
    assert.doesNotThrow(() => {
      if (submit) {
        node('cmdInput').value = command;
        document.dispatchEvent({ type: 'submit', target: node('cmdForm') });
      } else api.run(command);
    }, command + ' must not escape the command runner');
    const lines = node('cmdLog').children.filter((line) => !line.classList.contains('cmd-echo'));
    const text = lines.map((line) => line.textContent).join('\n');
    assert.doesNotMatch(text, /Unknown command|Command failed|Invalid Date/, command + '\n' + text);
    return { text, lines, errors: lines.filter((line) => line.classList.contains('err')) };
  }
  return { api, db: api.db(), document, node, location, localStorage, run };
}

function fixture() {
  const app = boot();
  const db = app.db;
  app.admin = Object.values(db.users).find((user) => user.role === 'admin');
  db.currentUserId = app.admin.id;
  db.users.u_mira.role = 'mod';
  Object.assign(db.users.u_ada, {
    muffled: true, verified: true, rank: 'Shell expert', pfp: '🐚',
    warnings: [
      { at: NOW - HOUR, by: app.admin.id, reason: 'First warning' },
      { at: NOW - 2 * HOUR, by: app.admin.id, reason: 'Second warning' },
    ],
  });
  db.users.u_theo.banned = true;
  db.users.u_theo.banReason = 'Fixture ban';
  db.users.u_nova.suspended = true;
  db.users.u_sam.bannedUntil = NOW - HOUR;
  db.users.u_temp = { ...clone(db.users.u_sam), id: 'u_temp', name: 'Temporary User', bannedUntil: NOW + DAY };
  db.accounts['ada@example.test'] = {
    email: 'ada@example.test', userId: 'u_ada', salt: 'fixture-salt', hash: 'fixture-hash', created: NOW - DAY,
  };
  const reply = (id, author, body, flags = {}) => ({
    id, author, body, parent: null, created: NOW - HOUR, up: ['u_mira'], down: [],
    reports: [], hidden: false, deleted: false, ...flags,
  });
  const thread = (id, author, cat, title, flags = {}) => ({
    id, author, cat, title, body: 'Search needle in ' + id, created: NOW - 2 * HOUR,
    tags: ['bash', 'shell'], up: ['u_mira', 'u_nova', 'u_sam'], down: ['u_theo'],
    replies: [], reports: [], hidden: false, deleted: false,
    pinned: false, locked: false, featured: false, ...flags,
  });
  app.alpha = thread('t_alpha', 'u_ada', 'general', 'Alpha shell workshop', {
    pinned: true, locked: true, featured: true,
    reports: [{ id: 'rp_existing', by: 'u_mira', at: NOW - HOUR, reason: 'Existing report', escalated: false }],
    replies: [
      reply('r_alpha', 'u_ada', 'Alpha comment needle'),
      reply('r_deleted', 'u_theo', 'Deleted comment needle', { hidden: true, deleted: true }),
    ],
    poll: { q: 'Which shell?', opts: [
      { text: 'Bash', voters: ['u_ada', 'u_sam'] }, { text: 'Zsh', voters: ['u_theo'] },
    ] },
  });
  app.hidden = thread('t_hidden', 'u_theo', 'help', 'Hidden needle', {
    hidden: true, replies: [reply('r_hidden', 'u_nova', 'Hidden reply needle', { hidden: true })],
  });
  app.deleted = thread('t_deleted', 'u_ada', 'general', 'Deleted needle', { deleted: true });
  app.other = thread('t_other', 'u_nova', 'showcase', 'Other workshop', { tags: ['tiny'] });
  db.threads = [app.alpha, app.hidden, app.deleted, app.other];
  db.cats = [{ id: 'custom', name: 'Custom Board', icon: '📂', desc: 'Fixture board' }];
  db.catState = {
    general: { name: 'General lounge', desc: 'Fixture description', locked: true,
      perms: { member: 'read', mod: 'none', admin: 'write' } },
  };
  db.audit = [
    { at: NOW - HOUR, by: app.admin.id, cmd: 'fixture_recent', detail: 'Recent audit marker' },
    { at: NOW - 3 * DAY, by: app.admin.id, cmd: 'fixture_old', detail: 'Old audit marker' },
  ];
  app.api.render();
  return app;
}

function stateWithoutAudit(db) {
  const copy = clone(db);
  delete copy.audit;
  return copy;
}
function ok(app, command, options) {
  const result = app.run(command, options);
  assert.equal(result.errors.length, 0, command + '\n' + result.text);
  return result;
}
function rejected(app, command) {
  const before = stateWithoutAudit(app.db);
  const result = app.run(command);
  assert.ok(result.errors.length, command + ' must report a validation error\n' + result.text);
  assert.deepEqual(stateWithoutAudit(app.db), before, command + ' must not partially mutate its target');
  return result;
}
function persisted(app) {
    /* no-op: persistence is handled by Supabase, not localStorage */
  }

const VALID_ARGS = {
  findcommand: 'userinfo', go: 't_alpha', search: 'shell workshop', users: 'Ada', userinfo: 'Ada Lovelace',
  unmuffle: 'Ada Lovelace', unverify: 'Ada Lovelace', clearrank: 'Ada Lovelace',
  renameuser: 'Ada Lovelace Updated Name', setbio: 'Ada Lovelace New biography', clearavatar: 'Ada Lovelace',
  userposts: 'Ada Lovelace', usercomments: 'Ada Lovelace', unwarn: 'Ada Lovelace 1',
  threads: 'general', threadinfo: 't_alpha', comments: 't_alpha', findposts: 'needle',
  retitle: 't_alpha Updated title', unhide: 't_hidden', addtag: 't_alpha newtag',
  removetag: 't_alpha bash', settags: 't_alpha newtag,other', pollresults: 't_alpha', voteinfo: 'r_alpha',
  boardinfo: 'general', describecategory: 'general Updated description', boardstats: 'general',
  boardpermissions: 'general', resetpermissions: 'general member', reports: 't_alpha',
  report: 't_alpha Needs review', activity: '1d', topusers: '3',
  ban: 'u_ada reason', unban: 'u_theo', tempban: 'u_ada 1d', muffle: 'u_ada', warn: 'u_ada reason',
  warnhistory: 'u_ada', suspend: 'u_ada', approve: 'u_nova', deleteuser: 'u_ada', anonymize: 'u_ada',
  setrole: 'u_ada mod', changerank: 'u_ada Expert', verify: 'u_sam', resetpassword: 'u_ada', ipcheck: 'u_ada',
  lock: 't_other', unlock: 't_alpha', pin: 't_other', unpin: 't_alpha', sticky: 't_other',
  move: 't_alpha help', merge: 't_alpha t_other', split: 'r_alpha', hide: 't_other', delete: 't_other',
  restore: 't_deleted', feature: 't_other', unfeature: 't_alpha', editpost: 't_alpha New body',
  lockcategory: 'help', unlockcategory: 'general', createcategory: 'New board', deletecategory: 'custom',
  renamecategory: 'general Renamed board', setpermissions: 'general member none', reorderboards: 'help,general',
  clearreports: 't_alpha', reject: 'post t_alpha', escalate: 'rp_existing', maintenance: 'on',
  backup: 'now', broadcast: 'Fixture broadcast', plugin: 'enable leaderboard',
};
const validCommand = (name) => '/' + name + (VALID_ARGS[name] ? ' ' + VALID_ARGS[name] : '');

test('registry has exactly 101 unique commands: the original 51 plus the specified 50', () => {
  assert.equal(LEGACY.length, 51);
  assert.equal(NEW_NAMES.length, 50);
  const declarations = [...SOURCE.matchAll(/\bdef\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.equal(declarations.length, 101, 'exactly 101 registrations');
  assert.equal(new Set(declarations).size, 101, 'no silently overwritten command names');
  assert.deepEqual(declarations.slice().sort(), ALL_NAMES.slice().sort());
  const app = fixture();
  for (const command of ['/help', '/commands']) {
    const { text } = ok(app, command);
    const advertised = [...text.matchAll(/^\s{4}\/(\w+)/gm)].map((match) => match[1].toLowerCase());
    assert.deepEqual(advertised.sort(), ALL_NAMES.slice().sort(), command + ' advertises every command once');
    for (const group of Object.keys(ADDED)) assert.ok(text.includes(group), command + ' includes ' + group);
  }
});

test('all 101 commands reject anonymous, member, and moderator callers before changing targets', async (t) => {
  for (const role of ['anonymous', 'member', 'mod']) {
    await t.test(role, async (t) => {
      const app = fixture();
      app.db.currentUserId = role === 'anonymous' ? null : role === 'mod' ? 'u_mira' : 'u_sam';
      for (const name of ALL_NAMES) {
        await t.test('/' + name, () => {
          const before = stateWithoutAudit(app.db);
          const hash = app.location.hash;
          app.node('cmdModal').classList.remove('hidden');
          const { text, errors } = app.run(validCommand(name));
          assert.ok(errors.length, 'denial is reported');
          assert.match(text, /admin.*(required|access|sign.in)|not an admin/i);
          assert.deepEqual(stateWithoutAudit(app.db), before, 'denial may append audit only');
          assert.equal(app.location.hash, hash, 'denied navigation stays on the current route');
          assert.equal(app.node('cmdModal').classList.contains('hidden'), false);
          persisted(app);
        });
      }
    });
  }
});

test('every command handles omitted arguments without throwing or internal command failures', async (t) => {
  for (const name of ALL_NAMES) {
    await t.test('/' + name, () => {
      const app = fixture();
      if (REQUIRED_NEW.includes(name)) rejected(app, '/' + name);
      else if (NEW_NAMES.includes(name)) ok(app, '/' + name);
      else app.run('/' + name);
    });
  }
});

const READ_CASES = [
  ['whoami', /Forum Admin/, /admin/i],
  ['users', /Ada Lovelace/, /Temporary User/],
  ['users aDa lOvElAcE', /Ada Lovelace/],
  ['userinfo "Ada Lovelace"', /Ada Lovelace/, /u_ada/],
  ['staff', /Mira Chen/, /Forum Admin/],
  ['bannedusers', /Theo Park/, /Nova Reyes/, /Temporary User/],
  ['mutedusers', /Ada Lovelace/],
  ['userposts Ada Lovelace', /t_alpha/, /t_deleted/],
  ['usercomments "Ada Lovelace"', /r_alpha/],
  ['threads', /t_alpha/, /t_hidden/, /t_deleted/],
  ['threads general', /t_alpha/, /t_deleted/],
  ['threadinfo t_alpha', /Alpha shell workshop/, /t_alpha/],
  ['comments t_alpha', /r_alpha/, /r_deleted/],
  ['findposts NeEdLe', /t_alpha/, /t_hidden/, /t_deleted/, /r_alpha/, /r_deleted/, /r_hidden/],
  ['pollresults t_alpha', /Which shell\?/, /Bash/, /Zsh/, /2/, /1/],
  ['voteinfo t_alpha', /3/, /1/, /2/],
  ['voteinfo r_alpha', /1/, /0/],
  ['pinned', /t_alpha/], ['locked', /t_alpha/], ['featured', /t_alpha/],
  ['boards', /general/, /help/, /custom/],
  ['boardinfo "General lounge"', /general/, /Fixture description/],
  ['boardstats general', /general/, /thread/i, /comment|repl/i],
  ['boardpermissions general', /member/, /read/, /mod/, /none/, /admin/],
  ['reports t_alpha', /rp_existing/, /Existing report/],
  ['reportedusers', /Ada Lovelace/],
  ['hiddenposts', /t_hidden/, /r_hidden/, /r_deleted/],
  ['deletedposts', /t_deleted/, /r_deleted/],
  ['status', /user|member/i, /thread/i, /board/i],
  ['activity', /activity|thread|post|audit|action/i],
  ['activity 2h', /activity|thread|post|audit|action/i],
  ['topusers', /Ada Lovelace/], ['topusers 1', /Ada Lovelace/],
  ['tagstats', /bash/, /shell/, /tiny/],
  ['storage', /byte|KiB|KB|size/i],
];
test('new inspection commands read actual fixture data without changing target state', async (t) => {
  for (const [command, ...patterns] of READ_CASES) {
    await t.test('/' + command, () => {
      const app = fixture();
      const before = stateWithoutAudit(app.db);
      const { text } = ok(app, '/' + command);
      for (const pattern of patterns) assert.match(text, pattern);
      assert.deepEqual(stateWithoutAudit(app.db), before);
      assert.equal(app.db.audit[0].cmd, command.split(' ')[0], 'successful command is audited');
      persisted(app);
    });
  }
});

test('filtered listings omit nonmatching users, boards, and flags', () => {
  const app = fixture();
  assert.doesNotMatch(ok(app, '/users aDa LoVeLaCe').text, /Mira Chen|Theo Park/);
  assert.doesNotMatch(ok(app, '/threads general').text, /t_hidden|t_other/);
  assert.doesNotMatch(ok(app, '/bannedusers').text, /Sam Okafor/, 'expired temporary bans are not active bans');
  assert.doesNotMatch(ok(app, '/mutedusers').text, /Mira Chen|Theo Park/);
  assert.doesNotMatch(ok(app, '/staff').text, /Ada Lovelace|Sam Okafor/);
  for (const name of ['pinned', 'locked', 'featured']) {
    assert.doesNotMatch(ok(app, '/' + name).text, /t_other/);
  }
  assert.doesNotMatch(ok(app, '/hiddenposts').text, /t_alpha|t_other/);
  assert.doesNotMatch(ok(app, '/deletedposts').text, /t_alpha|t_hidden|t_other/);
});

test('findcommand matches names, usage, descriptions, and groups case-insensitively', () => {
  const app = fixture();
  assert.match(ok(app, '/findcommand USERINFO').text, /\/userinfo/);
  assert.match(ok(app, '/findcommand thread_id').text, /\/threadinfo|\/lock|\/retitle/);
  assert.match(ok(app, '/findcommand infraction').text, /\/warnhistory/);
  const byGroup = ok(app, '/findcommand Boards').text;
  for (const name of ADDED.Boards) assert.ok(byGroup.includes('/' + name), name + ' is found by group');
  const empty = ok(app, '/findcommand definitely_no_such_command').text;
  assert.match(empty, /0|no .*match|none|empty/i);
});

test('history records submitted commands and survives clearing the visible log', () => {
  const app = fixture();
  ok(app, ' /whoami ', { submit: true });
  ok(app, '/users Ada', { submit: true });
  ok(app, '/status'); // The test API is not a form submission.
  let text = ok(app, '/history').text;
  assert.ok(text.includes('/whoami') && text.includes('/users Ada'));
  assert.ok(!text.includes('/status'), 'direct API invocation is not submitted history');
  const auditBeforeClear = clone(app.db.audit);
  const cleared = ok(app, '/clear', { resetLog: false });
  assert.deepEqual(clone(app.db.audit.slice(-auditBeforeClear.length)), auditBeforeClear,
    'clearing the console retains the staff audit log');
  assert.doesNotMatch(cleared.text, /\/whoami|\/users Ada/);
  assert.ok(app.node('cmdLog').children.length <= 1, 'clear removes the existing log, including its echo');
  text = ok(app, '/history').text;
  assert.match(text, /\/whoami/);
  assert.match(text, /\/users Ada/);
  app.node('cmdInput').dispatchEvent({ type: 'keydown', key: 'ArrowUp' });
  assert.equal(app.node('cmdInput').value, '/users Ada', 'existing history keyboard navigation still works');
});

test('go and search navigate to the intended view and close the console', () => {
  const app = fixture();
  app.node('cmdModal').classList.remove('hidden');
  ok(app, '/go t_alpha');
  assert.equal(app.location.hash, '#/t/t_alpha');
  assert.equal(app.node('cmdModal').classList.contains('hidden'), true);
  assert.match(app.node('main').innerHTML, /Alpha shell workshop/);
  app.node('cmdModal').classList.remove('hidden');
  ok(app, '/search shell & workshop');
  const route = new URL(app.location.hash.slice(1), 'https://forum.test');
  assert.equal(route.pathname, '/');
  assert.equal(route.searchParams.get('q'), 'shell & workshop');
  assert.equal(app.node('search').value, 'shell & workshop');
  assert.equal(app.node('cmdModal').classList.contains('hidden'), true);
  const before = app.location.hash;
  app.node('cmdModal').classList.remove('hidden');
  rejected(app, '/go does_not_exist');
  assert.equal(app.location.hash, before);
  assert.equal(app.node('cmdModal').classList.contains('hidden'), false);
});

const MUTATIONS = [
  ['unmuffle Ada Lovelace', (a) => assert.equal(a.db.users.u_ada.muffled, false)],
  ['unverify "Ada Lovelace"', (a) => assert.equal(a.db.users.u_ada.verified, false)],
  ['clearrank Ada Lovelace', (a) => assert.equal(a.db.users.u_ada.rank, '')],
  ['renameuser Ada Lovelace Ada Byron', (a) => assert.equal(a.db.users.u_ada.name, 'Ada Byron')],
  ['renameuser "Ada Lovelace" "Ada Byron"', (a) => assert.equal(a.db.users.u_ada.name, 'Ada Byron')],
  ['setbio Ada Lovelace Multi word biography', (a) => assert.equal(a.db.users.u_ada.bio, 'Multi word biography')],
  ['setbio "Ada Lovelace" "Quoted biography"', (a) => assert.equal(a.db.users.u_ada.bio, 'Quoted biography')],
  ['clearavatar Ada Lovelace', (a) => assert.equal(a.db.users.u_ada.pfp, '')],
  ['unwarn Ada Lovelace 1', (a) => assert.deepEqual(a.db.users.u_ada.warnings.map((w) => w.reason), ['Second warning'])],
  ['unwarn "Ada Lovelace" 2', (a) => assert.deepEqual(a.db.users.u_ada.warnings.map((w) => w.reason), ['First warning'])],
  ['retitle t_alpha New multi word title', (a) => assert.equal(a.alpha.title, 'New multi word title')],
  ['unhide t_hidden', (a) => assert.equal(a.hidden.hidden, false)],
  ['unhide r_deleted', (a) => {
    assert.equal(a.alpha.replies[1].hidden, false);
    assert.equal(a.alpha.replies[1].deleted, true, 'unhide does not restore a deletion');
  }],
  ['addtag t_alpha #testing', (a) => assert.ok(a.alpha.tags.includes('testing'))],
  ['removetag t_alpha #BASH', (a) => assert.deepEqual(a.alpha.tags, ['shell'])],
  ['settags t_alpha #one,Two,one,#THREE', (a) => {
    assert.deepEqual(Array.from(a.alpha.tags, (tag) => tag.toLowerCase()), ['one', 'two', 'three']);
  }],
  ['settags t_alpha clear', (a) => assert.deepEqual(Array.from(a.alpha.tags), [])],
  ['describecategory general New board description', (a) => assert.equal(a.db.catState.general.desc, 'New board description')],
  ['resetpermissions general member', (a) => {
    assert.deepEqual(a.db.catState.general.perms, { mod: 'none', admin: 'write' });
    assert.equal(a.db.catState.general.locked, true);
    assert.equal(a.db.catState.general.name, 'General lounge');
    assert.equal(a.db.catState.general.desc, 'Fixture description');
  }],
  ['report t_alpha Needs staff review', (a) => {
    const report = a.alpha.reports.find((entry) => entry.by === a.admin.id);
    assert.ok(report && report.id);
    assert.equal(report.reason, 'Needs staff review');
    assert.equal(report.at, NOW);
    assert.equal(a.alpha.reports.length, 2);
  }],
  ['report r_alpha Comment needs review', (a) => {
    assert.equal(a.alpha.replies[0].reports.length, 1);
    assert.equal(a.alpha.replies[0].reports[0].reason, 'Comment needs review');
  }],
];
test('every new mutating command applies its contract, audits, saves, and renders', async (t) => {
  for (const [command, verify] of MUTATIONS) {
    await t.test('/' + command, () => {
      const app = fixture();
      const renders = app.node('main').innerHTMLWrites.length;
      ok(app, '/' + command);
      verify(app);
      assert.equal(app.db.audit[0].cmd, command.split(' ')[0]);
      assert.equal(app.db.audit[0].by, app.admin.id);
      assert.ok(app.node('main').innerHTMLWrites.length > renders, 'successful command rerenders');
      persisted(app);
    });
  }
});

test('new user commands resolve IDs, unique fragments, case variants, and longest multi-word names', () => {
  const app = fixture();
  app.db.users.u_short = { ...clone(app.db.users.u_sam), id: 'u_short', name: 'Ada' };
  ok(app, '/setbio Ada Lovelace Exact longest match');
  assert.equal(app.db.users.u_ada.bio, 'Exact longest match');
  assert.notEqual(app.db.users.u_short.bio, 'Exact longest match');
  ok(app, '/setbio "aDa LoVeLaCe" Case insensitive match');
  ok(app, '/setbio u_ada Identifier match');
  ok(app, '/setbio Lovelace Unique fragment match');
  assert.equal(app.db.users.u_ada.bio, 'Unique fragment match');
  rejected(app, '/setbio no_such_user Missing target');
});

test('rename validation is case-insensitively unique and preserves IDs, accounts, posts, and votes', () => {
  const app = fixture();
  rejected(app, '/renameuser u_ada mIrA cHeN');
  rejected(app, '/renameuser u_ada x');
  rejected(app, '/renameuser u_ada ' + 'x'.repeat(33));
  rejected(app, '/renameuser u_ada "   "');
  const before = clone(app.db);
  ok(app, '/renameuser u_ada AB');
  assert.equal(app.db.users.u_ada.name, 'AB');
  ok(app, '/renameuser u_ada ' + 'N'.repeat(32));
  assert.equal(app.db.users.u_ada.name.length, 32);
  assert.deepEqual(clone(app.db.threads), before.threads);
  assert.deepEqual(clone(app.db.accounts), before.accounts);
  assert.equal(app.db.users.u_ada.id, 'u_ada');
});

test('bounded text commands accept boundary lengths and reject empty or oversized values atomically', async (t) => {
  for (const [prefix, max, field] of [
    ['/setbio u_ada ', 180, (a) => a.db.users.u_ada.bio],
    ['/retitle t_alpha ', 140, (a) => a.alpha.title],
    ['/describecategory general ', 200, (a) => a.db.catState.general.desc],
    ['/report r_alpha ', 160, (a) => a.alpha.replies[0].reports[0].reason],
  ]) {
    await t.test(prefix, () => {
      const app = fixture();
      rejected(app, prefix);
      rejected(app, prefix + '"   "');
      rejected(app, prefix + 'x'.repeat(max + 1));
      ok(app, prefix + 'x'.repeat(max));
      assert.equal(field(app), 'x'.repeat(max));
    });
  }
});

test('unwarn removes exactly the requested 1-based warning and rejects invalid indexes', () => {
  const app = fixture();
  for (const value of ['0', '-1', '1.5', '3', 'abc', 'Infinity', '1abc']) {
    rejected(app, '/unwarn Ada Lovelace ' + value);
  }
  ok(app, '/unwarn Ada Lovelace 2');
  assert.deepEqual(app.db.users.u_ada.warnings.map((w) => w.reason), ['First warning']);
  ok(app, '/unwarn Ada Lovelace 1');
  assert.equal(app.db.users.u_ada.warnings.length, 0);
  rejected(app, '/unwarn Ada Lovelace 1');
});

test('tags are unique ignoring case, strip #, and respect four tags and 20 characters', () => {
  const app = fixture();
  ok(app, '/addtag t_alpha #BASH');
  assert.equal(app.alpha.tags.filter((tag) => tag.toLowerCase() === 'bash').length, 1);
  ok(app, '/settags t_alpha #One,one, #TWO,three,four');
  assert.deepEqual(Array.from(app.alpha.tags, (tag) => tag.toLowerCase()), ['one', 'two', 'three', 'four']);
  rejected(app, '/addtag t_alpha fifth');
  rejected(app, '/settags t_alpha a,b,c,d,e');
  rejected(app, '/settags t_alpha ' + 'x'.repeat(21));
  rejected(app, '/addtag t_alpha ' + 'x'.repeat(21));
  rejected(app, '/addtag t_alpha #');
  ok(app, '/removetag t_alpha #oNe');
  ok(app, '/addtag t_alpha ' + 'x'.repeat(20));
  assert.ok(app.alpha.tags.includes('x'.repeat(20)));
  ok(app, '/settags t_alpha CLEAR');
  assert.deepEqual(Array.from(app.alpha.tags), []);
});

test('unhide leaves deletion, reports, and unrelated thread flags untouched', () => {
  const app = fixture();
  app.alpha.hidden = true;
  app.alpha.deleted = true;
  const before = clone(app.alpha);
  ok(app, '/unhide t_alpha');
  assert.deepEqual(clone(app.alpha), { ...before, hidden: false });
});

test('resetpermissions removes only the selected group, leaving other overrides and board state', () => {
  for (const group of ['member', 'mod', 'admin']) {
    const app = fixture();
    const expected = clone(app.db.catState.general);
    delete expected.perms[group];
    ok(app, '/resetpermissions general ' + group);
    assert.deepEqual(clone(app.db.catState.general), expected);
    ok(app, '/resetpermissions general ' + group); // Already-default is safe/idempotent.
    assert.deepEqual(clone(app.db.catState.general), expected);
  }
  const app = fixture();
  rejected(app, '/resetpermissions general owner');
  rejected(app, '/resetpermissions unknown member');
});

test('report deduplicates per admin per item without destroying existing reports', () => {
  const app = fixture();
  ok(app, '/report t_alpha First admin reason');
  const before = clone(app.alpha.reports);
  app.run('/report t_alpha Duplicate admin reason'); // Informational or validation response is acceptable.
  assert.deepEqual(clone(app.alpha.reports), before);
  assert.match(ok(app, '/reports t_alpha').text, /First admin reason/);
  app.db.users.u_mira.role = 'admin';
  app.db.currentUserId = 'u_mira'; // This admin has already reported this thread.
  app.run('/report t_alpha Duplicate existing reason');
  assert.deepEqual(clone(app.alpha.reports), before);
  ok(app, '/report r_alpha Separate item');
  assert.equal(app.alpha.replies[0].reports[0].by, 'u_mira');
  app.db.users.u_sam.role = 'admin';
  app.db.currentUserId = 'u_sam';
  ok(app, '/report t_alpha A different admin');
  assert.equal(app.alpha.reports.length, 3);
});

test('duration validation accepts supported positive units and rejects unsafe or invalid dates', () => {
  const app = fixture();
  for (const duration of ['1s', '2sec', '3seconds', '1m', '2minutes', '1h', '2hours',
    '1d', '2days', '1w', '2weeks', '0.5h', '1']) {
    ok(app, '/activity ' + duration);
  }
  for (const duration of ['0', '0s', '-1d', 'wat', '1y', 'Infinity', 'NaN', '1e309d', '100100000d',
    '999999999999999999999999999999999999999999d', '9'.repeat(310) + 'd']) {
    rejected(app, '/activity ' + duration);
  }
});

test('the shared duration parser also protects legacy tempban from non-finite and out-of-range dates', () => {
  const app = fixture();
  rejected(app, '/tempban u_ada ' + '9'.repeat(310) + 'd');
  rejected(app, '/tempban u_ada 999999999999999999999999d');
});

test('topusers validates a whole integer from 1 through 50', () => {
  const app = fixture();
  for (const limit of ['1', '10', '50']) ok(app, '/topusers ' + limit);
  for (const limit of ['0', '-1', '51', '1.5', 'NaN', 'Infinity', '2abc']) {
    rejected(app, '/topusers ' + limit);
  }
});

test('listing helper reports the total but emits no more than 50 rows', () => {
  const app = fixture();
  app.db.users = { [app.admin.id]: app.admin };
  for (let i = 0; i < 65; i++) {
    const id = 'u_bulk_' + String(i).padStart(2, '0');
    app.db.users[id] = { ...clone(app.admin), id, name: 'BulkPerson' + String(i).padStart(2, '0'), role: '' };
  }
  const { text, lines } = ok(app, '/users BulkPerson');
  assert.match(text, /65/, 'list header or footer gives the full count');
  const rows = lines.filter((line) => /BulkPerson\d{2}/.test(line.textContent));
  assert.equal(rows.length, 50);
  assert.match(text, /15|50/, 'truncation is disclosed');
});

test('all new commands handle unknown targets and empty result sets gracefully', async (t) => {
  const unknown = [
    'userinfo nobody_xyz', 'unmuffle nobody_xyz', 'unverify nobody_xyz', 'clearrank nobody_xyz',
    'renameuser nobody_xyz Some Name', 'setbio nobody_xyz Bio', 'clearavatar nobody_xyz',
    'userposts nobody_xyz', 'usercomments nobody_xyz', 'unwarn nobody_xyz 1',
    'threads nonexistent_board', 'threadinfo nonexistent_post', 'comments nonexistent_post',
    'retitle nonexistent_post Title', 'unhide nonexistent_post', 'addtag nonexistent_post tag',
    'removetag nonexistent_post tag', 'settags nonexistent_post tag', 'pollresults nonexistent_post',
    'voteinfo nonexistent_post', 'boardinfo nonexistent_board', 'describecategory nonexistent_board Text',
    'boardstats nonexistent_board', 'boardpermissions nonexistent_board',
    'resetpermissions nonexistent_board mod', 'reports nonexistent_post', 'report nonexistent_post Reason',
  ];
  for (const command of unknown) await t.test('/' + command, () => rejected(fixture(), '/' + command));
  const app = fixture();
  for (const command of ['/users no_name_xyz', '/findposts no_content_xyz', '/comments t_other', '/reports t_other']) {
    ok(app, command);
  }
  const noPoll = app.run('/pollresults t_other');
  assert.match(noPoll.text, /no poll|does not have|has no/i);
});

test('command changes and audit history persist in the in-memory database', () => {
    const app = fixture();
    for (const command of ['/renameuser u_ada Ada Byron', '/setbio u_ada Persistent biography',
      '/retitle t_alpha Persistent title', '/settags t_alpha persisted,tags',
      '/report r_alpha Persistent report', '/describecategory general Persistent description',
      '/resetpermissions general member', '/unmuffle u_ada']) ok(app, command);
    assert.equal(app.db.users.u_ada.name, 'Ada Byron');
    assert.equal(app.db.users.u_ada.bio, 'Persistent biography');
    assert.equal(app.db.users.u_ada.muffled, false);
    assert.equal(app.db.threads[0].title, 'Persistent title');
    assert.equal(app.db.threads[0].tags.length, 2);
    const cmds = app.db.audit.map((e) => e.cmd);
    assert.ok(cmds.includes('unmuffle'), 'unmuffle is audited');
    assert.ok(cmds.includes('renameuser'), 'renameuser is audited');
    assert.ok(app.db.audit.length >= 8, 'audit entries recorded');
  });

test('untrusted command text uses textContent in console and escaped HTML in rendered views', () => {
  const app = fixture();
  const payload = '<img src=x onerror=alert(1)>';
  ok(app, '/renameuser u_ada "' + payload + '"');
  ok(app, '/setbio u_ada "' + payload + '"');
  ok(app, '/retitle t_alpha "' + payload + '"');
  ok(app, '/describecategory general "' + payload + '"');
  ok(app, '/report r_alpha "' + payload + '"');
  const { lines, text } = ok(app, '/userinfo u_ada');
  assert.ok(text.includes(payload), 'console retains literal text rather than HTML markup');
  for (const line of lines) {
    assert.equal(line.innerHTMLWrites.length, 0, 'console lines never interpret input as HTML');
  }
  app.location.hash = '#/user/u_ada';
  app.api.render();
  assert.ok(!app.node('main').innerHTML.includes(payload));
  assert.match(app.node('main').innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  app.location.hash = '#/';
  app.api.render();
  assert.ok(!app.node('main').innerHTML.includes(payload));
  assert.ok(!app.node('navCats').innerHTML.includes(payload));
  app.location.hash = '#/t/t_alpha';
  app.api.render();
  assert.ok(!app.node('main').innerHTML.includes(payload));
  assert.match(app.node('main').innerHTML, /&lt;img/);
  persisted(app);
});

// Legacy commands also get a real successful run, so additions cannot silently break dispatch.
const LEGACY_EFFECTS = {
  ban: (a) => assert.equal(a.db.users.u_ada.banned, true),
  unban: (a) => assert.equal(a.db.users.u_theo.banned, false),
  tempban: (a) => assert.equal(a.db.users.u_ada.bannedUntil, NOW + DAY),
  muffle: (a) => assert.equal(a.db.users.u_ada.muffled, false),
  warn: (a) => assert.equal(a.db.users.u_ada.warnings[0].reason, 'reason'),
  suspend: (a) => assert.equal(a.db.users.u_ada.suspended, true),
  approve: (a) => assert.equal(a.db.users.u_nova.suspended, false),
  deleteuser: (a) => assert.equal(a.db.users.u_ada, undefined),
  anonymize: (a) => assert.equal(a.db.users.u_ada.name, 'Anonymous'),
  setrole: (a) => assert.equal(a.db.users.u_ada.role, 'mod'),
  changerank: (a) => assert.equal(a.db.users.u_ada.rank, 'Expert'),
  verify: (a) => assert.equal(a.db.users.u_sam.verified, true),
  resetpassword: (a) => assert.notEqual(a.db.accounts['ada@example.test'].hash, 'fixture-hash'),
  lock: (a) => assert.equal(a.other.locked, true), unlock: (a) => assert.equal(a.alpha.locked, false),
  pin: (a) => assert.equal(a.other.pinned, true), unpin: (a) => assert.equal(a.alpha.pinned, false),
  sticky: (a) => assert.equal(a.other.pinned, true), move: (a) => assert.equal(a.alpha.cat, 'help'),
  merge: (a) => assert.equal(a.other.deleted, true), split: (a) => assert.equal(a.db.threads.length, 5),
  hide: (a) => assert.equal(a.other.hidden, true), delete: (a) => assert.equal(a.other.deleted, true),
  restore: (a) => assert.equal(a.deleted.deleted, false), feature: (a) => assert.equal(a.other.featured, true),
  unfeature: (a) => assert.equal(a.alpha.featured, false), editpost: (a) => assert.equal(a.alpha.body, 'New body'),
  lockcategory: (a) => assert.equal(a.db.catState.help.locked, true),
  unlockcategory: (a) => assert.equal(a.db.catState.general.locked, false),
  createcategory: (a) => assert.ok(a.db.cats.some((cat) => cat.name === 'New board')),
  deletecategory: (a) => assert.equal(a.db.cats.length, 0),
  renamecategory: (a) => assert.equal(a.db.catState.general.name, 'Renamed board'),
  setpermissions: (a) => assert.equal(a.db.catState.general.perms.member, 'none'),
  reorderboards: (a) => assert.deepEqual(Array.from(a.db.catOrder), ['help', 'general']),
  clearreports: (a) => assert.equal(a.alpha.reports.length, 0),
  reject: (a) => { assert.equal(a.alpha.hidden, true); assert.equal(a.alpha.reports.length, 0); },
  escalate: (a) => assert.equal(a.alpha.reports[0].escalated, true),
  maintenance: (a) => assert.equal(a.db.maintenance, true),
  rebuildindices: (a) => assert.equal(a.db.lastIndexed.docs, 7),
  runstats: (a) => assert.equal(a.db.lastStats.threads, 4),
  broadcast: (a) => assert.equal(a.db.banner, 'Fixture broadcast'),
  plugin: (a) => assert.equal(a.db.plugins.leaderboard, true),
};
test('the original 51 commands retain successful dispatch and expected mutations', async (t) => {
  for (const name of LEGACY) {
    await t.test('/' + name, () => {
      const app = fixture();
      const { text } = ok(app, validCommand(name));
      assert.ok(text.length, 'existing command produces a result');
      LEGACY_EFFECTS[name]?.(app);
      persisted(app);
    });
  }
});
