'use strict';
/**
 * BLANION game core (platform neutral).
 */
const crypto = require('node:crypto');
const { dateKey, addDays, diffDays, dublinMidnight, norm, uid } = require('./util');
const { QUESTIONS, COVERAGE, CENTROIDS } = require('./day001');
const E = require('./engine');
const Bot = require('./bot');

const LIMIT_MS = 25000;       // 25 seconds per question
const GRACE_MS = 1500;        // network latency allowance
const Q_COUNT = 7;
const MAX_SCORE = 700;
const DAYS = { 1: QUESTIONS }; // day number -> question set. Add Day 002+ here when written.
const ADMIN_TTL = 12 * 3600e3;

const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

/**
 * createApp({ store, adminPassword }) -> { handle(req, url) -> {code, body} }
 * req = { method, headers (lower-case keys), ip, json() }. Platform neutral: used by server.js (Node) and the Worker.
 */
function createApp(opts) {
const S = opts.store;
const db = () => S.db;
const ADMIN_PASSWORD = opts.adminPassword || '';
const doFetch = opts.fetch || ((...a) => fetch(...a));
const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
const BOT_UA = opts.botUserAgent || 'blanion-answer-bot/1.0';

/* ------------------------------------------------------------ time & days */
const dayDate = n => addDays(db().meta.launchDate, n - 1);
const dayStart = n => dublinMidnight(dayDate(n));
const dayEnd = n => dublinMidnight(addDays(dayDate(n), 1));
const isFinal = n => !!(db().days[n] && db().days[n].final);

function clock() {
  const now = Date.now();
  const key = dateKey(now);
  return { now, key, n: diffDays(db().meta.launchDate, key) + 1 };
}

const DEPTHS = [
  { at: 0,   name: 'Sunlit Shallows', m: 0 },
  { at: 100, name: 'Kelp Forest', m: 150 },
  { at: 250, name: 'Twilight Zone', m: 400 },
  { at: 430, name: 'Midnight Trench', m: 700 },
  { at: 600, name: 'The Abyss', m: 900 },
];
const depthFor = score => {
  let z = DEPTHS[0];
  for (const d of DEPTHS) if (score >= d.at) z = d;
  return { zone: z.name, metres: Math.round((score / MAX_SCORE) * 1000) };
};

function finalizeDay(n, actor, reason) {
  const d = (db().days[n] ||= {});
  if (d.final) return false;
  const st = dayStats(n);
  const tiers = {}, total = {};
  for (let q = 1; q <= Q_COUNT; q++) {
    total[q] = st.total[q] || 0;
    tiers[q] = {};
    for (const [aid, c] of Object.entries(st.counts[q] || {})) {
      const a = answerById(aid);
      tiers[q][aid] = E.tierFor(c, total[q], a ? a.prior : 0.01).id;
    }
  }
  d.final = { total, tiers };
  d.finalizedAt = Date.now();
  d.finalizedBy = actor;
  S.audit(actor, 'day.finalize', `day:${n}`, { reason: reason || 'challenge closed', totals: total, plays: st.plays.length });
  return true;
}
function autoFinalize() {
  const { now } = clock();
  for (const n of Object.keys(DAYS).map(Number)) if (now >= dayEnd(n) && !isFinal(n) && now >= dayStart(n)) finalizeDay(n, 'system', 'challenge closed at midnight (Europe/Dublin)');
}
const isOpen = n => { const { now } = clock(); return !!DAYS[n] && now >= dayStart(n) && now < dayEnd(n) && !isFinal(n); };

/* ----------------------------------------------------------- answer index */
let ansVersion = 0;
const idxCache = new Map();
const answerById = id => db().answers.find(a => a.id === id);
const areaOk = a => E.allowedAreas(db().meta.includeExtended).includes(a.area);
const isActive = a => !!a && E.accepted(a) && areaOk(a);
function indexFor(q) {
  const key = `${ansVersion}:${q}`;
  if (!idxCache.has(key)) {
    if (idxCache.size > 50) idxCache.clear();
    idxCache.set(key, E.buildIndex(db().answers.filter(isActive), q));
  }
  return idxCache.get(key);
}
const bump = () => { ansVersion++; S.save(); };

/* ------------------------------------------------------------ score maths */
function resolvedId(r) {
  let id = null;
  if (r.status === 'matched') id = r.answerId;
  else if (r.subId) {
    const s = S.getSubmission(r.subId);
    if (s && (s.status === 'approved' || s.status === 'merged')) id = s.resolvedAnswerId;
  }
  return id && isActive(answerById(id)) ? id : null;
}

function dayStats(n) {
  const plays = db().plays.filter(p => p.day === n);
  const counts = {}, total = {};
  for (const p of plays) for (const r of p.responses) {
    const id = resolvedId(r);
    if (!id) continue;
    ((counts[r.q] ||= {})[id] = (counts[r.q][id] || 0) + 1);
    total[r.q] = (total[r.q] || 0) + 1;
  }
  return { plays, counts, total };
}

function tierOf(n, q, answerId, st) {
  const a = answerById(answerId);
  const prior = a ? a.prior : 0.01;
  const count = (st.counts[q] && st.counts[q][answerId]) || 0;
  const d = db().days[n];
  if (d && d.final) {
    const t = (d.final.tiers[q] ||= {});
    if (!t[answerId]) { t[answerId] = E.tierFor(count, d.final.total[q] || 0, prior).id; S.save(); } // sticky once computed
    return E.TIER_BY_ID[t[answerId]];
  }
  return E.tierFor(count, st.total[q] || 0, prior);
}

function viewResponse(n, r, st) {
  const fin = isFinal(n);
  const base = { n: r.q, provisional: !fin, raw: r.raw || '' };
  if (r.status === 'timeout') return { ...base, status: 'timeout', correct: false, points: 0, message: "Time's up — the current carried your answer away." };
  const id = resolvedId(r);
  if (id) {
    const a = answerById(id), t = tierOf(n, r.q, id, st);
    const tot = fin ? db().days[n].final.total[r.q] : st.total[r.q];
    const cnt = (st.counts[r.q] && st.counts[r.q][id]) || 0;
    return {
      ...base, status: 'correct', correct: true, canonical: a.canonical, area: a.area, note: a.note, tier: t.id, tierName: t.name, points: t.points,
      known: db().answers.filter(x => x.q === r.q && isActive(x)).length,
      share: fin && tot >= 10 ? Math.round((cnt / tot) * 1000) / 10 : null,
      late: r.status !== 'matched',
    };
  }
  if (r.subId) {
    const s = S.getSubmission(r.subId);
    if (s && s.status === 'rejected') return { ...base, status: 'rejected', correct: false, points: 0, canAppeal: !s.appeal, appealed: !!s.appeal, message: s.reason || 'That answer was not accepted.', subStatus: 'rejected' };
    return { ...base, status: 'pending', correct: null, points: 0, canAppeal: !(s && s.appeal), appealed: !!(s && s.appeal), subStatus: s ? s.status : 'pending', message: 'Not in our log yet. It has been sent to the Harbour Masters for verification — your score updates automatically if it is approved.' };
  }
  return { ...base, status: 'rejected', correct: false, points: 0, message: 'That answer was not accepted.' };
}

function scorePlay(play, st) {
  let score = 0;
  const rs = play.responses.map(r => { const v = viewResponse(play.day, r, st); score += v.points || 0; return v; });
  return { rs, score };
}

/* ----------------------------------------------------------------- plays */
function settle(play) {
  const { now } = clock();
  if (!play.done && play.qStartedAt && now - play.qStartedAt > LIMIT_MS + GRACE_MS) {
    pushResponse(play, { q: play.index + 1, raw: '', status: 'timeout', ms: LIMIT_MS });
  }
}
function pushResponse(play, r) {
  r.at = Date.now();
  play.responses.push(r);
  S.touch('play', play.id);
  play.index++;
  play.qStartedAt = null;
  play.ambig = 0;
  if (play.index >= Q_COUNT) { play.done = true; play.finishedAt = Date.now(); }
  S.save();
}

function playView(play) {
  settle(play);
  const st = dayStats(play.day);
  const { rs, score } = scorePlay(play, st);
  const { now } = clock();
  let question = null;
  if (!play.done && play.qStartedAt) {
    question = { n: play.index + 1, text: DAYS[play.day][play.index].text, category: DAYS[play.day][play.index].category, remainingMs: Math.max(0, LIMIT_MS - (now - play.qStartedAt)), limitMs: LIMIT_MS };
  }
  return {
    id: play.id, day: play.day, done: play.done, index: play.index, total: Q_COUNT, responses: rs, score, maxScore: MAX_SCORE,
    depth: depthFor(score), question, provisional: !isFinal(play.day), final: isFinal(play.day),
    nickname: (db().players[play.playerId] || {}).nickname, rank: play.done ? rankOf(play, st) : null,
    closesAt: dayEnd(play.day),
  };
}

function board(n, st) {
  st = st || dayStats(n);
  const rows = st.plays.filter(p => p.done).map(p => {
    const { score } = scorePlay(p, st);
    return { p, score, ms: p.responses.reduce((a, r) => a + (r.ms || 0), 0) };
  });
  rows.sort((a, b) => b.score - a.score || a.ms - b.ms || a.p.finishedAt - b.p.finishedAt);
  return rows;
}
function rankOf(play, st) { const i = board(play.day, st).findIndex(r => r.p.id === play.id); return i < 0 ? null : i + 1; }

function sanitizeNick(s) {
  s = String(s || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return s.length >= 2 ? s : '';
}

/* ------------------------------------------------------------------- http */
class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }
const bad = (code, msg, extra) => { throw new HttpError(code, msg, extra); };
const send = (_res, code, obj) => ({ code, body: obj });
async function readBody(req) {
  try { return await req.json(); } catch (e) { throw new HttpError(e.status || 400, e.message || 'Invalid JSON'); }
}

const hits = new Map();
function limited(ip) {
  const t = Date.now(), arr = (hits.get(ip) || []).filter(x => t - x < 60000);
  arr.push(t); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 60000) hits.delete(k);
  return arr.length > 240;
}

