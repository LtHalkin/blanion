'use strict';
/** Platform-neutral state helpers shared by the Node file store and the Cloudflare Durable Object store. */
const { sha256, dateKey } = require('./util');
const { buildSeedAnswers } = require('./day001');
const BANK = require('./bank.json');

function blankState(launchDate) {
  const today = dateKey(Date.now());
  const db = {
    meta: { launchDate: launchDate || today, createdAt: Date.now(), includeExtended: true, schema: 1, seedVersion: 1 },
    days: {},          // { "1": { finalizedAt, final:{total:{q:n}, tiers:{q:{answerId:tierId}}} } }
    answers: buildSeedAnswers(today),
    players: {},       // { id: { id, nickname, createdAt } }
    plays: [],
    submissions: [],
    audit: [],
  };
  syncSeeds(db);   // add the OSM-sourced bank on top of the hand-curated Day 001 seed
  return db;
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

/**
 * Bring an already-running store up to the current bundled answer bank (lib/bank.json).
 *  - adds bank answers whose id is not present yet (never removes or overwrites anything an admin touched)
 *  - enriches untouched seed answers with real coordinates / sources / extra aliases
 * Safe to run repeatedly. Returns null if nothing to do.
 */
function syncSeeds(db) {
  if ((db.meta.seedVersion || 1) >= BANK.version) return null;
  const have = new Map(db.answers.map(a => [a.id, a]));
  // answers an admin has edited (including edits made before the `edited` flag existed) are never overwritten
  const adminEdited = new Set((db.audit || []).filter(e => e.action === 'answer.update').map(e => String(e.target).replace('answer:', '')));
  let added = 0, enriched = 0;
  for (const b of BANK.answers) {
    if (have.has(b.id)) continue;
    db.answers.push(materialize(b)); added++;
  }
  for (const [id, e] of Object.entries(BANK.enrich || {})) {
    const a = have.get(id);
    if (!a || a.edited || adminEdited.has(id) || a.addedBy !== 'seed:day001') continue;
    if (e.lat != null) { a.lat = e.lat; a.lng = e.lng; a.coordPrecision = 'osm-point'; }
    if (e.source && !a.sources.includes(e.source)) a.sources.push(e.source);
    if (e.aliases) { const have2 = new Set([a.canonical, ...a.aliases].map(x => x.toLowerCase())); for (const al of e.aliases) if (!have2.has(al.toLowerCase())) a.aliases.push(al); }
    if (e.area) a.area = e.area;
    if (e.osm) a.osm = e.osm;
    if (e.flag !== undefined && !a.flagCleared) { a.flag = e.flag; a.verification = e.flag ? 'flagged' : 'osm-located'; }
    else if (e.lat != null && !a.flag && a.verification === 'curated-unverified') a.verification = 'osm-located';
    enriched++;
  }
  db.meta.seedVersion = BANK.version;
  return { added, enriched, version: BANK.version };
}

function materialize(b) {
  return {
    id: b.id, q: b.q, canonical: b.canonical, aliases: b.aliases || [], abbreviations: [],
    category: b.category, area: b.area, areaBasis: b.areaBasis, location: b.location,
    lat: b.lat, lng: b.lng, coordPrecision: 'osm-point',
    source: b.source, sources: b.sources || [b.source], osm: b.osm,
    verifiedAt: BANK.generatedAt, status: 'curated', verification: 'osm-sourced', flag: b.flag || null,
    prior: b.prior == null ? 0.004 : b.prior, note: b.note || null, addedBy: 'seed:osm',
  };
}

module.exports = { blankState, appendAudit, verifyChain, syncSeeds, BANK };
