'use strict';
/**
 * Durable Object store: keeps the whole game state in memory (single writer => consistent counts and scoring)
 * and persists it to Durable Object storage as one key per record, writing only what changed.
 */
const { blankState, appendAudit, verifyChain } = require('../lib/state');
const { uid } = require('../lib/util');

const pad = n => String(n).padStart(8, '0');

function createDoStore(storage, env) {
  let db;
  const subIndex = new Map();
  const snap = new Map();            // storage key -> last persisted JSON string
  let auditDone = 0, subsDone = 0;
  const touched = { full: false, plays: new Set(), players: new Set(), subs: new Set() };

  async function load() {
    const all = await storage.list();
    if (!all.has('meta')) {
      db = blankState(env.LAUNCH_DATE);
      appendAudit(db, 'system', 'init', 'store', { seededAnswers: db.answers.length, launchDate: db.meta.launchDate, runtime: 'cloudflare-durable-object' });
      touched.full = true; auditDone = 0; subsDone = 0;
      await persist(true);
      return;
    }
    db = { meta: all.get('meta'), days: all.get('days') || {}, answers: [], players: {}, plays: [], submissions: [], audit: [] };
    for (const [k, v] of all) {
      snap.set(k, JSON.stringify(v));
      if (k.startsWith('ans:')) db.answers.push(v);
      else if (k.startsWith('pl:')) db.players[v.id] = v;
      else if (k.startsWith('play:')) db.plays.push(v);
      else if (k.startsWith('sub:')) db.submissions.push(v);
      else if (k.startsWith('aud:')) db.audit.push(v);
    }
    db.plays.sort((a, b) => a.startedAt - b.startedAt);
    db.submissions.sort((a, b) => a.at - b.at);
    db.audit.sort((a, b) => a.seq - b.seq);
    db.answers.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (env.LAUNCH_DATE) db.meta.launchDate = env.LAUNCH_DATE;
    db.submissions.forEach(s => subIndex.set(s.id, s));
    auditDone = db.audit.length; subsDone = db.submissions.length;
  }

  /** Write only records that changed since the last persist. Call after every request. */
  async function persist(first) {
    const writes = {};
    const check = (key, val) => { const j = JSON.stringify(val); if (snap.get(key) !== j) { snap.set(key, j); writes[key] = val; } };
    check('meta', db.meta); check('days', db.days);
    for (let i = auditDone; i < db.audit.length; i++) check('aud:' + pad(db.audit[i].seq), db.audit[i]);
    auditDone = db.audit.length;
    for (let i = subsDone; i < db.submissions.length; i++) check('sub:' + db.submissions[i].id, db.submissions[i]);
    subsDone = db.submissions.length;
    if (touched.full || first) {
      db.answers.forEach(a => check('ans:' + a.id, a));
      db.submissions.forEach(s => check('sub:' + s.id, s));
    }
    touched.subs.forEach(id => { const s = subIndex.get(id); if (s) check('sub:' + id, s); });
    touched.players.forEach(id => { if (db.players[id]) check('pl:' + id, db.players[id]); });
    if (touched.plays.size) {
      const ids = touched.plays;
      for (const p of db.plays) if (ids.has(p.id)) check('play:' + p.id, p);
    }
    touched.full = false; touched.plays.clear(); touched.players.clear(); touched.subs.clear();
    const keys = Object.keys(writes);
    // issue all puts synchronously, in order, so concurrent requests cannot reorder writes
    const jobs = [];
    for (let i = 0; i < keys.length; i += 100) { const chunk = {}; keys.slice(i, i + 100).forEach(k => chunk[k] = writes[k]); jobs.push(storage.put(chunk)); }
    await Promise.all(jobs);
  }

  return {
    load, persist,
    get db() { return db; },
    save() {},                                   // persistence happens in persist(), after the request
    flush() {},
    audit(actor, action, target, detail) { return appendAudit(db, actor, action, target, detail); },
    verifyAudit: () => verifyChain(db),
    addSubmission(s) { s.id = 's_' + uid(6); db.submissions.push(s); subIndex.set(s.id, s); return s; },
    getSubmission: id => subIndex.get(id),
    touch(kind, id) {
      if (kind === 'full') touched.full = true;
      else if (kind === 'play') touched.plays.add(id);
      else if (kind === 'player') touched.players.add(id);
      else if (kind === 'sub') touched.subs.add(id);
    },
  };
}

module.exports = { createDoStore };
