'use strict';
/** Platform-neutral state helpers shared by the Node file store and the Cloudflare Durable Object store. */
const { sha256, dateKey } = require('./util');
const { buildSeedAnswers } = require('./day001');

function blankState(launchDate) {
  const today = dateKey(Date.now());
  return {
    meta: { launchDate: launchDate || today, createdAt: Date.now(), includeExtended: true, schema: 1 },
    days: {},          // { "1": { finalizedAt, final:{total:{q:n}, tiers:{q:{answerId:tierId}}} } }
    answers: buildSeedAnswers(today),
    players: {},       // { id: { id, nickname, createdAt } }
    plays: [],
    submissions: [],
    audit: [],
  };
}

/** Append-only, hash-chained audit trail. */
function appendAudit(db, actor, action, target, detail) {
  const prev = db.audit.length ? db.audit[db.audit.length - 1].hash : 'GENESIS';
  const entry = { seq: db.audit.length + 1, at: Date.now(), actor, action, target, detail: detail || {}, prev };
  entry.hash = sha256(prev + JSON.stringify([entry.seq, entry.at, actor, action, target, entry.detail]));
  db.audit.push(entry);
  return entry;
}
function verifyChain(db) {
  let prev = 'GENESIS';
  for (const e of db.audit) {
    const h = sha256(prev + JSON.stringify([e.seq, e.at, e.actor, e.action, e.target, e.detail]));
    if (e.prev !== prev || e.hash !== h) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, entries: db.audit.length };
}

module.exports = { blankState, appendAudit, verifyChain };