/* --------------------------------------------------------- public routes */
function todayInfo() {
  autoFinalize();
  const { now, n } = clock();
  const maxDay = Math.max(...Object.keys(DAYS).map(Number));
  const shown = n < 1 ? 1 : Math.min(n, maxDay);
  const open = isOpen(shown);
  const st = dayStats(shown);
  return {
    day: shown, label: 'DAY ' + String(shown).padStart(3, '0'), date: dayDate(shown), status: n < 1 ? 'upcoming' : open ? 'open' : 'closed',
    open, final: isFinal(shown), opensAt: dayStart(shown), closesAt: dayEnd(shown), nextDayAt: dayEnd(Math.min(n, shown)),
    hasNextDay: !!DAYS[shown + 1], divers: st.plays.length, finished: st.plays.filter(p => p.done).length, now,
    questionCount: Q_COUNT, limitMs: LIMIT_MS,
  };
}

async function publicApi(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/config' && m === 'GET') {
    return send(res, 200, {
      tiers: E.TIERS, depths: DEPTHS, maxScore: MAX_SCORE, limitMs: LIMIT_MS, questionCount: Q_COUNT,
      coverage: { core: COVERAGE.core, extended: db().meta.includeExtended ? COVERAGE.extended : [] },
      today: todayInfo(),
    });
  }

  if (p === '/api/play/start' && m === 'POST') {
    const b = await readBody(req);
    const info = todayInfo();
    let player = b.playerId && db().players[b.playerId];
    if (!player) {
      const id = uid(12);
      player = db().players[id] = { id, nickname: sanitizeNick(b.nickname) || 'Diver' + Math.floor(1000 + Math.random() * 9000), createdAt: Date.now() };
    } else if (b.nickname && sanitizeNick(b.nickname)) player.nickname = sanitizeNick(b.nickname);
    let play = db().plays.find(x => x.playerId === player.id && x.day === info.day);
    if (!play) {
      if (!info.open) bad(409, info.status === 'upcoming' ? 'The first dive has not opened yet.' : 'This challenge has closed. Come back for the next dive!');
      play = { id: uid(12), playerId: player.id, day: info.day, startedAt: Date.now(), index: 0, qStartedAt: null, ambig: 0, responses: [], done: false };
      db().plays.push(play);
    }
    S.touch('player', player.id); S.touch('play', play.id);
    S.save();
    return send(res, 200, { playerId: player.id, nickname: player.nickname, play: playView(play) });
  }

  if (p === '/api/play/state' && m === 'GET') {
    const play = db().plays.find(x => x.id === url.searchParams.get('playId'));
    if (!play) bad(404, 'Unknown dive');
    return send(res, 200, { play: playView(play) });
  }

  if (p === '/api/play/begin' && m === 'POST') {
    const b = await readBody(req);
    const play = db().plays.find(x => x.id === b.playId);
    if (!play) bad(404, 'Unknown dive');
    settle(play);
    if (play.done) return send(res, 200, { play: playView(play) });
    if (!isOpen(play.day) && !play.qStartedAt) bad(409, 'This challenge has closed.');
    if (!play.qStartedAt) { play.qStartedAt = Date.now(); S.touch('play', play.id); S.save(); }
    return send(res, 200, { play: playView(play) });
  }

  if (p === '/api/play/answer' && m === 'POST') {
    const b = await readBody(req);
    const play = db().plays.find(x => x.id === b.playId);
    if (!play) bad(404, 'Unknown dive');
    settle(play);
    if (play.done) bad(409, 'Dive already complete');
    if (!play.qStartedAt) { return send(res, 200, { outcome: 'timeout', play: playView(play), response: playView(play).responses.slice(-1)[0] }); }
    const text = String(b.answer == null ? '' : b.answer).slice(0, 120);
    const q = play.index + 1;
    const r = E.resolve(indexFor(q), text);
    const ms = Math.min(LIMIT_MS, Date.now() - play.qStartedAt);

    if (r.kind === 'blank') return send(res, 200, { outcome: 'invalid', message: 'Type an answer first.' });
    if (r.kind === 'invalid') return send(res, 200, { outcome: 'invalid', message: "That doesn't look like an answer. Try a name." });
    if (r.kind === 'ambiguous') {
      if (++play.ambig > 6) bad(429, 'Too many clarifications.');
      return send(res, 200, { outcome: 'ambiguous', message: 'More than one match — which did you mean?', options: r.options.map(a => a.canonical) });
    }

    let rec;
    if (r.kind === 'match') {
      rec = { q, raw: text, norm: norm(text), status: 'matched', answerId: r.answer.id, via: r.via, ms };
    } else {
      // Unknown / blocked: preserve the original submission for review; never auto-accept.
      const n = norm(text);
      const prior = db().submissions.find(s => s.q === q && s.norm === n);
      const sub = S.addSubmission({
        day: play.day, q, raw: text, norm: n, playerId: play.playerId, playId: play.id, at: Date.now(),
        status: r.kind === 'blocked' ? 'rejected' : prior ? prior.status : 'pending',
        auto: r.kind === 'blocked' || undefined,
        reason: r.kind === 'blocked' ? r.reason : prior && prior.status === 'rejected' ? prior.reason : undefined,
        resolvedAnswerId: prior && (prior.status === 'approved' || prior.status === 'merged') ? prior.resolvedAnswerId : undefined,
        suggestion: r.kind === 'unknown' ? r.suggestion : null, appeal: null,
      });
      rec = { q, raw: text, norm: n, status: 'pending', subId: sub.id, ms };
    }
    pushResponse(play, rec);
    const pv = playView(play);
    const response = pv.responses[pv.responses.length - 1];
    return send(res, 200, { outcome: response.status, response, play: pv });
  }

  if (p === '/api/play/appeal' && m === 'POST') {
    const b = await readBody(req);
    const play = db().plays.find(x => x.id === b.playId);
    if (!play) bad(404, 'Unknown dive');
    const r = play.responses[Number(b.index)];
    if (!r || !r.subId) bad(400, 'Nothing to appeal');
    const s = S.getSubmission(r.subId);
    if (s.appeal) bad(409, 'Already appealed');
    const note = String(b.note || '').trim().slice(0, 400);
    if (note.length < 3) bad(400, 'Tell us a little about it (name, where it is, a link if you have one).');
    s.appeal = { note, at: Date.now() };
    S.touch('sub', s.id); S.touch('play', play.id);
    const urlMatch = note.match(/https?:\/\/\S+/);
    if (urlMatch) s.proposedSource = urlMatch[0];
    if (s.status === 'rejected') { s.status = 'pending'; s.reason = undefined; } // any appeal puts the answer back in front of a human
    // propagate the appeal to the shared group so the admin sees it once
    S.save();
    return send(res, 200, { ok: true, play: playView(play) });
  }

  if (p === '/api/leaderboard' && m === 'GET') {
    autoFinalize();
    const n = Number(url.searchParams.get('day')) || todayInfo().day;
    const st = dayStats(n);
    const rows = board(n, st);
    const me = url.searchParams.get('playId');
    return send(res, 200, {
      day: n, final: isFinal(n), provisional: !isFinal(n), count: rows.length,
      rows: rows.slice(0, 50).map((r, i) => ({ rank: i + 1, nickname: (db().players[r.p.playerId] || {}).nickname || 'Diver', score: r.score, zone: depthFor(r.score).zone, me: r.p.id === me })),
      me: me ? (() => { const i = rows.findIndex(r => r.p.id === me); return i < 0 ? null : { rank: i + 1, score: rows[i].score }; })() : null,
    });
  }

  if (p === '/api/days' && m === 'GET') {
    autoFinalize();
    const { n } = clock();
    return send(res, 200, { days: Object.keys(DAYS).map(Number).filter(d => d <= Math.max(n, 1)).map(d => ({ day: d, date: dayDate(d), final: isFinal(d), open: isOpen(d) })) });
  }

  bad(404, 'No such endpoint');
}

