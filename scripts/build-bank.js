'use strict';
/**
 * Builds lib/bank.json: the expanded answer bank.
 *
 *   node scripts/build-bank.js
 *
 * Inputs : scripts/osm-raw/nominatim.json  (named features harvested from OpenStreetMap's Nominatim, bounded to the
 *          Dublin 15 box; see README "Answer bank")
 *          lib/day001.js                   (the hand-curated Day 001 seed answers, enriched here)
 * Output : lib/bank.json                   (new answers + enrichment of seed answers + extra boundary areas)
 *
 * Every entry below is looked up BY NAME in the harvested data and the build fails if it cannot be found, so every
 * answer carries a real OpenStreetMap coordinate and source link. Judgement calls (what counts as a park, which side of
 * the boundary a borderline place is on) are made explicitly in the lists below, not by a model.
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */
const fs = require('fs');
const path = require('path');
const { norm } = require('../lib/util');
process.env.BLANION_BUILD = '1';
const D = require('../lib/day001');
const { abbreviationsFor, resolveCollisions } = require('../lib/abbrev');
const ExtraBank = require('./bank-extra');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'osm-raw', 'nominatim.json'), 'utf8'));
const GENERATED = '2026-11-19';
const QCAT = Object.fromEntries(D.ALL_QUESTIONS.map(q => [q.n, q.category]));
const osmUrl = e => `https://www.openstreetmap.org/${e.osm_type}/${e.osm_id}`;

/** find an element by exact (case-insensitive) name; `pref` = list of "category/type" prefixes in order of preference */
function find(name, pref = []) {
  const hits = raw.filter(e => e.name && e.name.toLowerCase() === name.toLowerCase());
  if (!hits.length) throw new Error(`OSM element not found: "${name}"`);
  for (const p of pref) { const h = hits.find(e => (e.category + '/' + e.type).startsWith(p)); if (h) return h; }
  return hits[0];
}

