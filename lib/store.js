'use strict';
/** Node file-backed store (single JSON file, atomic writes). Used by server.js. */
const fs = require('fs');
const path = require('path');
const { uid } = require('./util');
const { blankState, appendAudit, verifyChain, syncSeeds } = require('./state');

const FILE = process.env.BLANION_DATA || path.join(__dirname, '..', 'data', 'store.json');

let db;
let saveTimer = null;
const subIndex = new Map();

function load() {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { db = blankState(process.env.LAUNCH_DATE); }
  if (process.env.LAUNCH_DATE) db.meta.launchDate = process.env.LAUNCH_DATE;
  subIndex.clear();
  db.submissions.forEach(s => subIndex.set(s.id, s));
  const sync = syncSeeds(db);
  if (sync) audit('system', 'seed.sync', 'answers', sync);
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
function audit(actor, action, target, detail) { const e = appendAudit(db, actor, action, target, detail); save(); return e; }
const verifyAudit = () => verifyChain(db);
function addSubmission(s) { s.id = 's_' + uid(6); db.submissions.push(s); subIndex.set(s.id, s); save(); return s; }
const getSubmission = id => subIndex.get(id);
const touch = () => {};   // only needed by the incremental Durable Object store

module.exports = { load, flush, save, audit, verifyAudit, addSubmission, getSubmission, touch, get db() { return db; } };