/* ---------------------------------------------------------- admin routes */
const sign = exp => crypto.createHmac('sha256', ADMIN_PASSWORD).update('blanion-admin:' + exp).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function issueToken() { const exp = Date.now() + ADMIN_TTL; return exp + '.' + sign(exp); }
function adminAuth(req) {
  if (!ADMIN_PASSWORD) bad(503, 'Admin is disabled: the ADMIN_PASSWORD secret is not set.');
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now() || !safeEq(sig, sign(exp))) bad(401, 'Admin login required');
  return 'admin';
}

function groupKey(s) { return `${s.q}:${s.norm}`; }
function reviewGroups() {
  const map = new Map();
  for (const s of db().submissions) {
    const k = groupKey(s);
    let g = map.get(k);
    if (!g) { g = { key: k, q: s.q, qText: QUESTIONS[s.q - 1].text, norm: s.norm, raws: {}, players: new Set(), firstAt: s.at, lastAt: s.at, status: s.status, auto: !!s.auto, appeals: [], proposedSource: null, reason: s.reason, suggestion: s.suggestion, resolvedAnswerId: s.resolvedAnswerId, subIds: [], decisions: 0 }; map.set(k, g); }
    g.raws[s.raw] = (g.raws[s.raw] || 0) + 1;
    g.players.add(s.playerId);
    g.firstAt = Math.min(g.firstAt, s.at); g.lastAt = Math.max(g.lastAt, s.at);
    g.subIds.push(s.id);
    if (s.appeal) g.appeals.push({ note: s.appeal.note, at: s.appeal.at });
    if (s.bot && !g.bot) g.bot = s.bot;
    if (s.proposedSource && !g.proposedSource) g.proposedSource = s.proposedSource;
    // a group is "pending" if any member is still pending
    if (s.status === 'pending' || s.status === 'research') g.status = s.status;
  }
  const idx = {};
  return [...map.values()].map(g => {
    const sug = E.suggest(indexFor(g.q), g.norm);
    const sa = sug && answerById(sug.answerId);
    return { ...g, players: g.players.size, raws: Object.entries(g.raws).map(([raw, n]) => ({ raw, n })), suggestion: sa ? { answerId: sa.id, canonical: sa.canonical, confidence: sug.confidence, distance: sug.distance } : null, resolved: g.resolvedAnswerId ? (answerById(g.resolvedAnswerId) || {}).canonical : null };
  }).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.lastAt - a.lastAt);
}

