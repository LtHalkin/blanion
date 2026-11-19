'use strict';
/**
 * Answer-verification bot ("the Harbour Bot").
 *
 * It does NOT guess. For an answer nobody has seen before it:
 *   1. checks for a near-duplicate of an existing answer (merge candidate),
 *   2. looks the text up on OpenStreetMap (Nominatim) inside the Dublin 15 box,
 *   3. scores the best hit from checkable evidence only:
 *        confidence = name similarity x place-type fit for the question x uniqueness
 *      and refuses outright (confidence 0) unless the place is inside the boundary and in an approved area,
 *   4. returns a recommendation + the evidence. Applying it (auto-approve etc.) is the caller's decision.
 * No language model is involved, so player text can never "instruct" it.
 * Data © OpenStreetMap contributors (ODbL).
 */
const { norm, levenshtein } = require('./util');
const { COVERAGE, CENTROIDS } = require('./day001');

/* ----------------------------------------------------------- place-type fit per question */
const CLUBISH = /\b(club|gaa|fc|rfc|afc|gaels|gael|celtic|united|rovers|athletic|athletics|harriers|tennis|golf|rugby|hockey|cricket|boxing|karate|judo|martial|swimming|camogie|hurling|football|soccer|basketball|badminton|squash|sc|ac)\b/i;
/** 0..1 — how well an OSM feature matches the kind of thing question q asks for. */
function typeFit(q, e) {
  const c = e.category, t = e.type, kind = c + '/' + t, x = e.extratags || {};
  const name = e.name || '';
  switch (q) {
    case 1: return c === 'waterway' && /^(river|stream|canal|brook)$/.test(t) ? 1 : 0;
    case 2: return c === 'railway' && /^(station|halt)$/.test(t) ? 1 : 0;
    case 3:
      if (/^leisure\/(park|garden|nature_reserve|common)$/.test(kind) || /^landuse\/(recreation_ground|village_green)$/.test(kind)) return 1;
      return kind === 'natural/wood' ? 0.75 : 0;   // woods may not be public
    case 4: return kind === 'amenity/school' ? 1 : kind === 'building/school' ? 0.9 : kind === 'amenity/college' ? 0.65 : 0;   // colleges/training centres need a human
    case 5:
      if (c === 'historic') return 1;
      if (x.heritage) return 0.95;
      if (kind === 'amenity/grave_yard') return 0.85;
      return kind === 'tourism/attraction' ? 0.8 : 0;
    case 6:
      if (kind === 'boundary/administrative') return /dist|county|ward|\bed\b|ded/i.test(name) ? 0 : 0.95;
      return c === 'place' && /^(suburb|neighbourhood|village|hamlet|town|locality|quarter)$/.test(t) ? 1 : 0;
    case 7:
      if (kind === 'club/sport') return 1;
      if (/^leisure\/(sports_centre|pitch|golf_course|stadium|sports_hall)$/.test(kind) && CLUBISH.test(name)) return 0.85;
      return 0;
    case 8: return /^amenity\/(pub|bar)$/.test(kind) ? 1 : 0;
    case 9: return kind === 'amenity/place_of_worship' ? 1 : 0;
    case 10: return /^tourism\/(hotel|guest_house|motel|hostel)$/.test(kind) ? 1 : 0;
    case 11: return /^shop\//.test(kind) ? 0.9 : kind === 'amenity/post_office' ? 0.8 : 0;
    case 12: return /^amenity\/(cafe|restaurant|fast_food|ice_cream)$/.test(kind) ? 1 : kind === 'shop/bakery' ? 0.8 : 0;
    case 13: return /^leisure\/(fitness_centre|sports_centre|swimming_pool)$/.test(kind) ? 1 : 0;
    case 14: return /^amenity\/(hospital|clinic|pharmacy|doctors)$/.test(kind) ? 1 : 0;
    case 15: return /^(landuse\/(industrial|commercial|retail)|building\/retail)$/.test(kind) && /park|estate|centre|campus|retail/i.test(name) ? 0.8 : 0;
    case 16: return c === 'highway' && !/^(bus_stop|footway|path|cycleway|service|track|steps)$/.test(t) ? 0.9 : 0;
    default: return 0;
  }
}

/* ------------------------------------------------------------------------ name similarity */
const NOISE = new Set(['dublin', '15', 'd15', 'ireland', 'co', 'county', 'the', 'of']);
const toks = s => norm(s).split(' ').filter(t => t && !NOISE.has(t));
function nameSim(userText, candName) {
  const un = norm(userText), cn = norm(candName);
  if (!un || !cn) return 0;
  if (un === cn) return 1;
  const u = toks(userText), c = toks(candName);
  if (!u.length || !c.length) return 0;
  const us = new Set(u), cs = new Set(c);
  if ([...us].every(t => cs.has(t))) return Math.min(0.95, 0.75 + 0.2 * (us.size / cs.size));   // user typed part of the name
  if ([...cs].every(t => us.has(t))) return Math.min(0.9, 0.9 * (cs.size / us.size) + 0.05);    // user added extra words
  const a = u.join(' '), b = c.join(' ');
  const r = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return r >= 0.85 ? r * 0.95 : 0;                                                                // typo-level difference
}