/* ------------------------------------------------------------------------------------------------ NEW ANSWERS */
// [q, OSM name, canonical, area, aliases[], {pref, flag, note}]
const NEW = [
  // Q1 waterways
  [1, 'Pinkeen River', 'Pinkeen River', 'Mulhuddart', ['The Pinkeen', 'Pinkeen', 'Pinkeen Stream'], { pref: ['waterway/river'] }],
  [1, 'Warrenstown Stream', 'Warrenstown Stream', 'Blanchardstown', ['Warrenstown'], { pref: ['waterway/stream'] }],

  // Q2 stations
  [2, 'Navan Road Parkway', 'Navan Road Parkway Station', 'Castleknock', ['Navan Road Parkway', 'Navan Road', 'Navan Rd Parkway', 'Navan Road Station'], { pref: ['railway/station'], flag: 'Borderline: OpenStreetMap places this station in the Castleknock-Park area on the Navan Road, near the Ashtown edge. Confirm that it counts as serving the coverage area.' }],

  // Q3 parks / green space
  [3, 'Beech Park', 'Beech Park', 'Clonsilla', [], { pref: ['leisure/park'] }],
  [3, 'Castle Curragh Park', 'Castle Curragh Park', 'Mulhuddart', ['Castlecurragh Park', 'Castle Curragh'], { pref: ['leisure/park'] }],
  [3, 'Cherryfield Park', 'Cherryfield Park', 'Ongar', [], { pref: ['leisure/park'] }],
  [3, 'Farmleigh', 'Farmleigh', 'Castleknock', ['Farmleigh House', 'Farmleigh Estate', 'Farmleigh Gardens', 'Farmleigh House and Estate'], { pref: ['leisure/park'] }],
  [3, 'Littlepace Park', 'Littlepace Park', 'Mulhuddart', ['Littlepace'], { pref: ['leisure/park'] }],
  [3, 'Porterstown Park', 'Porterstown Park', 'Porterstown', ['Porterstown'], { pref: ['leisure/park'] }],
  [3, 'The Shackleton Garden', 'Shackleton Gardens', 'Clonsilla', ['The Shackleton Garden', 'Shackleton Garden', 'Shackleton Park'], { pref: ['leisure/park', 'leisure/garden'] }],
  [3, 'Avondale Garden', 'Avondale Garden', 'Mulhuddart', ['Avondale Gardens', 'Avondale Park'], { pref: ['leisure/garden'] }],

  // Q4 schools
  [4, 'Castaheany Educate Together National School', 'Castaheany Educate Together National School', 'Ongar', ['Castaheany', 'Castaheany Educate Together', 'Castaheany ETNS'], { pref: ['amenity/school'] }],
  [4, 'Castleknock Educate Together National School', 'Castleknock Educate Together National School', 'Castleknock', ['Castleknock Educate Together', 'Castleknock ETNS'], { pref: ['amenity/school'] }],
  [4, 'Castleknock National School', 'Castleknock National School', 'Castleknock', ['Castleknock NS'], { pref: ['amenity/school'] }],
  [4, 'Edmund Rice College', 'Edmund Rice College', 'Blanchardstown', ['Edmund Rice', 'Edmund Rice College Blanchardstown'], { pref: ['amenity/school'] }],
  [4, 'Hansfield Educate Together National School', 'Hansfield Educate Together National School', 'Hansfield', ['Hansfield Educate Together Primary', 'Hansfield ETNS', 'Hansfield Educate Together NS'], { pref: ['amenity/school'] }],
  [4, 'Hansfield Educate Together Secondary School', 'Hansfield Educate Together Secondary School', 'Hansfield', ['Hansfield ETSS', 'Hansfield Educate Together Secondary'], { pref: ['amenity/school'] }],
  [4, "Lady's Well National School", "Lady's Well National School", 'Mulhuddart', ['Ladys Well NS', 'Lady Well National School', 'Ladys Well School'], { pref: ['amenity/school'] }],
  [4, 'Luttrellstown Community College', 'Luttrellstown Community College', 'Blanchardstown', ['Luttrellstown CC', 'Luttrellstown College', 'Luttrelstown Community College', 'Luttrellstown'], { pref: ['amenity/school'] }],
  [4, 'Rath Dara Community College', 'Rath Dara Community College', 'Blanchardstown', ['Rath Dara', 'Rathdara Community College', 'Rath Dara CC'], { pref: ['amenity/school'] }],
  [4, 'Sacred Heart of Jesus Primary School (Huntstown)', 'Sacred Heart of Jesus Primary School, Huntstown', 'Huntstown', ['Sacred Heart Primary School Huntstown', 'Sacred Heart Huntstown', 'Sacred Heart of Jesus Primary School'], { pref: ['amenity/school', 'building/school'] }],
  [4, "Saint Brigid's National School", "St Brigid's National School, Castleknock", 'Castleknock', ["St Brigid's NS Castleknock", 'St Brigids Castleknock'], { pref: ['amenity/school'] }],
  [4, "Saint Ciaran's Primary School", "St Ciaran's Primary School", 'Hartstown', ['St Ciarans', 'St Ciarans National School', 'St Ciaran NS'], { pref: ['amenity/school'] }],
  [4, "Saint Mochta's National School", "St Mochta's National School", 'Blanchardstown', ['St Mochtas NS', 'St Mochtas School'], { pref: ['amenity/school'] }],
  [4, "Saint Patrick's National School, Diswellstown", "St Patrick's National School, Diswellstown", 'Diswellstown', ['St Patricks Diswellstown', 'St Patricks NS Diswellstown', 'Diswellstown National School'], { pref: ['amenity/school'] }],
  [4, "Saint Philip's National Schools", "St Philip's National School", 'Blanchardstown', ['St Philips NS', "St Philip's National Schools", 'St Philips School'], { pref: ['amenity/school'] }],
  [4, 'Scoil Choilm Community National School', 'Scoil Choilm Community National School', 'Blanchardstown', ['Scoil Choilm', 'Scoil Choilm CNS', 'Scoil Cholm'], { pref: ['amenity/school'] }],
  [4, 'Scoil Gráinne', 'Scoil Gráinne', 'Ongar', ['Scoil Grainne', 'Scoil Gráinne Ongar'], { pref: ['amenity/school'] }],
  [4, 'Scoil Thomáis', 'Scoil Thomáis', 'Carpenterstown', ['Scoil Thomais', 'Scoil Tomáis', 'Scoil Thomais Carpenterstown'], { pref: ['amenity/school'] }],
  [4, "St. Benedict's National School", "St Benedict's National School", 'Ongar', ['St Benedicts NS', 'St Benedicts School'], { pref: ['amenity/school'] }],
  [4, 'Mary Mother Of Hope Junior National School', 'Mary Mother of Hope Junior National School', 'Ongar', ['Mary Mother of Hope', 'Mary Mother of Hope JNS', 'Mary Mother of Hope Junior School'], { pref: ['building/school', 'amenity/school'] }],

  // Q5 heritage
  [5, "Our Lady’s Well", "Our Lady's Well", 'Mulhuddart', ["Lady's Well", 'Ladys Well', 'Our Ladys Well', "Lady's Well Mulhuddart", 'Mulhuddart Holy Well'], { pref: ['amenity/place_of_worship'], note: 'A holy well at Mulhuddart.' }],
  [5, 'Church of Virgin Mary Graveyard', 'Mulhuddart Church and Graveyard', 'Mulhuddart', ['Church of the Virgin Mary Graveyard', 'Church of Virgin Mary Graveyard', 'Mulhuddart Old Church', 'Mulhuddart Graveyard', 'Mulhuddart Church', 'Mulhuddart Old Graveyard'], { pref: ['amenity/grave_yard'] }],
  [5, "St Mary's Graveyard", "St Mary's Graveyard, Clonsilla", 'Clonsilla', ["St Mary's Church Clonsilla", 'St Marys Graveyard', 'Clonsilla Graveyard', 'Clonsilla Old Church', "St Mary's Clonsilla"], { pref: ['amenity/grave_yard'] }],
  [5, 'Bunchloch (Foundation Stone)', 'Bunchloch Foundation Stone', 'Castleknock', ['Bunchloch', 'Bunchloch Monument', 'Bunchloch Stone'], { pref: ['historic/monument'] }],
  [5, 'Martin Savage Memorial Monument', 'Martin Savage Memorial Monument', 'Castleknock', ['Martin Savage Monument', 'Martin Savage Memorial', 'Martin Savage Ambush Memorial'], { pref: ['historic/monument'], flag: 'Borderline: OpenStreetMap places this monument at the Ashtown end of Castleknock Road (53.372, -6.332), near the Dublin 7/15 edge. Confirm it is inside the boundary.' }],
  [5, 'Proclamation memorial monument', 'Proclamation Memorial Monument', 'Mulhuddart', ['Proclamation Monument', 'Proclamation Memorial', 'Mulhuddart Proclamation Monument'], { pref: ['historic/monument'] }],
  [5, 'Hollywoodrath Monuments', 'Hollywoodrath Monuments', 'Hollywoodrath', ['Hollywoodrath Monument', 'Hollywoodrath'], { pref: ['leisure/park', 'historic'] }],
  [5, 'Farmleigh', 'Farmleigh House', 'Castleknock', ['Farmleigh', 'Farmleigh Estate', 'Farmleigh House and Estate'], { pref: ['leisure/park'] }],

  // Q6 townlands / local areas (OSM administrative boundaries)
  [6, 'Ballycoolen', 'Ballycoolen', 'Ballycoolen', ['Ballycoolin', 'Ballycoolen Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Buzzardstown', 'Buzzardstown', 'Buzzardstown', [], { pref: ['boundary/administrative'] }],
  [6, 'Cappoge', 'Cappogue', 'Cappogue', ['Cappoge', 'Cappagh'], { pref: ['boundary/administrative'] }],
  [6, 'Castaheany', 'Castaheany', 'Castaheany', ['Castaheany Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Cruiserath', 'Cruiserath', 'Cruiserath', ['Cruiserath Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Deanestown', 'Deanestown', 'Deanestown', ['Deanstown'], { pref: ['boundary/administrative'] }],
  [6, 'Dunsink', 'Dunsink', 'Dunsink', ['Dunsink Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Hollywoodrath', 'Hollywoodrath', 'Hollywoodrath', ['Hollywood Rath'], { pref: ['boundary/administrative'] }],
  [6, 'Macetown North', 'Macetown North', 'Macetown North', ['Macetown'], { pref: ['boundary/administrative'] }],
  [6, 'Macetown South', 'Macetown South', 'Macetown South', ['Macetown'], { pref: ['boundary/administrative'] }],
  [6, 'Mitchelstown', 'Mitchelstown', 'Mitchelstown', ['Mitchelstown Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Sheephill', 'Sheephill', 'Sheephill', ['Sheep Hill'], { pref: ['boundary/administrative'] }],
  [6, 'Scribblestown', 'Scribblestown', 'Scribblestown', ['Scribblestown Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Woodlands', 'Woodlands', 'Woodlands', ['Woodlands Clonsilla', 'Woodlands Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Barnhill', 'Barnhill', 'Barnhill', ['Barnhill Dublin 15', 'Barnhill Clonsilla'], { pref: ['boundary/administrative'] }],
  [6, 'Littlepace', 'Littlepace', 'Littlepace', ['Littlepace Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Astagob (Clonsilla)', 'Astagob', 'Astagob', ['Astagob Clonsilla', 'Astagob Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Hansfield or Phibblestown', 'Hansfield', 'Hansfield', ['Phibblestown', 'Hansfield or Phibblestown', 'Hansfield Dublin 15'], { pref: ['boundary/administrative'] }],
  [6, 'Westmanstown', 'Westmanstown', 'Westmanstown', ['Westmanstown Dublin 15'], { pref: ['boundary/administrative'] }],

  // Q7 sports clubs
  [7, 'Hazel Lawn Tennis Club', 'Hazel Lawn Tennis Club', 'Blanchardstown', ['Hazel Lawn', 'Hazel Tennis Club', 'Hazel Lawn TC'], { pref: ['club/sport'] }],
  [7, 'Westmanstown RFC - Main pitch', 'Westmanstown RFC', 'Westmanstown', ['Westmanstown Rugby', 'Westmanstown Rugby Club', 'Westmanstown Rugby Football Club'], { pref: ['leisure/pitch'] }],
  [7, 'Elmgreen Golf Club', 'Elmgreen Golf Club', 'Castleknock', ['Elmgreen', 'Elmgreen Golf', 'Elmgreen Golf and Pitch and Putt'], { pref: ['leisure/golf_course'] }],
  [7, 'Westmanstown Golf Club', 'Westmanstown Golf Club', 'Westmanstown', ['Westmanstown Golf', 'Westmanstown GC'], { pref: ['leisure/golf_course'] }],
  [7, 'Castleknock Golf and Country Club', 'Castleknock Golf Club', 'Carpenterstown', ['Castleknock Golf and Country Club', 'Castleknock Golf', 'Castleknock Golf Course', 'Castleknock Country Club'], { pref: ['leisure/golf_course'] }],
  [7, 'Phoenix Football Club', 'Phoenix FC', 'Abbotstown', ['Phoenix Football Club', 'Phoenix F.C.', 'Phoenix Soccer Club'], { pref: ['leisure/sports_centre'], flag: 'Needs geo-check: OpenStreetMap places Phoenix FC in the Blanchardstown-Abbotstown area; confirm it is a local club based inside the boundary.' }],
  [7, 'Spartan martial arts', 'Spartan Martial Arts', 'Blanchardstown', ['Spartan Martial Arts Club', 'Spartan Martial Arts Blanchardstown', 'Spartan MMA'], { pref: ['leisure/sports_centre'] }],
];

/* -------------------------------------------------------------------------- ENRICH existing hand-curated seeds */
// [q, seed canonical, OSM name, {pref, area, flag (string|null to clear), aliases[]}]
const ENRICH = [
  [3, 'Millennium Regional Park', 'Millennium Park', { pref: ['leisure/park'] }],
  [3, 'Tolka Valley Regional Park', 'Tolka Valley Park', { pref: ['leisure/park'] }],
  [3, 'Hartstown Park', 'Hartstown Park', { pref: ['leisure/park'], area: 'Hartstown' }],
  [3, 'Corduff Park', 'Corduff Park', { pref: ['leisure/park'], area: 'Corduff' }],
  [3, 'Waterville Park', 'Waterville Park', { pref: ['leisure/park'] }],
  [3, "Lady's Well Park", "Lady's Well Park / Mick Walsh Park", { pref: ['leisure/park'], area: 'Mulhuddart', flag: null, aliases: ['Mick Walsh Park', "Lady's Well Park / Mick Walsh Park", 'Ladys Well Park Mick Walsh Park'] }],
  [3, "St Catherine's Park", 'Saint Catherine\'s Park', { pref: ['leisure/park'], flag: "LIKELY OUTSIDE THE BOUNDARY: OpenStreetMap locates St Catherine's Park at the Leixlip/Lucan edge (53.3645, -6.468), at the western limit of the Dublin 15 box. Suspend it unless you can show it lies inside the BLANION boundary." }],

  [4, 'Scoil Oilibhéir National School', 'Scoil Oilibhéir', { pref: ['amenity/school'] }],
  [4, 'St Francis Xavier Senior School', 'Saint Francis Xavier Senior National School', { pref: ['building/school'], aliases: ['St Francis Xavier Senior National Schools', 'Saint Francis Xavier Senior National School'] }],
  [4, 'St Francis Xavier Junior School', 'Saint Francis Xavier Junior National School', { pref: ['building/school'], aliases: ['St Francis Xavier Junior National Schools', 'Saint Francis Xavier Junior National School'] }],
  [4, 'Scoil Bhríde Boys National School', "Saint Brigid's Boys' National School", { pref: ['building/school'], aliases: ["St Brigid's Boys National School", "St Brigid's Boys' National School", 'St Brigids Boys NS', 'St Brigids Boys School', 'Saint Brigids Boys National School'] }],
  [4, 'Scoil Bhríde Girls National School', "Saint Brigid's Girls' National School", { pref: ['building/school'], aliases: ["St Brigid's Girls National School", "St Brigid's Girls' National School", 'St Brigids Girls NS', 'St Brigids Girls School', 'Saint Brigids Girls National School'] }],
  [4, 'Coolmine Community School', 'Coolmine Community School', { pref: ['amenity/school'] }],
  [4, 'Castleknock Community College', 'Castleknock Community College', { pref: ['amenity/school'] }],
  [4, 'Castleknock College', 'Castleknock College', { pref: ['amenity/school'] }],
  [4, 'Hartstown Community School', 'Hartstown Community School', { pref: ['amenity/school'] }],
  [4, 'Blakestown Community School', 'Blakestown Community School', { pref: ['amenity/school'] }],
  [4, 'Le Chéile Secondary School', 'Le Chéile Secondary School', { pref: ['amenity/school'], area: 'Mulhuddart' }],
  [4, "St Luke's National School", 'St. Lukes National School', { pref: ['amenity/school'], area: 'Tyrrelstown', flag: null }],
  [4, 'Tyrrelstown Educate Together National School', 'Tyrrelstown Educate Together National School', { pref: ['amenity/school'] }],
  [4, 'Powerstown Educate Together National School', 'Powerstown Educate Together National School', { pref: ['amenity/school'], area: 'Mulhuddart' }],
  [4, 'Gaelscoil an Chuilinn', 'Gaelscoil an Chuilinn', { pref: ['amenity/school'], area: 'Mulhuddart' }],
  [4, 'Mount Sackville', 'Mount Sackville Secondary School', { pref: ['amenity/school'], area: 'Castleknock', flag: 'Borderline: OpenStreetMap places Mount Sackville in Castleknock (53.3605, -6.3575), on the Chapelizod Hill side of the Liffey. Its postal district is usually given as Dublin 20, so confirm it counts as inside the boundary.' }],

  [5, 'Castleknock Castle', 'Castleknock Castle', { pref: ['historic/castle'] }],
  [5, 'Abbotstown Graveyard', 'Abbotstown Graveyard', { pref: ['amenity/grave_yard'] }],
  [5, 'Shackleton Gardens', 'The Shackleton Garden', { pref: ['leisure/park', 'leisure/garden'], area: 'Clonsilla', flag: 'OpenStreetMap locates "The Shackleton Garden" at Clonsilla (inside the boundary). Open question: is a garden a "historical landmark"? Shackleton Mills is a separate answer.' }],
  [5, "St Brigid's Church", "Saint Brigid's Church", { pref: ['amenity/place_of_worship'], flag: "OpenStreetMap lists two St Brigid's Churches, one in Castleknock and one in Blanchardstown, both inside the boundary. Both resolve to this single answer." }],
  [5, 'Astagob Ringfort', 'Astagob (Clonsilla)', { pref: ['boundary/administrative'], flag: 'The Astagob townland exists in Dublin 15 (OpenStreetMap), but the ringfort itself is not located. Confirm against the National Monuments Service Sites and Monuments Record.' }],
  [5, 'Cappogue Ringfort', 'Cappoge', { pref: ['boundary/administrative'], flag: 'The Cappogue townland exists in Dublin 15 (OpenStreetMap), but the ringfort itself is not located. Confirm against the National Monuments Service Sites and Monuments Record.' }],

  [6, 'Blanchardstown', 'Blanchardstown', { pref: ['place/town'] }],
  [6, 'Castleknock', 'Castleknock', { pref: ['place/village'] }],
  [6, 'Coolmine', 'Coolmine', { pref: ['boundary/administrative'] }],
  [6, 'Hartstown', 'Hartstown', { pref: ['boundary/administrative'] }],
  [6, 'Huntstown', 'Huntstown', { pref: ['boundary/administrative'] }],
  [6, 'Corduff', 'Corduff', { pref: ['boundary/administrative'] }],
  [6, 'Mulhuddart', 'Mulhuddart', { pref: ['place/village'] }],
  [6, 'Clonsilla', 'Clonsilla', { pref: ['boundary/administrative'] }],
  [6, 'Carpenterstown', 'Carpenterstown', { pref: ['boundary/administrative'] }],
  [6, 'Tyrrelstown', 'Tyrrelstown', { pref: ['boundary/administrative'] }],
  [6, 'Ongar', 'Ongar', { pref: ['place/village'] }],
  [6, 'Porterstown', 'Porterstown', { pref: ['boundary/administrative'] }],
  [6, 'Damastown', 'Damastown', { pref: ['boundary/administrative'] }],
  [6, 'Parslickstown', 'Parslickstown', { pref: ['boundary/administrative'] }],
  [6, 'Diswellstown', 'Diswellstown', { pref: ['boundary/administrative'] }],

  [7, "St Peregrine's GAA", "Saint Peregrine's GAA", { pref: ['leisure/sports_centre'], area: 'Hartstown', flag: null, aliases: ["Saint Peregrine's GAA", "St Peregrine's GAA Club"] }],
  [7, 'Westmanstown Gaels', "Garda Westmanstown Gaels GAA Club", { pref: ['leisure/pitch'], aliases: ['Garda Westmanstown Gaels', 'Garda Westmanstown Gaels GAA Club', 'Garda Westmanstown Gaels GAA'] }],
  [7, "St Brigid's GAA", "St Brigid's GAA Club", { pref: ['leisure/pitch'] }],
  [7, 'Castleknock Celtic', 'Castleknock Celtic - All Weather Pitch', { pref: ['leisure/pitch'], area: 'Carpenterstown' }],
  [7, 'Coolmine RFC', 'Coolmine Rugby Football Club', { pref: ['leisure/sports_centre'], area: 'Castleknock', flag: 'OpenStreetMap places the Coolmine RFC ground at the Castleknock/Ashtown side of Dublin 15 (53.378, -6.3425), not at Coolmine itself. Still inside the boundary; area label updated to Castleknock.' }],
  [7, 'Castleknock Lawn Tennis Club', 'Castleknock Tennis Club', { pref: ['leisure/sports_centre'] }],
  [7, 'Verona FC', 'Verona Sports and Leisure Club', { pref: ['leisure/sports_centre'], area: 'Blanchardstown', flag: null, aliases: ['Verona Sports and Leisure Club', 'Verona Sports and Leisure', 'Verona Sports Club'] }],
  [7, "St Mochta's FC", "Saint Mochta's Football Club", { pref: ['leisure/sports_centre'], aliases: ["Saint Mochta's Football Club", "St Mochta's Football Club"] }],
];

/* ------------------------------------------------------------------------------------------------ BUILD */
const seeds = D.buildSeedAnswers(GENERATED);
const seedByCanon = new Map(seeds.map(s => [s.q + ':' + s.canonical, s]));
const hash = s => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };

const newAnswers = NEW.map(([q, osm, canonical, area, aliases, o]) => {
  const e = find(osm, o.pref);
  const id = `b${q}-${hash(norm(canonical))}`;
  return { id, q, canonical, aliases: [...aliases], area, areaBasis: 'curated-from-osm-label', category: QCAT[q], location: `${area}, Dublin 15`, lat: +e.lat.toFixed(5), lng: +e.lon.toFixed(5), source: osmUrl(e), sources: [osmUrl(e)], osm: `${e.osm_type}/${e.osm_id}`, flag: o.flag || null, note: o.note || null };
});

const enrich = {};
for (const [q, canon, osm, o] of ENRICH) {
  const seed = seedByCanon.get(q + ':' + canon);
  if (!seed) throw new Error(`Seed not found: Q${q} ${canon}`);
  const e = find(osm, o.pref);
  enrich[seed.id] = { lat: +e.lat.toFixed(5), lng: +e.lon.toFixed(5), source: osmUrl(e), osm: `${e.osm_type}/${e.osm_id}`, ...(o.area ? { area: o.area } : {}), ...('flag' in o ? { flag: o.flag } : {}), ...(o.aliases ? { aliases: o.aliases } : {}) };
}

// --- extra categories (Endless Dive): pubs, worship, hotels, shops, food, fitness, health, business parks, roads
const allowedAreas = [...D.COVERAGE.core, ...D.COVERAGE.extended, ...newAnswers.map(a => a.area)];
const extraBuilt = ExtraBank.build(allowedAreas);
const extraAnswers = extraBuilt.answers.map(a => ({
  id: `b${a.q}-${hash(norm(a.canonical))}`, q: a.q, canonical: a.canonical, aliases: [...a.aliases], area: a.area, areaBasis: 'osm-label', category: QCAT[a.q],
  location: `${a.area}, Dublin 15`, lat: a.lat, lng: a.lng, source: a.source, sources: [a.source], osm: a.osm, flag: null, note: null, prior: a.prior,
}));
const bankAnswers = newAnswers.concat(extraAnswers);

// Manual abbreviations / nicknames for the hand-curated seed answers (people really say these)
const SEED_ABBR = {
  'Castleknock College': ['CKC', 'Castleknock College Dublin'], 'Castleknock Community College': ['CCC', 'CKCC', 'Castleknock CC'],
  'Coolmine Community School': ['CCS', 'Coolmine CS'], 'St Francis Xavier Senior School': ['SFX Senior', 'SFXS', 'SFX Senior NS'], 'St Francis Xavier Junior School': ['SFX Junior', 'SFXJ', 'SFX Junior NS'],
  'Scoil Bhríde Boys National School': ["St Brigid's Boys NS", 'SBBNS', 'Scoil Bhride Boys NS'], 'Scoil Bhríde Girls National School': ["St Brigid's Girls NS", 'SBGNS', 'Scoil Bhride Girls NS'],
  'Hartstown Community School': ['HCS', 'Hartstown CS'], 'Blakestown Community School': ['BCS', 'Blakestown CS'], 'Le Chéile Secondary School': ['Le Cheile SS', 'LCSS'],
  "St Luke's National School": ["St Luke's NS", 'St Lukes NS'], 'Tyrrelstown Educate Together National School': ['Tyrrelstown ETNS', 'Tyrrelstown ET', 'TETNS'], 'Powerstown Educate Together National School': ['Powerstown ETNS', 'Powerstown ET', 'PETNS'],
  'Gaelscoil an Chuilinn': ['Gaelscoil Chuilinn', 'GAC'], 'Scoil Oilibhéir National School': ['Scoil Oilibheir NS', 'SONS'],
  "St Peregrine's GAA": ["St Peregrine's", 'Peregrines', 'SPGAA'], 'Castleknock GAA': ['Castleknock HFC', 'Castleknock H&FC', 'CHFC', 'Castleknock Hurling & Football Club'], "St Brigid's GAA": ["St Brigid's GAA Club", 'SBGAA'],
  'Erin Go Bragh GAA': ['EGB', 'EGB GAA', 'Erin go Bragh'], 'Westmanstown Gaels': ['WG', 'Westmanstown GAA', 'Garda Westmanstown Gaels'], 'Castleknock Celtic': ['CKC', 'Castleknock Celtic FC', 'Castleknock Celtic AFC'],
  'Corduff FC': ['Corduff F.C.', 'Corduff Football Club'], 'Coolmine RFC': ['Coolmine Rugby Football Club', 'CRFC'], 'Castleknock Lawn Tennis Club': ['Castleknock LTC', 'CLTC', 'Castleknock Tennis Club'],
  'Verona FC': ['Verona Football Club', 'Verona F.C.'], "St Mochta's FC": ["St Mochta's Football Club", 'St Mochtas'], 'Tyrrelstown FC': ['Tyrrelstown Football Club'],
  'Millennium Regional Park': ['Millennium RP', 'Blanchardstown Millennium Park'], 'Tolka Valley Regional Park': ['Tolka Valley RP', 'TVP'], "St Catherine's Park": ['St Catherine Pk'],
  'River Tolka': ['R. Tolka', 'Tolka R.'], 'River Liffey': ['R. Liffey', 'Liffey R.'], 'Royal Canal': ['RC'], 'Luttrellstown Castle': ['Luttrellstown Castle Resort', 'Luttrellstown Castle Golf & Country Club', 'LTC'],
  'Coolmine Station': ['Coolmine Stn', 'Coolmine Railway'], 'Castleknock Station': ['Castleknock Stn'], 'Clonsilla Station': ['Clonsilla Stn'], 'Hansfield Station': ['Hansfield Stn'],
};
const seedAnswers = seeds.map(sd => ({ key: sd.id, q: sd.q, canonical: sd.canonical, aliases: [...sd.aliases, ...((enrich[sd.id] && enrich[sd.id].aliases) || [])], abbreviations: [...(SEED_ABBR[sd.canonical] || []), ...abbreviationsFor(sd.canonical)] }));
const bankItems = bankAnswers.map(a => ({ key: a.id, q: a.q, canonical: a.canonical, aliases: a.aliases, abbreviations: [...(SEED_ABBR[a.canonical] || []), ...abbreviationsFor(a.canonical)] }));

// Alias hygiene: within a question an alias may not equal another answer's canonical name or another's alias.
const owners = {};   // q -> Map(norm -> Set(answerKey))
const claim = (q, name, key) => { const m = (owners[q] ||= new Map()); const k = norm(name); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(key); };
seeds.forEach(s => [s.canonical, ...s.aliases].forEach(n => claim(s.q, n, s.id)));
Object.entries(enrich).forEach(([id, e]) => { const s = seeds.find(x => x.id === id); (e.aliases || []).forEach(n => claim(s.q, n, id)); });
bankAnswers.forEach(a => [a.canonical, ...a.aliases].forEach(n => claim(a.q, n, a.id)));
let dropped = 0;
const clean = (q, id, canonical, aliases) => aliases.filter(n => {
  const k = norm(n); if (k === norm(canonical)) return false;
  const owner = owners[q].get(k); if (owner.size > 1) { dropped++; return false; } return true;
}).filter((n, i, arr) => arr.findIndex(x => norm(x) === norm(n)) === i);
bankAnswers.forEach(a => { a.aliases = clean(a.q, a.id, a.canonical, a.aliases); });
Object.entries(enrich).forEach(([id, e]) => { if (e.aliases) { const s = seeds.find(x => x.id === id); e.aliases = clean(s.q, id, s.canonical, e.aliases); } });

// Abbreviations: de-duplicated against every real name and against each other (an abbreviation must never be ambiguous)
const sync = it => { /* aliases may have been cleaned above; keep the item view consistent */ };
bankItems.forEach(it => { const a = bankAnswers.find(x => x.id === it.key); it.aliases = a.aliases; });
seedAnswers.forEach(it => { const e = enrich[it.key]; it.aliases = [...seeds.find(x => x.id === it.key).aliases, ...((e && e.aliases) || [])]; });
resolveCollisions(seedAnswers.concat(bankItems));
let abbrCount = 0;
for (const it of bankItems) { const a = bankAnswers.find(x => x.id === it.key); a.abbreviations = it.abbreviations; abbrCount += it.abbreviations.length; }
for (const it of seedAnswers) { if (!it.abbreviations.length) continue; (enrich[it.key] ||= {}).abbreviations = it.abbreviations; abbrCount += it.abbreviations.length; }

// extra boundary areas introduced by the townland answers (all "extended" ring)
const areas = {};
for (const a of bankAnswers) if (!D.CENTROIDS[a.area] && !areas[a.area]) areas[a.area] = [a.lat, a.lng];

// sanity: coordinates inside the Dublin 15 box
for (const a of bankAnswers) if (a.lat < D.COVERAGE.bbox.minLat || a.lat > D.COVERAGE.bbox.maxLat || a.lng < D.COVERAGE.bbox.minLng || a.lng > D.COVERAGE.bbox.maxLng) throw new Error(`Outside box: ${a.canonical}`);

const bank = {
  version: 3, generatedAt: GENERATED,
  attribution: 'Coordinates and names \u00A9 OpenStreetMap contributors, ODbL 1.0 \u2014 https://www.openstreetmap.org/copyright',
  areas, answers: bankAnswers, enrich,
};
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'bank.json'), JSON.stringify(bank, null, 1) + '\n');
const perQ = {}; bankAnswers.forEach(a => perQ[a.q] = (perQ[a.q] || 0) + 1);
console.log(`bank v${bank.version}: ${bankAnswers.length} bank answers ${JSON.stringify(perQ)}, ${Object.keys(enrich).length} seeds enriched, ${abbrCount} abbreviations, ${dropped} colliding aliases dropped, ${extraBuilt.excluded.length} OSM places excluded (outside the boundary or unplaceable)`);
