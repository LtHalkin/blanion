'use strict';
/**
 * Abbreviation generator for answer names. Pure functions, no I/O.
 *
 *   abbreviationsFor("Coolmine Community School", 4)  ->  ["Coolmine CS", "CCS", "Coolmine Community Sch", ...]
 *
 * It produces the shorthand people actually type: standard suffix abbreviations (NS, CS, CC, ETNS, FC, RFC, LTC...), "Saint"/"St",
 * road words (Rd, Ave...), initialisms ("St Francis Xavier Senior School" -> SFX, SFXSS), "X Y" -> "X + abbreviated suffix",
 * and "&" / "and" variants. Callers must still de-duplicate across answers (see `resolveCollisions`).
 */
const { norm } = require('./util');

// whole-phrase suffix abbreviations, longest first. [phrase, abbreviation]
const SUFFIXES = [
  ['educate together national school', 'ETNS'], ['educate together secondary school', 'ETSS'], ['educate together', 'ET'],
  ['community national school', 'CNS'], ['national schools', 'NS'], ['national school', 'NS'], ['senior national school', 'Senior NS'], ['junior national school', 'Junior NS'],
  ['senior school', 'Senior'], ['junior school', 'Junior'], ['community school', 'CS'], ['community college', 'CC'], ['secondary school', 'SS'], ['primary school', 'PS'], ['girls national school', 'GNS'], ['boys national school', 'BNS'],
  ['rugby football club', 'RFC'], ['rugby club', 'RFC'], ['football club', 'FC'], ['lawn tennis club', 'LTC'], ['tennis club', 'TC'], ['golf club', 'GC'], ['golf and country club', 'G&CC'],
  ['athletic club', 'AC'], ['sports club', 'SC'], ['cricket club', 'CC'], ['hockey club', 'HC'], ['gaelic athletic association', 'GAA'], ['gaa club', 'GAA'], ['hurling and football club', 'HFC'],
  ['sports and leisure club', 'SLC'], ['sports and leisure', 'S&L'],
  ['shopping centre', 'SC'], ['retail park', 'RP'], ['business park', 'BP'], ['industrial estate', 'Ind Est'], ['industrial park', 'IP'], ['corporate park', 'CP'], ['technology park', 'TP'],
  ['train station', 'Stn'], ['railway station', 'Stn'], ['station', 'Stn'], ['hospital', 'Hosp'], ['health centre', 'HC'], ['medical centre', 'MC'], ['leisure centre', 'LC'], ['community centre', 'CC'],
  ['pharmacy', 'Pharm'], ['regional park', 'Regional Pk'], ['graveyard', 'Gyd'], ['cemetery', 'Cem'],
];
// whole-word replacements (applied to produce one extra variant with ALL of them applied)
const WORDS = [['saint', 'St'], ['road', 'Rd'], ['avenue', 'Ave'], ['street', 'St'], ['drive', 'Dr'], ['court', 'Ct'], ['park', 'Pk'], ['centre', 'Ctr'], ['mount', 'Mt'], ['lane', 'Ln'], ['square', 'Sq'], ['terrace', 'Ter'], ['crescent', 'Cres'], ['grove', 'Gr'], ['place', 'Pl'], ['hotel', 'Htl']];
const SMALL = new Set(['of', 'the', 'and', 'an', 'a', 'in', 'at', 'for', 'to', 'de', 'na', 'an']);
const GENERIC_TAIL = new Set(['school', 'schools', 'college', 'club', 'park', 'station', 'centre', 'hotel', 'church', 'hospital', 'pharmacy', 'estate', 'road', 'street', 'avenue', 'pub', 'bar', 'inn', 'national', 'community', 'secondary', 'primary', 'senior', 'junior', 'educate', 'together', 'football', 'rugby', 'gaa', 'lawn', 'tennis', 'golf', 'sports', 'business', 'retail', 'industrial', 'shopping', 'leisure', 'gym', 'fitness', 'health', 'medical', 'railway', 'train', 'graveyard', 'cemetery', 'castle', 'ringfort', 'house', 'garden', 'gardens']);

const words = s => String(s).replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
const cap = w => (/^[A-Z0-9&]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));

/** strip a trailing suffix phrase; returns [rest, abbreviation] or null */
function splitSuffix(name) {
  const n = norm(name);
  for (const [phrase, abbr] of SUFFIXES) {
    if (n.endsWith(' ' + phrase) || n === phrase) {
      const rest = n === phrase ? '' : n.slice(0, n.length - phrase.length).trim();
      return { rest, abbr, phrase };
    }
  }
  return null;
}

/** original-cased head words of `name` after removing `n` trailing words */
function head(name, dropWords) { const w = words(name); return w.slice(0, Math.max(0, w.length - dropWords)).join(' '); }