/* ------------------------------------------------------------------------------ geography */
const rad = d => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** Auto-actions only inside a core zone: the boundary box shrunk by a margin (~1 km), because the box is generous and the
 *  true Dublin 15 edge (Liffey to the south, Lucan/Leixlip to the west) is irregular. Edge cases go to a human. */
const EDGE = { south: 0.007, west: 0.02, east: 0.01, north: 0.005 };
const inAutoZone = (lat, lng) => { const b = COVERAGE.bbox; return lat >= b.minLat + EDGE.south && lat <= b.maxLat - EDGE.north && lng >= b.minLng + EDGE.west && lng <= b.maxLng - EDGE.east; };
const inBox = (lat, lng) => { const b = COVERAGE.bbox; return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng; };

/** Map an OSM result onto one of the BLANION boundary areas, or null if it cannot be placed. */
const OUT = /^(lucan|adamstown|palmerstown|chapelizod|ashtown|phoenix park|navan road|leixlip|dunboyne|clonee|clondalkin|ballyfermot|finglas|ballymun|swords)/i;
const labelsOf = e => { const a = e.address || {}; return [a.suburb, a.neighbourhood, a.village, a.hamlet, a.town, a.quarter, a.city_district].filter(Boolean).map(l => l.replace(/\s+(B\s+)?(ED|DED)\b.*$/i, '').trim()); };
/** True when OpenStreetMap itself labels the place as one of the neighbouring areas that are NOT Dublin 15. */
const labelledOutside = e => labelsOf(e).some(l => OUT.test(l));
function areaFor(e, allowed) {
  const a = e.address || {};
  const labels = [a.suburb, a.neighbourhood, a.village, a.hamlet, a.town, a.quarter, a.city_district].filter(Boolean);
  for (const raw of labels) {
    const l = raw.replace(/\s+(B\s+)?(ED|DED)\b.*$/i, '').trim();
    if (OUT.test(l)) return null;
    const hit = allowed.find(x => x.toLowerCase() === l.toLowerCase());
    if (hit) return hit;
    if (/^castleknock/i.test(l)) return allowed.includes('Castleknock') ? 'Castleknock' : null;
    if (/^blanchardstown-abbotstown/i.test(raw)) return allowed.includes('Abbotstown') ? 'Abbotstown' : null;
    if (/^(the ward|hollywoodrath)/i.test(l)) return allowed.includes('Tyrrelstown') ? 'Tyrrelstown' : null;
  }
  let best = null;
  for (const n of allowed) { const c = CENTROIDS[n]; if (!c) continue; const d = km([+e.lat, +e.lon], c); if (d <= 2.2 && (!best || d < best.d)) best = { n, d }; }
  return best ? best.n : null;
}

/* ------------------------------------------------------------------------------- Nominatim */
async function nominatim(ctx, text, bounded) {
  const b = COVERAGE.bbox;
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: text, format: 'jsonv2', limit: bounded ? '8' : '4', addressdetails: '1', extratags: '1', countrycodes: 'ie',
    ...(bounded ? { viewbox: `${b.minLng},${b.maxLat},${b.maxLng},${b.minLat}`, bounded: '1' } : {}),
  });
  await ctx.sleep(1100);                                              // Nominatim usage policy: max 1 request / second
  const r = await ctx.fetch(url, { headers: { 'User-Agent': ctx.userAgent, 'Accept-Language': 'en' } });
  if (!r.ok) throw new Error('Nominatim HTTP ' + r.status);
  return r.json();
}

const tidyName = n => String(n).replace(/\bSaint\b/g, 'St').replace(/\s+/g, ' ').trim();
const osmUrl = e => `https://www.openstreetmap.org/${e.osm_type}/${e.osm_id}`;

/**
 * verify(ctx, { q, raws[], norm, suggestion, allowedAreas, threshold })
 * ctx = { fetch, sleep, userAgent }
 * returns { recommendation: 'approve'|'merge'|'reject'|'research', confidence 0-100, reasons[], candidates[], apply? , mergeInto? }
 */