function affectedBy(answerId) {
  let n = 0;
  for (const p of db().plays) if (p.responses.some(r => (r.status === 'matched' && r.answerId === answerId) || (r.subId && (S.getSubmission(r.subId) || {}).resolvedAnswerId === answerId))) n++;
  return n;
}
const httpUrl = s => { try { const u = new URL(String(s)); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
const uniq = arr => [...new Set(arr.map(x => String(x).trim()).filter(Boolean))];

/** Apply a decision to a group of identical unknown answers. Used by the admin endpoint AND the bot, so both obey the same rules. */
function decideGroup(b, actor) {
    const subs = db().submissions.filter(s => groupKey(s) === b.key);
    if (!subs.length) bad(404, 'Unknown submission group');
    const q = subs[0].q, n0 = subs[0].norm;
    const raws = uniq(subs.map(s => s.raw));
    const now = Date.now();
    const mark = (status, extra) => subs.forEach(s => Object.assign(s, { status, decidedAt: now, decidedBy: actor, ...extra }));
    let detail = { key: b.key, raws, question: q, players: new Set(subs.map(s => s.playerId)).size, note: String(b.note || '').slice(0, 300) };
    let answerTouched = null;
    if (b.botMeta) detail.bot = { confidence: b.botMeta.confidence, evidence: b.botMeta.evidence };

    if (b.action === 'approve') {
      const canonical = String(b.canonical || '').trim();
      if (canonical.length < 2 || canonical.length > 100) bad(422, 'Canonical name required (2–100 chars).');
      const src = httpUrl(b.source);
      if (!src) bad(422, 'A source URL (http/https) is required to approve an answer.');
      const area = String(b.area || '').trim();
      if (!E.allowedAreas(db().meta.includeExtended).includes(area)) bad(422, `"${area || '(none)'}" is not inside the approved BLANION boundary.`, { allowed: E.allowedAreas(db().meta.includeExtended) });
      let lat = b.lat === '' || b.lat == null ? null : Number(b.lat), lng = b.lng === '' || b.lng == null ? null : Number(b.lng);
      if ((lat == null) !== (lng == null)) bad(422, 'Provide both latitude and longitude, or neither.');
      if (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng) || !E.inBbox(lat, lng))) bad(422, 'Coordinates fall outside the Dublin 15 boundary box.');
      const idx = indexFor(q);
      const dupe = idx.byName.get(norm(canonical));
      if (dupe) bad(409, `"${canonical}" already exists as "${idx.byId.get([...dupe][0]).canonical}". Use MERGE instead.`);
      const aliases = uniq([...raws.filter(r => norm(r) !== norm(canonical)), ...(Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split(','))]);
      const [clat, clng] = CENTROIDS[area] || CENTROIDS['Blanchardstown'];
      const a = {
        id: `a${q}-${uid(4)}`, q, canonical, aliases, abbreviations: [], category: QUESTIONS[q - 1].category, area, location: String(b.location || `${area}, Dublin 15`).slice(0, 200),
        lat: lat != null ? lat : clat, lng: lng != null ? lng : clng, coordPrecision: lat != null ? 'admin-supplied' : 'area-centroid',
        source: src, sources: [src], verifiedAt: dateKey(now), status: 'approved', verification: b.botMeta ? 'bot-verified' : 'admin-verified', flag: null, prior: 0.01, note: null, addedBy: actor,
      };
      if (b.botMeta) { a.botConfidence = b.botMeta.confidence; a.evidence = b.botMeta.evidence; a.osm = b.osm; }
      db().answers.push(a); bump();
      mark('approved', { resolvedAnswerId: a.id });
      answerTouched = a.id; detail = { ...detail, canonical, area, source: src, aliases, newAnswerId: a.id };
    } else if (b.action === 'merge') {
      const target = answerById(b.mergeInto);
      if (!target || target.q !== q) bad(422, 'Choose an existing answer for this question.');
      target.aliases = uniq([...target.aliases, ...raws.filter(r => norm(r) !== norm(target.canonical)), ...(Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split(','))]);
      const src = httpUrl(b.source); if (src && !target.sources.includes(src)) target.sources.push(src);
      bump();
      mark('merged', { resolvedAnswerId: target.id });
      answerTouched = target.id; detail = { ...detail, mergedInto: target.canonical, targetId: target.id, addedAliases: raws };
    } else if (b.action === 'reject') {
      const reason = String(b.reason || '').trim().slice(0, 300);
      if (reason.length < 3) bad(422, 'A reason is required to reject an answer.');
      mark('rejected', { reason, auto: undefined }); detail.reason = reason;
    } else if (b.action === 'research') {
      mark('research', { reason: undefined }); detail.flagged = true;
    } else bad(400, 'Unknown action');

    const affected = answerTouched ? affectedBy(answerTouched) : 0;
    detail.playersAffected = affected;
    S.audit(actor, `review.${b.action}`, `group:${b.key}`, detail);
    if (answerTouched) S.audit('system', 'scores.recalculated', `answer:${answerTouched}`, { trigger: `review.${b.action}`, playersAffected: affected, note: 'Scores are derived from decisions; nothing is edited by hand.' });
    return { affected };
}

