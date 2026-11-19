'use strict';
/**
 * Extra question categories (Endless Dive only): pubs, places of worship, hotels, shops, food & drink, fitness, health, business
 * parks, roads. Built from OpenStreetMap data harvested with Nominatim (scripts/osm-raw/nominatim-extra.json + the grid harvest).
 * Rule-based selection with explicit exclusions, so every answer has a real coordinate + source link and sits inside the boundary.
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
const fs = require('fs');
const path = require('path');
const { norm } = require('../lib/util');
const Bot = require('../lib/bot');
const D = require('../lib/day001');

const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'osm-raw', 'nominatim-extra.json'), 'utf8'));
const grid = JSON.parse(fs.readFileSync(path.join(__dirname, 'osm-raw', 'nominatim.json'), 'utf8'));
const osmUrl = e => `https://www.openstreetmap.org/${e.osm_type}/${e.osm_id}`;
const tidy = n => String(n).replace(/[‘’ʼ]/g, "'").replace(/\bSaint\b/g, 'St').replace(/\bSt\.\s/g, 'St ').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ what counts, per question */
// q -> { cat: harvest category names, re: class/type test, drop: names to exclude (lower-case), canon: {osm name: canonical}, aliases: {canonical: [..]}, prior: {canonical: n} }
const SPEC = {
  8: { cat: ['pubs'], re: /^amenity\/(pub|bar)$/,
    drop: ["mcdonald's", "st peregrine's gaa - bar", 'palmerstown house'],
    aliases: { 'The Twelfth Lock': ['12th Lock', 'Twelfth Lock', 'The 12th Lock'], "Kavanagh's of Castleknock": ['Kavanaghs', "Kavanagh's", 'Kavanaghs of Castleknock'], 'The Brookwood Inn': ['Brookwood Inn', 'Brookwood'], 'Greyhound Inn': ['The Greyhound Inn', 'Greyhound'], 'Clonsilla Inn': ['The Clonsilla Inn'], 'The Roselawn Inn': ['Roselawn Inn'] },
    prior: { 'The Twelfth Lock': 0.14, 'Clonsilla Inn': 0.1, "Kavanagh's of Castleknock": 0.08, 'The Brookwood Inn': 0.07 } },
  9: { cat: ['worship'], re: /^amenity\/place_of_worship$/,
    drop: [],
    canon: { 'The Church of Jesus Christ of Latter-day Saints': 'Church of Jesus Christ of Latter-day Saints', 'Saint Luke the Evangelist': "St Luke the Evangelist Church", "Saint Philip's": "St Philip's Church", "Saint Ciaran's": "St Ciaran's Church", 'Mary Mother of Hope': 'Mary Mother of Hope Church' },
    aliases: { 'Church of Jesus Christ of Latter-day Saints': ['LDS Church', 'LDS', 'Latter-day Saints', 'Mormon Church', 'Church of Jesus Christ'], "St Brigid's Church": [], 'Our Lady Mother of the Church': ['Our Lady Mother of the Church Castleknock'] },
    prior: { "St Brigid's Church": 0.15, "St Thomas the Apostle Church": 0.06, "St Mochta's Church": 0.06 } },
  10: { cat: ['hotels'], re: /^tourism\/(hotel|guest_house)$/,
    drop: ['the twelfth lock'],
    canon: { Carlton: 'Carlton Hotel Blanchardstown', Travelodge: 'Travelodge Castleknock', 'Crowne Plaza': 'Crowne Plaza Blanchardstown' },
    aliases: { 'Carlton Hotel Blanchardstown': ['Carlton Hotel', 'Carlton', 'Carlton Blanchardstown'], 'Travelodge Castleknock': ['Travelodge', 'Travelodge Dublin Castleknock', 'Travelodge Hotel Castleknock'], 'Crowne Plaza Blanchardstown': ['Crowne Plaza', 'Crowne Plaza Hotel', 'Crowne Plaza Dublin Blanchardstown', 'Crowne Plaza Hotel Blanchardstown'], 'Castleknock Hotel': ['Castleknock Hotel and Country Club', 'Castleknock Hotel & Country Club', 'Castleknock Country Club Hotel'] },
    prior: { 'Crowne Plaza Blanchardstown': 0.35, 'Castleknock Hotel': 0.3, 'Travelodge Castleknock': 0.15, 'Carlton Hotel Blanchardstown': 0.12 } },
  11: { cat: ['shops'], re: /^shop\/(?!hairdresser|beauty|tattoo|massage|bookmaker|travel_agency|mobile_phone|estate_agent)|^amenity\/post_office$/,
    drop: ['carry out', 'chill in', 'flavour', 'moldova', 'lituanica', 'polonez', 'netpol', 'polo stores', 'just cats veterinary clinic', 'fifty three degrees north', 'dreams/sofatime', 'ez living', "home focus at hickey's", 'the optician', 'butlers pantry castleknock', 'eir', 'carpenter off-license', 'village meats', 'angels flowers', "tom stanley's", 'brown bag bakery', 'petstop'],
    aliases: { Penneys: ['Primark'], 'Dunnes Stores': ['Dunnes', 'Dunnes Store', 'Dunnes Stores Blanchardstown'], SuperValu: ['Super Valu', 'SV'], 'TK Maxx': ['TKMaxx', 'TK Max', 'T K Maxx'], Smyths: ['Smyths Toys', 'Smyths Toys Superstores', "Smyth's"], Currys: ['Currys PC World', 'PC World', 'Currys Digital'], Tesco: ['Tesco Extra', 'Tesco Blanchardstown'], Lidl: ['Lidl Blanchardstown'], Aldi: ['Aldi Blanchardstown'], 'Harvey Norman': ['Harvey Normans'], Eurospar: ['Euro Spar', 'EuroSpar', 'Spar'], Waterstones: ["Waterstone's"], 'DFS': ['DFS Sofas'], 'JYSK': ['Jysk'], "O'Briens": ["O'Brien's", 'OBriens', "O'Briens Wine"], "Molloy's Liquor Stores": ['Molloys', "Molloy's", 'Molloys Liquor Stores'] },
    prior: { Tesco: 0.22, 'Dunnes Stores': 0.28, Penneys: 0.2, Lidl: 0.12, Aldi: 0.1, SuperValu: 0.06, Centra: 0.05, Spar: 0.05, Smyths: 0.04, 'TK Maxx': 0.05, Next: 0.04, Currys: 0.03 } },
  12: { cat: ['food'], re: /^amenity\/(fast_food|restaurant|cafe|ice_cream)$|^shop\/bakery$/,
    drop: ['halfway house', 'maxol', 'dunnes', 'sodexo', 'roselawn shopping centre', 'snack bar', 'diner', 'falafel', 'roma', 'the gate', "jack's", 'the nook', 'w factor', '5 to go', 'half & half', 'rendevous', 'garden house', 'glass onion', 'bueno', 'pizza hut delivery', 'mutea', 'kb coffee', 'café aroma', 'cafe aroma', 'café park', 'cafe park', 'the hungry monkey', 'giulios take away', 'host chinese', 'bahaar'],
    aliases: { KFC: ['Kentucky Fried Chicken'], 'Burger King': ['BK'], "Domino's": ['Dominos', "Domino's Pizza", 'Dominos Pizza'], Costa: ['Costa Coffee'], Starbucks: ['Starbucks Coffee'], Insomnia: ['Insomnia Coffee', 'Insomnia Coffee Company'], 'Krispy Kreme': ['Krispy Kreme Doughnuts'], Boojum: ['Boojum Burritos'], Abrakebabra: ['Abra Kebabra', 'Abrakebabra Blanchardstown'], 'Apache Pizza': ['Apache'], 'Java Republic': ['Java Republic Coffee'], Wagamama: ['Wagamamas', 'Wagamama Blanchardstown'], Popeyes: ["Popeye's", 'Popeyes Chicken'], 'JD Wetherspoon': ['Wetherspoons', "Wetherspoon's", 'Spoons'], 'Four Star Pizza': ['Four Star'], 'Eddie Rocket\'s': ["Eddie Rockets"] },
    prior: { KFC: 0.14, Starbucks: 0.12, Costa: 0.1, Subway: 0.08, 'Burger King': 0.08, "Domino's": 0.06, Wagamama: 0.05, Insomnia: 0.05, Boojum: 0.04, 'Apache Pizza': 0.04, 'Krispy Kreme': 0.04, Popeyes: 0.03 } },
  13: { cat: ['fitness'], re: /^leisure\/(sports_centre|fitness_centre|swimming_pool)$/,
    keep: ['ben dunne gym', 'westside gym', 'fyre gym', 'ger conroy fitness', 'evolve fitness', 'coolmine sports complex', 'national aquatic centre', 'verona sports and leisure club', 'leisureplex'],
    canon: { 'Ben Dunne Gym': 'Ben Dunne Gym' },
    aliases: { 'Ben Dunne Gym': ['Ben Dunne Gyms', 'Ben Dunne Gym Blanchardstown', 'BDG'], 'National Aquatic Centre': ['NAC', 'Aquatic Centre', 'Irish National Aquatic Centre', 'Sport Ireland National Aquatic Centre', 'National Aquatic Centre Blanchardstown'], 'Coolmine Sports Complex': ['Coolmine Sports Centre', 'Coolmine Leisure Centre'], Leisureplex: ['Leisureplex Blanchardstown', 'Leisure Plex'], 'Verona Sports and Leisure Club': ['Verona Sports and Leisure', 'Verona Sports Club', 'Verona Leisure Club'] },
    prior: { 'National Aquatic Centre': 0.35, 'Ben Dunne Gym': 0.15, 'Westside Gym': 0.05 } },
  14: { cat: ['health'], re: /^amenity\/(pharmacy|clinic|hospital|doctors)$/,
    drop: ['st edmundsbury hospital', 'cappagh national orthopaedic hospital', 'femplus', 'limitless health', 'medical cantre', 'kirk field foot clinic/oakwood medical clinic', 'primacare', "sheridan's", 'hickeys', 'generation healthcare', 'healthwell clinic', 'meridian clinic', 'the meridian clinic', 'the rise family practice', "lynch's all are pharmacy", 'odc pharmacy'],
    canon: { 'Connolly Hospital': 'Connolly Hospital', "Hickey's": "Hickey's Pharmacy", Boots: 'Boots Pharmacy' },
    aliases: { 'Connolly Hospital': ['James Connolly Memorial Hospital', 'James Connolly Hospital', 'Connolly Memorial Hospital', 'Connolly Memorial', 'JCMH', 'Connolly'], "McCabe's Pharmacy": ['McCabes', 'McCabes Pharmacy', "McCabe's"], "Hickey's Pharmacy": ['Hickeys', 'Hickeys Pharmacy', "Hickey's"], 'Boots Pharmacy': ['Boots', 'Boots Blanchardstown'], 'Lloyds Pharmacy': ["Lloyd's Pharmacy", 'Lloyds'], 'Chemist Warehouse': ['Chemist Warehouse Blanchardstown'], 'Castleknock Village Clinic': ['Castleknock Clinic'] },
    prior: { 'Connolly Hospital': 0.45, "McCabe's Pharmacy": 0.1, 'Boots Pharmacy': 0.08, "Hickey's Pharmacy": 0.06, 'Lloyds Pharmacy': 0.05 } },
  15: { cat: ['business', 'landmarks'], re: /^(landuse\/(industrial|commercial|retail)|building\/retail|highway\/service|office\/company)$/,
    keep: ['rosemount business park', 'ballycoolin ida business park', 'northwest business park', 'college business & technology park', 'ida blanchardstown snugborough business and technology park', 'stadium business park', 'millennium business park', 'premier business park', 'huntstown business park', 'gateway business park', 'westpoint business park', 'plato business park', 'centrepoint business park', 'keypoint business park', 'coolmine industrial estate', 'phoenix industrial estate', 'gaywood industrial estate', 'westend retail park', 'ashleigh retail centre', 'base enterprise park', 'damastown technology park', 'damastown industrial park', 'northwest logistics park', 'carpenterstown shopping centre', 'mountview shopping centre', 'centrepoint shopping centre', 'hartstown shopping centre', 'blanchardstown centre', 'blanchardstown shopping centre', 'blanchardstown retail park', 'tyrrelstown town centre', 'roselawn shopping centre', 'old quarry campus'],
    canon: { 'College Business & Technology Park': 'College Business and Technology Park', 'IDA Blanchardstown Snugborough Business and Technology Park': 'Snugborough Business and Technology Park', 'Ballycoolin IDA Business Park': 'Ballycoolin Business Park', 'Blanchardstown Shopping Centre': 'Blanchardstown Centre' },
    aliases: { 'Blanchardstown Centre': ['Blanchardstown Shopping Centre', 'Blanchardstown Town Centre', 'The Centre', 'Blanch Centre', 'Blanchardstown Shopping Center', 'Blanchardstown Mall'], 'Ballycoolin Business Park': ['Ballycoolin IDA Business Park', 'Ballycoolin IDA'], 'Snugborough Business and Technology Park': ['Snugborough Business Park', 'Snugborough Technology Park', 'IDA Blanchardstown Snugborough Business and Technology Park'], 'Northwest Business Park': ['North West Business Park', 'Northwest Business Park Ballycoolin'], 'College Business and Technology Park': ['College Business Park'], 'Blanchardstown Retail Park': ['Blanch Retail Park'], 'Tyrrelstown Town Centre': ['Tyrrelstown Centre', 'Tyrrelstown Shopping Centre'] },
    prior: { 'Blanchardstown Centre': 0.55, 'Northwest Business Park': 0.07, 'Ballycoolin Business Park': 0.07, 'Blanchardstown Retail Park': 0.06 } },
};
const ROAD_WORD = /\b(road|avenue|street|drive|way|lane|walk|grove|lawn|court|park|close|square|crescent|terrace|place|gate|hill|rise|route|parkway|bypass|boulevard|green|view|heights|heath)\b/i;
const ROAD_DROP = /,|business park|^boulevard$|^the |dunboyne|clonee to|oldtown|lucan|ashtown|palmerstown|chapelizod|leixlip|adamstown|phoenix park|navan road parkway|^navan road$/i;
const ROAD_ALIASES = { 'Northern Cross Route Motorway': ['Northern Cross Route', 'Northern Cross', 'N3 Northern Cross Route'], 'Western Parkway Motorway': ['Western Parkway', 'M50 Western Parkway'], 'Blanchardstown Road North': ['Blanchardstown Rd North'], 'Blanchardstown Road South': ['Blanchardstown Rd South'], 'Castleknock Road': ['Castleknock Rd'], 'Navan Road': ['N3 Navan Road', 'Navan Rd'] };
const ROAD_PRIOR = { 'Castleknock Road': 0.08, 'Blanchardstown Road North': 0.07, 'Northern Cross Route Motorway': 0.06 };

