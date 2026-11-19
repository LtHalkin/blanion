'use strict';
/**
 * Polite OpenStreetMap harvest (Nominatim, 1 request/second, generic User-Agent) over a grid of small cells inside the BLANION box,
 * so each query returns <=40 results and nothing is truncated. Appends new elements to scripts/osm-raw/nominatim-extra.json.
 * Usage: NODE_USE_ENV_PROXY=1 node scripts/harvest.js [cols] [rows]    (resumable: scripts/osm-raw/.harvest-done.json)
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
const fs = require('fs'), path = require('path');
process.env.BLANION_BUILD = '1';
const D = require('../lib/day001');
const dir = path.join(__dirname, 'osm-raw'), outF = path.join(dir, 'nominatim-extra.json'), doneF = path.join(dir, '.harvest-done.json');
const out = JSON.parse(fs.readFileSync(outF, 'utf8'));
const done = fs.existsSync(doneF) ? new Set(JSON.parse(fs.readFileSync(doneF, 'utf8'))) : new Set();
const have = new Set(out.map(e => e.osm_type + e.osm_id));
const KEYS = process.env.ROADS ? { roads: ['road', 'avenue', 'drive', 'close', 'grove', 'park', 'lawn', 'court', 'green', 'heights', 'walk', 'view', 'way', 'rise', 'street', 'lane', 'crescent', 'square', 'terrace', 'place', 'hill', 'gardens', 'wood', 'downs', 'dale', 'meadows'] } : {
  pubs: ['pub', 'bar'], worship: ['church', 'place of worship', 'chapel'], hotels: ['hotel', 'guest house', 'hostel'],
  shops: ['supermarket', 'convenience', 'clothes', 'shoe', 'electronics', 'hardware', 'furniture', 'florist', 'off licence', 'butcher', 'bookshop', 'jewellery', 'sports shop', 'toy shop', 'garden centre', 'newsagent', 'post office', 'department store', 'variety store', 'charity shop', 'car dealer', 'pet shop', 'optician'],
  food: ['restaurant', 'cafe', 'fast food', 'takeaway', 'bakery', 'ice cream', 'coffee'],
  fitness: ['gym', 'fitness centre', 'swimming pool', 'sports centre', 'leisure centre'],
  health: ['pharmacy', 'clinic', 'doctors', 'hospital', 'medical centre', 'dentist', 'health centre'],
};
const [cols, rows] = [Number(process.argv[2]) || 6, Number(process.argv[3]) || 5];
const b = D.COVERAGE.bbox, dLat = (b.maxLat - b.minLat) / rows, dLng = (b.maxLng - b.minLng) / cols;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let n = 0, added = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const vb = [b.minLng + c * dLng, b.maxLat - r * dLat, b.minLng + (c + 1) * dLng, b.maxLat - (r + 1) * dLat].map(x => x.toFixed(5)).join(',');
    for (const [cat, words] of Object.entries(KEYS)) for (const w of words) {
      const key = `${r},${c},${w}`; if (done.has(key)) continue;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=40&bounded=1&viewbox=${vb}&q=${encodeURIComponent(w)}`;
      let js; try { const res = await fetch(url, { headers: { 'User-Agent': 'blanion-local-trivia-bank/1.0' }, signal: AbortSignal.timeout(20000) }); if (res.status === 429) { await sleep(30000); continue; } js = await res.json(); } catch (e) { await sleep(5000); continue; }
      for (const e of js) { const k = e.osm_type + e.osm_id; if (!e.name || have.has(k)) continue; have.add(k); added++; out.push({ cat, osm_type: e.osm_type, osm_id: e.osm_id, name: e.name, lat: +e.lat, lon: +e.lon, category: e.category || e.class, type: e.type, address: e.address || {} }); }
      done.add(key); n++;
      if (n % 20 === 0) { fs.writeFileSync(outF, JSON.stringify(out)); fs.writeFileSync(doneF, JSON.stringify([...done])); console.log(n, 'queries,', added, 'new,', out.length, 'total'); }
      await sleep(1100);
    }
  }
  fs.writeFileSync(outF, JSON.stringify(out)); fs.writeFileSync(doneF, JSON.stringify([...done])); console.log('done', n, added, out.length);
})();