function initialism(ws) {
  const ini = ws.filter(w => !SMALL.has(w.toLowerCase())).map(w => (w === '&' ? '' : w.charAt(0).toUpperCase())).join('');
  return ini;
}

/**
 * All sensible abbreviations/short forms of `name`. Excludes the name itself. `maxPer` limits noise.
 */
function abbreviationsFor(name, opts = {}) {
  const out = new Set(); const nName = norm(name);
  const add = v => { v = String(v || '').replace(/\s+/g, ' ').trim(); if (v && norm(v) && norm(v) !== nName && /[a-z0-9]/i.test(v)) out.add(v); };
  const w = words(name);
  const clean = w.filter(x => x !== '&');

  // 1. suffix abbreviation: "Coolmine Community School" -> "Coolmine CS", plus the bare head "Coolmine"
  const sf = splitSuffix(name);
  if (sf && sf.rest) {
    const dropN = words(sf.phrase).length, h = head(name, dropN);
    add(h + ' ' + sf.abbr);
    const hw0 = words(h), lastSmall = SMALL.has((hw0[hw0.length - 1] || '').toLowerCase());
    if (lastSmall) return finish(out);
    if (h.length >= 5) add(h);
    // initialism of the head plus the suffix abbreviation: "Castleknock Community College" -> CCC ; "Coolmine CS" -> CCS
    const hi = initialism(words(h));
    if (hi.length >= 2) { add(hi + sf.abbr.replace(/[^A-Z]/g, '')); if (hi.length >= 3) add(hi); }
  }
  // 2. word-level shorthand applied everywhere ("Saint" -> "St", "Road" -> "Rd" ...)
  let any = false; const short = w.map(x => { const hit = WORDS.find(([a]) => a === x.toLowerCase()); if (hit) { any = true; return hit[1]; } return x; });
  if (any) add(short.join(' '));
  // 3. combined: shorthand words AND suffix abbreviation
  if (sf && sf.rest) { const h = head(name, words(sf.phrase).length); const hs = words(h).map(x => { const hit = WORDS.find(([a]) => a === x.toLowerCase()); return hit ? hit[1] : x; }).join(' '); add(hs + ' ' + sf.abbr); add(hs); }
  // 4. initialism of the whole multi-word name ("Blanchardstown Retail Park" -> BRP)
  if (clean.length >= 2 && clean.length <= 5) { const ini = initialism(clean); if (ini.length >= 3) add(ini); }
  // 5. "&" <-> "and"
  if (/\band\b/i.test(name)) add(name.replace(/\band\b/gi, '&'));
  if (name.includes('&')) add(name.replace(/&/g, 'and'));
  // 6. drop a leading "The "
  if (/^the\s+/i.test(name)) add(name.replace(/^the\s+/i, ''));
  // 7. "Saint X" without the first words that are generic: "St Francis Xavier Senior School" -> "SFX" (initialism of the proper-name head)
  if (sf && sf.rest) { const hw = words(head(name, words(sf.phrase).length)).filter(x => !GENERIC_TAIL.has(x.toLowerCase())); const hi = initialism(hw); if (hw.length >= 2 && hi.length >= 2 && hi.length <= 5) { if (hi.length >= 3) add(hi); add(hi + ' ' + sf.abbr); } }
  return finish(out, opts);
}
function finish(out, opts) { return [...out].slice(0, (opts && opts.maxPer) || 14); }

/**
 * Given `items = [{ key, q, canonical, aliases:[], abbreviations:[] }]`, remove from every abbreviation list anything that:
 *  - equals another answer's canonical name or alias in the same question,
 *  - is produced by more than one answer (ambiguous), or
 *  - is too short/meaningless (< 2 letters, or a bare number).
 * Mutates and returns items.
 */
function resolveCollisions(items) {
  const byQ = {};
  for (const it of items) { const m = (byQ[it.q] ||= new Map()); for (const n of [it.canonical, ...(it.aliases || [])]) { const k = norm(n); if (!k) continue; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(it.key); } }
  const produced = {};
  for (const it of items) { const m = (produced[it.q] ||= new Map()); for (const a of it.abbreviations || []) { const k = norm(a); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(it.key); } }
  for (const it of items) {
    it.abbreviations = (it.abbreviations || []).filter((a, i, arr) => {
      const k = norm(a); if (k.length < 2 || /^\d+$/.test(k)) return false;
      if (arr.findIndex(x => norm(x) === k) !== i) return false;
      const owners = byQ[it.q].get(k); if (owners && [...owners].some(o => o !== it.key)) return false;       // clashes with someone else's real name
      if (owners && owners.has(it.key)) return false;                                                         // already an alias of this very answer
      if (produced[it.q].get(k).size > 1) return false;                                                       // ambiguous between abbreviations
      return true;
    });
  }
  return items;
}

module.exports = { abbreviationsFor, resolveCollisions, SUFFIXES };