/* --------------------------------------------------------------------------------------- build */
function build(allowedAreas) {
  const out = [], excluded = [];
  const take = (q, e, canonical, area, spec, cat) => {
    out.push({ q, osmName: e.name, canonical, area, lat: +e.lat.toFixed(5), lng: +e.lon.toFixed(5), source: osmUrl(e), osm: `${e.osm_type}/${e.osm_id}`, kind: e.category + '/' + e.type,
      aliases: (spec.aliases && spec.aliases[canonical]) || [], prior: (spec.prior && spec.prior[canonical]) != null ? spec.prior[canonical] : 0.008 });
  };
  const seenByQ = {};
  const place = (q, e, spec, canonicalOverride) => {
    if (!Bot.areaFor || !e.name) return;
    if (!(e.lat >= D.COVERAGE.bbox.minLat && e.lat <= D.COVERAGE.bbox.maxLat && e.lon >= D.COVERAGE.bbox.minLng && e.lon <= D.COVERAGE.bbox.maxLng)) { excluded.push(`Q${q} ${e.name}: outside box`); return; }
    const area = Bot.areaFor({ ...e, lat: e.lat, lon: e.lon }, allowedAreas);
    if (!area) { excluded.push(`Q${q} ${e.name}: not placeable in an approved area (${Object.values(e.address || {}).filter(Boolean).join('/')})`); return; }
    const canonical = tidy((spec.canon && spec.canon[e.name]) || canonicalOverride || e.name);
    const k = norm(canonical); const seen = (seenByQ[q] ||= new Set()); if (seen.has(k)) return; seen.add(k);
    take(q, e, canonical, area, spec);
  };
  for (const [qs, spec] of Object.entries(SPEC)) {
    const q = Number(qs);
    for (const e of extra) {
      if (!spec.cat.includes(e.cat)) continue;
      const kind = e.category + '/' + e.type; if (!spec.re.test(kind)) continue;
      const lname = tidy(e.name).toLowerCase();
      if (spec.drop && spec.drop.includes(lname)) continue;
      if (spec.keep && !spec.keep.includes(lname)) continue;
      if (q === 15 && !/park|estate|centre|campus|retail/i.test(e.name)) continue;
      place(q, e, spec);
    }
  }
  // roads: from the grid harvest and the road search
  const roadSeen = new Set();
  for (const e of [...grid, ...extra.filter(x => x.cat === 'roads')]) {
    if (!e.name || !/^highway\/(secondary|tertiary|residential|motorway|trunk|primary|unclassified)$/.test(e.category + '/' + e.type)) continue;
    const name = tidy(e.name); if (ROAD_DROP.test(name) || /DED|\bED\b/.test(name) || !ROAD_WORD.test(name) || /roundabout/i.test(name)) continue;
    if (roadSeen.has(norm(name))) continue; roadSeen.add(norm(name));
    place(16, e, { aliases: ROAD_ALIASES, prior: ROAD_PRIOR });
  }
  return { answers: out, excluded };
}

module.exports = { build, SPEC };
