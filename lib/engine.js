'use strict';
const { norm, levenshtein } = require('./util');
const { OUT_OF_BOUNDS, TOO_BROAD, COVERAGE } = require('./day001');

/* ---------------------------------------------------------------- tiers */
const TIERS = [
  { id: 'plankton',      name: 'Plankton',         points: 10,  minShare: 0.25 },
  { id: 'too_clever',    name: 'Too Clever',       points: 25,  minShare: 0.12 },
  { id: 'schooler',      name: 'Schooler',         points: 40,  minShare: 0.06 },
  { id: 'rare',          name: 'Rare',             points: 60,  minShare: 0.03 },
  { id: 'deep_cut',      name: 'Deep Cut',         points: 80,  minShare: 0.01 },
  { id: 'one_in_blanion', name: 'One in a BLANION', points: 100, minShare: 0 },
];
const TIER_BY_ID = Object.fromEntries(TIERS.map(t => [t.id, t]));

/** Provisional priors fade out linearly as real submissions arrive; gone at PRIOR_FADE valid submissions. */
const PRIOR_FADE = 100;
const MIN_SOLE_TOTAL = 10;

function effectiveShare(count, total, prior) {
  const k = Math.max(0, PRIOR_FADE - total);
  return (count + prior * k) / (total + k || 1);
}

function tierFor(count, total, prior) {
  const k = Math.max(0, PRIOR_FADE - total);
  // Sole submitter of an unexpected answer is a "One in a BLANION" (once the field is big enough to mean something).
  if (count === 1 && total >= MIN_SOLE_TOTAL && (k === 0 || prior < 0.05)) return TIER_BY_ID.one_in_blanion;
  const share = effectiveShare(count, total, prior);
  for (const t of TIERS) if (share >= t.minShare) return t;
  return TIERS[TIERS.length - 1];
}

/* -------------------------------------------------------------- matching */
const accepted = a => a.status === 'curated' || a.status === 'approved';

function allNames(a) { return [a.canonical, ...(a.aliases || []), ...(a.abbreviations || [])]; }

/** Build lookup index for a question: normalised name -> Set(answerId). */
function buildIndex(answers, q) {
  const byName = new Map();
  const list = answers.filter(a => a.q === q && accepted(a));
  for (const a of list) {
    for (const nm of allNames(a)) {
      const k = norm(nm);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(a.id);
    }
  }
  return { byName, list, byId: new Map(list.map(a => [a.id, a])) };
}

function fuzzyLimit(len) { return len <= 4 ? 0 : len <= 8 ? 1 : 2; }

/**
 * resolve(): never *invents* an answer. It only maps text onto answers already in the curated/approved database.
 * Returns one of:
 *  {kind:'blank'} {kind:'invalid'} {kind:'blocked', reason}
 *  {kind:'match', answer, via} {kind:'ambiguous', options:[answer]}
 *  {kind:'unknown', suggestion:{answer, distance}|null}
 */
function resolve(index, rawText) {
  const text = String(rawText == null ? '' : rawText).trim();
  if (!text) return { kind: 'blank' };
  const n = norm(text);
  if (n.length < 2 || !/[a-z]{2}/.test(n)) return { kind: 'invalid' };
  if (TOO_BROAD.includes(n)) return { kind: 'blocked', reason: 'Too broad — BLANION wants something specific within the coverage area.' };

  // 1. exact (after normalisation)
  const exact = index.byName.get(n);
  if (exact) {
    const ids = [...exact];
    return ids.length === 1
      ? { kind: 'match', answer: index.byId.get(ids[0]), via: 'exact' }
      : { kind: 'ambiguous', options: ids.map(i => index.byId.get(i)) };
  }

  // 2. known out-of-boundary names
  for (const o of OUT_OF_BOUNDS) if (o.names.some(x => norm(x) === n)) return { kind: 'blocked', reason: o.reason, auto: true };

  // 3. fuzzy (typos)
  const lim = fuzzyLimit(n.length);
  let best = Infinity, bestIds = new Set();
  if (lim > 0) {
    for (const [name, ids] of index.byName) {
      if (Math.abs(name.length - n.length) > lim) continue;
      const d = levenshtein(n, name);
      if (d <= lim) {
        if (d < best) { best = d; bestIds = new Set(ids); }
        else if (d === best) ids.forEach(i => bestIds.add(i));
      }
    }
    if (bestIds.size === 1) return { kind: 'match', answer: index.byId.get([...bestIds][0]), via: 'fuzzy' };
    if (bestIds.size > 1) return { kind: 'ambiguous', options: [...bestIds].map(i => index.byId.get(i)) };
  }

  // 4. prefix (e.g. "Castleknock" for a question where several clubs start with it)
  if (n.length >= 4) {
    const pref = new Map(); // answerId -> best coverage ratio
    for (const [name, ids] of index.byName) {
      if (name.startsWith(n + ' ')) for (const id of ids) pref.set(id, Math.max(pref.get(id) || 0, n.length / name.length));
    }
    if (pref.size > 1) return { kind: 'ambiguous', options: [...pref.keys()].map(i => index.byId.get(i)) };
    if (pref.size === 1) {
      const [[id, ratio]] = [...pref];
      if (ratio >= 0.7) return { kind: 'match', answer: index.byId.get(id), via: 'prefix' };
    }
  }

  return { kind: 'unknown', suggestion: suggest(index, n) };
}

/** Duplicate-detection hint for admins: nearest known name, by edit distance or token overlap. */
function suggest(index, n) {
  let best = null;
  const toks = new Set(n.split(' ').filter(t => t.length > 2));
  for (const [name, ids] of index.byName) {
    const d = levenshtein(n, name);
    const rel = d / Math.max(n.length, name.length);
    const nt = name.split(' ').filter(t => t.length > 2);
    const overlap = nt.length ? nt.filter(t => toks.has(t)).length / Math.max(nt.length, toks.size || 1) : 0;
    const score = Math.min(rel, 1 - overlap);
    if (score < 0.5 && (!best || score < best.score)) best = { score, id: [...ids][0], distance: d, name };
  }
  return best ? { answerId: best.id, distance: best.distance, matchedName: best.name, confidence: Math.round((1 - best.score) * 100) } : null;
}

/* ------------------------------------------------------------- boundary */
function allowedAreas(includeExtended) {
  return includeExtended ? [...COVERAGE.core, ...COVERAGE.extended] : [...COVERAGE.core];
}
function inBbox(lat, lng) {
  const b = COVERAGE.bbox;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

module.exports = { TIERS, TIER_BY_ID, PRIOR_FADE, effectiveShare, tierFor, buildIndex, resolve, suggest, accepted, allowedAreas, inBbox };