async function verify(ctx, job) {
  const { q, raws, suggestion, allowedAreas } = job;
  const text = raws[0];
  const out = { checkedAt: Date.now(), source: 'OpenStreetMap Nominatim', query: text, reasons: [], candidates: [], recommendation: 'research', confidence: 0 };

  // 1. near-duplicate of an existing answer
  if (suggestion && suggestion.confidence >= 90) {
    out.recommendation = 'merge'; out.confidence = suggestion.confidence; out.mergeInto = suggestion.answerId;
    out.reasons.push(`Very similar to existing answer "${suggestion.canonical}" (${suggestion.confidence}% similar).`);
    return out;
  }

  // 2. OpenStreetMap inside the boundary box
  let hits;
  try { hits = await nominatim(ctx, text, true); } catch (e) { out.error = e.message; out.reasons.push('OpenStreetMap lookup failed: ' + e.message); return out; }
  const scored = hits.filter(e => e.name).map(e => {
    const sim = nameSim(text, e.name), fit = typeFit(q, e);
    const area = inBox(+e.lat, +e.lon) ? areaFor(e, allowedAreas) : null;
    return { e, sim, fit, area, score: sim * fit };
  }).sort((a, b) => b.score - a.score);
  out.candidates = scored.slice(0, 3).map(s => ({ name: s.e.name, osm: `${s.e.osm_type}/${s.e.osm_id}`, url: osmUrl(s.e), lat: +(+s.e.lat).toFixed(5), lng: +(+s.e.lon).toFixed(5), kind: s.e.category + '/' + s.e.type, area: s.area, nameSimilarity: +s.sim.toFixed(2), typeFit: s.fit }));

  const best = scored[0];
  if (best && best.score > 0) {
    // uniqueness: a second, different place that matches almost as well makes this ambiguous
    const rival = scored.find(s => s !== best && s.score >= best.score - 0.1 && km([+s.e.lat, +s.e.lon], [+best.e.lat, +best.e.lon]) > 0.3 && norm(s.e.name) !== norm(best.e.name));
    const uniq = rival ? 0.8 : 1;
    let conf = Math.round(100 * best.score * uniq);
    const why = [`Best OpenStreetMap match: "${best.e.name}" (${best.e.category}/${best.e.type}), name similarity ${Math.round(best.sim * 100)}%, place-type fit ${Math.round(best.fit * 100)}%.`];
    if (rival) why.push(`Another place ("${rival.e.name}") matches almost as well, so confidence is reduced.`);
    if (!best.area) { conf = 0; why.push('Could not place it inside an approved BLANION area — never auto-approved.'); }
    out.confidence = conf; out.reasons.push(...why);
    if (best.area) {
      out.apply = { canonical: tidyName(best.e.name), area: best.area, lat: +(+best.e.lat).toFixed(5), lng: +(+best.e.lon).toFixed(5), source: osmUrl(best.e), location: `${best.area}, Dublin 15`, aliases: raws.filter(r => norm(r) !== norm(tidyName(best.e.name))), osm: `${best.e.osm_type}/${best.e.osm_id}` };
      out.recommendation = conf >= (job.threshold || 70) ? 'approve' : 'research';
      if (out.recommendation === 'research') out.reasons.push(`Confidence ${conf}% is below the ${job.threshold || 70}% threshold — needs a human.`);
      if (out.recommendation === 'approve' && !inAutoZone(out.apply.lat, out.apply.lng)) {
        out.recommendation = 'research';
        out.reasons.push('It sits close to the edge of the BLANION boundary box, where the true Dublin 15 border is uncertain — a human must confirm it.');
      }
      return out;
    }
  } else out.reasons.push('No matching place of the right type found inside the BLANION boundary.');

  // 3. does the same place exist, but outside the boundary?
  let wide = [];
  try { wide = await nominatim(ctx, text, false); } catch { /* optional check */ }
  const far = wide.filter(e => e.name).map(e => ({ e, sim: nameSim(text, e.name), fit: typeFit(q, e) })).filter(s => s.sim >= 0.9 && s.fit > 0).sort((a, b) => b.sim - a.sim)[0];
  // auto-reject only on clear evidence: outside the box, or OpenStreetMap labels it as a neighbouring (non-D15) area
  if (far && (!inBox(+far.e.lat, +far.e.lon) || labelledOutside(far.e))) {
    const a = far.e.address || {};
    out.recommendation = 'reject'; out.confidence = Math.round(far.sim * 100);
    out.reasons.push(`OpenStreetMap places "${far.e.name}" at ${(+far.e.lat).toFixed(4)}, ${(+far.e.lon).toFixed(4)} (${a.suburb || a.town || a.city || a.county || 'Ireland'}), outside the BLANION boundary.`);
    out.rejectReason = `That place is outside the BLANION boundary (${a.suburb || a.town || a.city || 'elsewhere in Ireland'}).`;
  } else out.reasons.push('Nothing conclusive on OpenStreetMap — left for a human.');
  return out;
}

module.exports = { verify, typeFit, nameSim, areaFor, labelledOutside, km, tidyName };
