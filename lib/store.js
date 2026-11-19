'use strict';
const fs = require('fs');
const path = require('path');
const { uid, sha256, dateKey } = require('./util');
const { buildSeedAnswers } = require('./day001');

const FILE = process.env.BLANION_DATA || path.join(__dirname, '..', 'data', 'store.json');

function blank() {
  const today = dateKey(Date.now());
  return {
    meta: { launchDate: process.env.LAUNCH_DATE || today, createdAt: Date.now(), includeExtended: true, schema: 1 },
    days: {},          // { "1": { finalizedAt, final:{total:{q:n}, tiers:{q:{answerId:tierId}}} } }
    answers: buildSeedAnswers(today),
    players: {},       // { id: { id, nickname, createdAt } }
    plays: [],
    submissions: [],
    audit: [],
  };
}

let db;
let saveTimer = null;
const subIndex = new Map();

function load() {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { db = blank(); }
  if (process.env.LAUNCH_DATE) db.meta.launchDate = process.env.LAUNCH_DATE;
  subIndex.clear();
  db.submissions.forEach(s => subIndex.set(s.id, s));
  if (!db.audit.length) audit('system', 'init', 'store', { seededAnswers: db.answers.length, launchDate: db.meta.launchDate });
  flush();
  return db;
}

function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
function save() { if (!saveTimer) saveTimer = setTimeout(flush, 400); }

/** Append-only, hash-chained audit trail. Every admin decision and every score-affecting event goes through here. */
function audit(actor, action, target, detail) {
  const prev = db.audit.length ? db.audit[db.audit.length - 1].hash : 'GENESIS';
  const entry = { seq: db.audit.length + 1, at: Date.now(), actor, action, target, detail: detail || {}, prev };
  entry.hash = sha256(prev + JSON.stringify([entry.seq, entry.at, actor, action, target, entry.detail]));
  db.audit.push(entry);
  save();
  return entry;
}
function verifyAudit() {
  let prev = 'GENESIS';
  for (const e of db.audit) {
    const h = sha256(prev + JSON.stringify([e.seq, e.at, e.actor, e.action, e.target, e.detail]));
    if (e.prev !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, entries: db.audit.length };
}

function addSubmission(s) { s.id = 's_' + uid(6); db.submissions.push(s); subIndex.set(s.id, s); save(); return s; }
const getSubmission = id => subIndex.get(id);

module.exports = { load, flush, save, audit, verifyAudit, addSubmission, getSubmission, get db() { return db; } };