/* ------------------------------------------------------------------------------ verification bot */
const BOT_DEFAULTS = { enabled: true, autoApprove: true, autoMerge: true, autoReject: true, threshold: 70 };
const botCfg = () => ({ ...BOT_DEFAULTS, ...(db().meta.bot || {}) });
let botRunning = false;
const needsCheck = g => !g.bot || (((g.bot.recommendation === 'research' || g.bot.error) && Date.now() - g.bot.checkedAt > 24 * 3600e3 && (g.bot.tries || 1) < 3));

/** Check unknown answers against OpenStreetMap and (if enabled) act on high-confidence results. */
async function runBot(max = 8) {
  const cfg = botCfg();
  if (!cfg.enabled) return { skipped: 'The bot is switched off.' };
  if (botRunning) return { skipped: 'A bot run is already in progress.' };
  botRunning = true;
  const sum = { checked: 0, approved: 0, merged: 0, rejected: 0, recommendedOnly: 0, errors: 0, items: [] };
  try {
    S.touch('full');
    const ctx = { fetch: doFetch, sleep, userAgent: BOT_UA };
    const groups = reviewGroups().filter(g => g.status === 'pending' && needsCheck(g)).sort((a, b) => a.firstAt - b.firstAt).slice(0, max);
    for (const g of groups) {
      const subs = db().submissions.filter(x => groupKey(x) === g.key);
      const raws = uniq(subs.map(x => x.raw));
      let ev;
      try { ev = await Bot.verify(ctx, { q: g.q, raws, norm: g.norm, suggestion: g.suggestion, allowedAreas: E.allowedAreas(db().meta.includeExtended), threshold: cfg.threshold }); }
      catch (e) { ev = { checkedAt: Date.now(), recommendation: 'research', confidence: 0, error: String(e.message || e), reasons: ['Bot error: ' + e.message], candidates: [] }; }
      ev.tries = ((g.bot && g.bot.tries) || 0) + 1;
      sum.checked++;
      const evidence = { query: ev.query, reasons: ev.reasons, top: ev.candidates && ev.candidates[0] };
      const meta = { confidence: ev.confidence, evidence };
      const note = `Bot ${ev.recommendation} (${ev.confidence}%)`;
      let applied = null;
      try {
        if (ev.recommendation === 'approve' && cfg.autoApprove) { decideGroup({ key: g.key, action: 'approve', ...ev.apply, note, botMeta: meta }, 'bot'); applied = 'approved'; sum.approved++; }
        else if (ev.recommendation === 'merge' && cfg.autoMerge) { decideGroup({ key: g.key, action: 'merge', mergeInto: ev.mergeInto, aliases: '', note, botMeta: meta }, 'bot'); applied = 'merged'; sum.merged++; }
        else if (ev.recommendation === 'reject' && cfg.autoReject && ev.confidence >= Math.max(cfg.threshold, 85)) { decideGroup({ key: g.key, action: 'reject', reason: ev.rejectReason, note, botMeta: meta }, 'bot'); applied = 'rejected'; sum.rejected++; }
      } catch (e) {
        ev.reasons.push('Bot could not apply this: ' + e.message); ev.recommendation = 'research'; applied = null;
      }
      if (!applied) sum.recommendedOnly++;
      ev.applied = applied;
      subs[0].bot = ev;
      sum.items.push({ raw: raws[0], q: g.q, recommendation: ev.recommendation, confidence: ev.confidence, applied });
    }
    if (sum.checked) S.audit('bot', 'bot.run', 'review', { checked: sum.checked, approved: sum.approved, merged: sum.merged, rejected: sum.rejected, recommendedOnly: sum.recommendedOnly });
    S.save();
  } finally { botRunning = false; }
  return sum;
}

async function adminApi(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/admin/login' && m === 'POST') {
    const b = await readBody(req);
    if (!ADMIN_PASSWORD) bad(503, 'Admin is disabled: the ADMIN_PASSWORD secret is not set.');
    await new Promise(r => setTimeout(r, 400)); // slow brute force
    if (!safeEq(b.password || '', ADMIN_PASSWORD)) bad(401, 'Wrong password');
    S.audit('admin', 'login', 'admin', {});
    return send(res, 200, { token: issueToken() });
  }
  const actor = adminAuth(req);
  if (m !== 'GET') S.touch('full');   // admin writes can change answers/submissions: persist everything

  if (p === '/api/admin/overview' && m === 'GET') {
    autoFinalize();
    const t = todayInfo();
    const groups = reviewGroups();
    return send(res, 200, {
      today: t, includeExtended: db().meta.includeExtended, coverage: COVERAGE, launchDate: db().meta.launchDate,
      counts: { pending: groups.filter(g => g.status === 'pending').length, research: groups.filter(g => g.status === 'research').length, flaggedAnswers: db().answers.filter(a => a.flag && !a.flagCleared && a.status !== 'suspended').length, answers: db().answers.length, players: Object.keys(db().players).length, plays: db().plays.length, audit: db().audit.length },
      questions: QUESTIONS.map(q => ({ n: q.n, text: q.text })),
    });
  }

  if (p === '/api/admin/bot' && m === 'GET') {
    const pending = reviewGroups().filter(g => g.status === 'pending');
    return send(res, 200, {
      settings: botCfg(), unchecked: pending.filter(needsCheck).length, pending: pending.length,
      recent: db().audit.filter(e => e.actor === 'bot').slice(-80).reverse(),
      defaults: BOT_DEFAULTS,
    });
  }
  if (p === '/api/admin/bot/settings' && m === 'POST') {
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) bad(422, 'A reason is required.');
    const t = Number(b.threshold);
    if (!Number.isFinite(t) || t < 50 || t > 100) bad(422, 'Threshold must be between 50 and 100.');
    const before = botCfg();
    db().meta.bot = { enabled: !!b.enabled, autoApprove: !!b.autoApprove, autoMerge: !!b.autoMerge, autoReject: !!b.autoReject, threshold: Math.round(t) };
    S.audit(actor, 'bot.settings', 'meta', { from: before, to: db().meta.bot, reason });
    return send(res, 200, { ok: true, settings: botCfg() });
  }
  if (p === '/api/admin/bot/run' && m === 'POST') {
    const r = await runBot(15);
    return send(res, 200, { ok: true, ...r });
  }

  if (p === '/api/admin/review' && m === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    let g = reviewGroups();
    if (status !== 'all') g = g.filter(x => status === 'decided' ? ['approved', 'rejected', 'merged'].includes(x.status) : x.status === status);
    return send(res, 200, { groups: g });
  }

  if (p === '/api/admin/review/decide' && m === 'POST') {
    const b = await readBody(req);
    const r = decideGroup(b, actor);
    return send(res, 200, { ok: true, affected: r.affected });
  }

  if (p === '/api/admin/answers/import' && m === 'POST') {
    // Bulk-add verified answers. Same rules as ANSWER REVIEW approval: source URL, in-boundary area, no duplicates.
    const b = await readBody(req);
    const dry = !!b.dryRun;
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (!dry && reason.length < 3) bad(422, 'A reason is required (recorded in the audit log).');
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length || rows.length > 500) bad(422, 'Provide between 1 and 500 rows.');
    const okAreas = E.allowedAreas(db().meta.includeExtended);
    const seen = {};
    const results = [], added = [];
    rows.forEach((r, i) => {
      const res = { row: i + 1, canonical: String(r.canonical || '').trim(), status: 'error' };
      results.push(res);
      const q = Number(r.q);
      if (!QUESTIONS[q - 1]) return void (res.message = 'Question number must be 1–7.');
      if (res.canonical.length < 2 || res.canonical.length > 100) return void (res.message = 'Canonical name must be 2–100 characters.');
      const src = httpUrl(r.source); if (!src) return void (res.message = 'A source URL (http/https) is required.');
      const area = String(r.area || '').trim(); if (!okAreas.includes(area)) return void (res.message = `"${area || '(none)'}" is not inside the approved boundary.`);
      let lat = r.lat === '' || r.lat == null ? null : Number(r.lat), lng = r.lng === '' || r.lng == null ? null : Number(r.lng);
      if ((lat == null) !== (lng == null)) return void (res.message = 'Give both lat and lng, or neither.');
      if (lat != null && (!Number.isFinite(lat) || !Number.isFinite(lng) || !E.inBbox(lat, lng))) return void (res.message = 'Coordinates fall outside the Dublin 15 boundary box.');
      const idx = indexFor(q), sn = (seen[q] ||= new Set());
      const hit = idx.byName.get(norm(res.canonical));
      if (hit || sn.has(norm(res.canonical))) { res.status = 'duplicate'; res.message = hit ? `Already exists as "${idx.byId.get([...hit][0]).canonical}".` : 'Duplicate within this import.'; return; }
      const wanted = Array.isArray(r.aliases) ? r.aliases : String(r.aliases || '').split(/[;,]/);
      const skipped = [], aliases = [];
      for (const al of uniq(wanted)) {
        const k = norm(al);
        if (!k || k === norm(res.canonical) || idx.byName.has(k) || sn.has(k) || aliases.some(x => norm(x) === k)) skipped.push(al); else aliases.push(al);
      }
      sn.add(norm(res.canonical)); aliases.forEach(a => sn.add(norm(a)));
      const [clat, clng] = CENTROIDS[area] || CENTROIDS['Blanchardstown'];
      added.push({
        id: `a${q}-${uid(4)}`, q, canonical: res.canonical, aliases, abbreviations: [], category: QUESTIONS[q - 1].category, area, location: String(r.location || `${area}, Dublin 15`).slice(0, 200),
        lat: lat != null ? lat : clat, lng: lng != null ? lng : clng, coordPrecision: lat != null ? 'admin-supplied' : 'area-centroid',
        source: src, sources: [src], verifiedAt: dateKey(Date.now()), status: 'approved', verification: 'admin-imported', flag: null, prior: 0.01, note: null, addedBy: actor, edited: true,
      });
      res.status = 'added'; res.aliases = aliases.length; if (skipped.length) res.message = 'Aliases skipped (already used): ' + skipped.join(', ');
    });
    if (!dry && added.length) {
      db().answers.push(...added); bump();
      S.audit(actor, 'answers.import', 'bulk', { reason, added: added.length, duplicates: results.filter(x => x.status === 'duplicate').length, errors: results.filter(x => x.status === 'error').length, names: added.slice(0, 60).map(a => `Q${a.q} ${a.canonical}`) });
    }
    return send(res, 200, { ok: true, dryRun: dry, added: added.length, duplicates: results.filter(x => x.status === 'duplicate').length, errors: results.filter(x => x.status === 'error').length, results });
  }

  if (p === '/api/admin/answers' && m === 'GET') {
    const qn = Number(url.searchParams.get('q')) || 0;
    const flagged = url.searchParams.get('flagged') === '1';
    let list = db().answers;
    if (qn) list = list.filter(a => a.q === qn);
    if (flagged) list = list.filter(a => a.flag && !a.flagCleared && a.status !== 'suspended');
    return send(res, 200, { answers: list.map(a => ({ ...a, active: isActive(a), inBoundary: areaOk(a), affected: affectedBy(a.id) })) });
  }

  if (p === '/api/admin/answer' && m === 'POST') {
    const b = await readBody(req);
    const a = answerById(b.id); if (!a) bad(404, 'No such answer');
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (reason.length < 3) bad(422, 'Every change needs a recorded reason.');
    const changes = {};
    if (Array.isArray(b.addAliases) && b.addAliases.length) {
      const idx = indexFor(a.q);
      const add = uniq(b.addAliases).filter(x => { const e = idx.byName.get(norm(x)); return !(e && [...e].some(i => i !== a.id)) && norm(x) !== norm(a.canonical) && !a.aliases.some(y => norm(y) === norm(x)); });
      if (add.length) { a.aliases.push(...add); changes.addedAliases = add; }
    }
    if (Array.isArray(b.addAbbreviations) && b.addAbbreviations.length) { const add = uniq(b.addAbbreviations); a.abbreviations = uniq([...(a.abbreviations || []), ...add]); changes.addedAbbreviations = add; }
    if (b.addSource) { const src = httpUrl(b.addSource); if (!src) bad(422, 'Invalid source URL'); if (!a.sources.includes(src)) a.sources.push(src); a.source = a.source || src; changes.addedSource = src; }
    if (b.confirm) { if (!httpUrl(b.addSource || a.source)) bad(422, 'Confirming needs a source URL.'); a.flagCleared = true; a.verification = 'admin-verified'; a.verifiedAt = dateKey(Date.now()); changes.confirmed = true; }
    if (b.lat != null && b.lng != null && b.lat !== '') { const lat = Number(b.lat), lng = Number(b.lng); if (!E.inBbox(lat, lng)) bad(422, 'Coordinates fall outside the Dublin 15 boundary box.'); a.lat = lat; a.lng = lng; a.coordPrecision = 'admin-supplied'; changes.coords = [lat, lng]; }
    if (b.area) { if (!E.allowedAreas(true).includes(b.area)) bad(422, 'Area is outside the BLANION boundary.'); a.area = b.area; changes.area = b.area; }
    if (b.status && b.status !== a.status) {
      if (!['suspended', 'curated', 'approved'].includes(b.status)) bad(400, 'Bad status');
      changes.status = { from: a.status, to: b.status }; a.status = b.status;
    }
    if (Object.keys(changes).length) a.edited = true;   // protects admin changes from later seed syncs
    bump();
    const affected = changes.status || changes.area ? affectedBy(a.id) : 0;
    S.audit(actor, 'answer.update', `answer:${a.id}`, { canonical: a.canonical, reason, changes, playersAffected: affected });
    if (affected) S.audit('system', 'scores.recalculated', `answer:${a.id}`, { trigger: 'answer.update', playersAffected: affected });
    return send(res, 200, { ok: true, answer: a });
  }

  if (p === '/api/admin/coverage' && m === 'POST') {
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) bad(422, 'A reason is required.');
    const before = db().meta.includeExtended;
    db().meta.includeExtended = !!b.includeExtended; bump();
    S.audit(actor, 'coverage.update', 'meta', { includeExtended: { from: before, to: !!b.includeExtended }, reason });
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/day/close' && m === 'POST') {
    const b = await readBody(req);
    const reason = String(b.reason || '').trim();
    if (reason.length < 3) bad(422, 'A reason is required.');
    const n = Number(b.day);
    if (!DAYS[n]) bad(404, 'No such day');
    const ok = finalizeDay(n, actor, `manual close: ${reason}`);
    return send(res, 200, { ok, final: isFinal(n) });
  }

  if (p === '/api/admin/stats' && m === 'GET') {
    const n = Number(url.searchParams.get('day')) || todayInfo().day;
    const st = dayStats(n);
    const out = QUESTIONS.map(q => {
      const rows = Object.entries(st.counts[q.n] || {}).map(([id, c]) => { const a = answerById(id); const t = tierOf(n, q.n, id, st); return { canonical: a.canonical, count: c, tier: t.name, share: st.total[q.n] ? Math.round(c / st.total[q.n] * 1000) / 10 : 0 }; }).sort((a, b) => b.count - a.count);
      const pend = db().submissions.filter(s => s.day === n && s.q === q.n && (s.status === 'pending' || s.status === 'research')).length;
      return { n: q.n, text: q.text, total: st.total[q.n] || 0, pending: pend, rows };
    });
    return send(res, 200, { day: n, final: isFinal(n), divers: st.plays.length, finished: st.plays.filter(x => x.done).length, questions: out });
  }

  if (p === '/api/admin/audit' && m === 'GET') {
    return send(res, 200, { verify: S.verifyAudit(), entries: db().audit.slice(-300).reverse() });
  }

  bad(404, 'No such admin endpoint');
}

/* ----------------------------------------------------------------- entry */
async function handle(req, url) {
  try {
    if (limited(req.ip || '?')) bad(429, 'Slow down, diver.');
    if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, null, url);
    if (url.pathname.startsWith('/api/')) return await publicApi(req, null, url);
    bad(404, 'No such endpoint');
  } catch (e) {
    if (e instanceof HttpError) return { code: e.code, body: { error: e.message, ...(e.extra || {}) } };
    console.error(e);
    return { code: 500, body: { error: 'Something went wrong in the deep.' } };
  }
}
return { handle, autoFinalize, runBot };
}

module.exports = { createApp, SEC };
