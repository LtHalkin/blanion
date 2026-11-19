'use strict';
/**
 * OFFICIAL DAY 001 — question + seed answer database.
 *
 * Honesty notes (read these before trusting the data):
 *  - The answers below are the CURATED list supplied by the BLANION editor. They have NOT been independently
 *    re-verified by this build. Status is therefore "curated" (not "verified").
 *  - Coordinates are AREA CENTROIDS (coordPrecision: 'area-centroid'), not surveyed points. Replace with real
 *    coordinates through ANSWER REVIEW / the Answers tab when each entity is checked.
 *  - Answers whose location/identity looks doubtful carry a `flag`. They remain accepted (the editor supplied them)
 *    but show up in the admin "Flagged" queue until an admin confirms or suspends them.
 *  - Where the supplied list contained two names for the same entity (e.g. "Millennium Regional Park" and
 *    "Millennium Park") they are merged into ONE canonical answer so nobody is paid twice for one thing.
 *  - `prior` = expected fraction of players who will give that answer. Used only for PROVISIONAL rarity.
 */

const SRC = {
  waterways: ['https://www.fingal.ie/index.php/ten-visit-blanchardstowncastleknock-areas'],
  stations: ['https://www.irishrail.ie/'],
  parks: [
    'https://www.fingal.ie/directory/amenities/parks/millennium-regional-park',
    'https://www.fingal.ie/liffeyvalleytrail',
    'https://www.fingal.ie/trips/lots-do-dublin-15',
  ],
  schools: ['https://www.blanchardstownparish.ie/schools/', 'https://www.fingal.ie/'],
  heritage: ['https://www.fingal.ie/heritage-area-dublin-15'],
  areas: ['https://www.fingal.ie/heritage-area-dublin-15'],
  sports: ['https://www.cordufffc.com/', 'https://www.mytown.ie/blanchardstown/Sports-Clubs', 'https://www.littlevillage.ie/'],
};

// Approximate area centroids (WGS84). Deliberately coarse — see note above.
const CENTROIDS = {
  'Blanchardstown Village': [53.3877, -6.3769],
  'Blanchardstown': [53.3921, -6.3770],
  'Castleknock': [53.3727, -6.3640],
  'Carpenterstown': [53.3724, -6.3951],
  'Coolmine': [53.3797, -6.3950],
  'Hartstown': [53.3965, -6.4093],
  'Huntstown': [53.4012, -6.3877],
  'Clonsilla': [53.3858, -6.4167],
  'Corduff': [53.4068, -6.3714],
  'Mulhuddart': [53.4040, -6.3770],
  'Roselawn': [53.3990, -6.3660],
  'Tyrrelstown': [53.4110, -6.3990],
  'Blakestown': [53.3957, -6.3860],
  'Ongar': [53.3939, -6.4320],
  'Porterstown': [53.3790, -6.4090],
  'Damastown': [53.4090, -6.4330],
  'Parslickstown': [53.4040, -6.4180],
  'Kilmartin': [53.3880, -6.3440],
  'Abbotstown': [53.3870, -6.3540],
  'Diswellstown': [53.3790, -6.3800],
  'Laurel Lodge': [53.3770, -6.3560],
  'Hansfield': [53.4010, -6.4380],
  'Luttrellstown': [53.3774, -6.4330],
  'Westmanstown': [53.3710, -6.4440],
};

/** Boundary. "core" = the seven areas named in the BLANION brief. "extended" = other Dublin 15 townlands that the
 *  Day 001 answer set (supplied by the editor) depends on. Admins can switch the extended ring off. */
const COVERAGE = {
  core: ['Blanchardstown Village', 'Blanchardstown', 'Castleknock', 'Carpenterstown', 'Coolmine', 'Hartstown', 'Huntstown'],
  extended: [
    'Clonsilla', 'Corduff', 'Mulhuddart', 'Roselawn', 'Tyrrelstown', 'Blakestown', 'Ongar', 'Porterstown', 'Damastown',
    'Parslickstown', 'Kilmartin', 'Abbotstown', 'Diswellstown', 'Laurel Lodge', 'Hansfield', 'Luttrellstown', 'Westmanstown',
  ],
  // Generous Dublin-15 bounding box used as a sanity check when an admin supplies coordinates.
  bbox: { minLat: 53.355, maxLat: 53.425, minLng: -6.47, maxLng: -6.325 },
};

/** Known out-of-boundary names that players commonly try. Auto-rejected (appealable). */
const OUT_OF_BOUNDS = [
  { names: ['Phoenix Park'], reason: 'Phoenix Park is in Dublin 8/20, outside the BLANION boundary.' },
  { names: ['Lucan', 'Ballyfermot', 'Finglas', 'Ballymun', 'Swords', 'Cabra', 'Chapelizod', 'Leixlip', 'Maynooth', 'Clondalkin', 'Navan'], reason: 'That place is outside the BLANION boundary.' },
  { names: ['Liffey Valley Shopping Centre', 'Liffey Valley'], reason: 'Liffey Valley is in Clondalkin, outside the BLANION boundary.' },
  { names: ['Dublin Airport', 'Heuston Station', 'Connolly Station', 'Pearse Station'], reason: 'That is outside the BLANION boundary.' },
];

/** Generic answers that are never acceptable (too broad). */
const TOO_BROAD = ['dublin', 'dublin 15', 'd15', 'dublin15', 'fingal', 'county dublin', 'ireland', 'leinster', 'north dublin', 'west dublin', 'dublin city', 'blanch', 'blanchardstown area'];

const QUESTIONS = [
  { n: 1, text: 'Name a waterway found in the BLANION coverage area.', category: 'Waterways', src: 'waterways' },
  { n: 2, text: 'Name a railway station serving the BLANION coverage area.', category: 'Rail', src: 'stations' },
  { n: 3, text: 'Name a park or public green space in the BLANION coverage area.', category: 'Parks', src: 'parks' },
  { n: 4, text: 'Name a school in the BLANION coverage area.', category: 'Schools', src: 'schools' },
  { n: 5, text: 'Name a historical landmark or archaeological site in the BLANION coverage area.', category: 'Heritage', src: 'heritage' },
  { n: 6, text: 'Name a neighbourhood or local area in the BLANION coverage area.', category: 'Neighbourhoods', src: 'areas' },
  { n: 7, text: 'Name a sports club based in the BLANION coverage area.', category: 'Sport', src: 'sports' },
];

// A(q, canonical, {a: aliases, p: prior, area, f: flag, n: note, s: source index})
const raw = [];
const A = (q, canonical, o = {}) => raw.push({ q, canonical, ...o });

// ---------- Q1 Waterways ----------
A(1, 'River Tolka', { a: ['Tolka', 'Tolka River', 'The Tolka', 'River Tolka Blanchardstown'], p: 0.40, area: 'Blanchardstown', n: 'The Tolka flows through Mulhuddart and Blanchardstown on its way to Dublin Bay.' });
A(1, 'River Liffey', { a: ['Liffey', 'Liffey River', 'The Liffey', 'Anna Liffey'], p: 0.34, area: 'Castleknock', n: 'The Liffey runs along the southern edge of Castleknock.' });
A(1, 'Royal Canal', { a: ['The Royal Canal', 'Royal Canal Dublin', 'Royal Canal Greenway', 'Royal'], p: 0.25, area: 'Coolmine', n: 'The Royal Canal threads through Coolmine, Clonsilla and Castleknock.' });

// ---------- Q2 Stations ----------
A(2, 'Coolmine Station', { a: ['Coolmine', 'Coolmine Train Station', 'Coolmine Railway Station', 'Coolmine Rail'], p: 0.32, area: 'Coolmine', n: 'On the Maynooth/M3 Parkway line.' });
A(2, 'Castleknock Station', { a: ['Castleknock', 'Castleknock Train Station', 'Castleknock Railway Station', 'Castleknock Rail'], p: 0.32, area: 'Castleknock', n: 'On the Maynooth/M3 Parkway line.' });
A(2, 'Clonsilla Station', { a: ['Clonsilla', 'Clonsilla Train Station', 'Clonsilla Railway Station', 'Clonsilla Rail'], p: 0.25, area: 'Clonsilla', n: 'Junction for the Maynooth and Docklands/M3 Parkway services.' });
A(2, 'Hansfield Station', { a: ['Hansfield', 'Hansfield Train Station', 'Hansfield Railway Station', 'Hansfield Rail', 'Hansfield SDZ'], p: 0.10, area: 'Hansfield', n: 'Serves the Hansfield Strategic Development Zone.' });

// ---------- Q3 Parks ----------
A(3, 'Millennium Regional Park', { a: ['Millennium Park', 'Blanchardstown Millennium Park', 'Millenium Park', 'Millennium Regional', 'Millenium Regional Park'], p: 0.28, area: 'Blanchardstown', s: 0, n: 'Also known simply as Millennium Park (the two names in the brief are one park).' });
A(3, 'Tolka Valley Regional Park', { a: ['Tolka Valley Park', 'Tolka Valley', 'Tolka Park', 'Tolka Valley Regional'], p: 0.15, area: 'Blanchardstown', s: 1, n: 'Also known as Tolka Valley Park.' });
A(3, "St Catherine's Park", { a: ['Saint Catherines Park', 'St Catherines', 'St Catherine Park'], p: 0.05, area: 'Blanchardstown', s: 1, f: "Needs geo-check: St Catherine's Park is on the Liffey Valley Trail near Lucan/Leixlip; confirm it lies inside the boundary.", n: 'Part of the Liffey Valley Trail.' });
A(3, 'Hartstown Park', { a: ['Hartstown', 'Hartstown Community Park', 'Hartstown Huntstown Park'], p: 0.12, area: 'Hartstown', s: 2 });
A(3, 'Corduff Park', { a: ['Corduff Playground', 'Corduff Community Park'], p: 0.07, area: 'Corduff', s: 2 });
A(3, "Lady's Well Park", { a: ['Ladys Well Park', 'Lady Well Park', 'Ladys Well', 'Lady\'s Well'], p: 0.04, area: 'Blanchardstown', s: 2, f: "Needs geo-check: confirm the exact location of Lady's Well Park." });
A(3, 'Waterville Park', { a: ['Waterville', 'Waterville Blanchardstown'], p: 0.11, area: 'Blanchardstown', s: 2 });
A(3, 'Hopkins Park', { a: ['Hopkins', 'Hopkins Road Park'], p: 0.03, area: 'Blanchardstown', s: 2, f: 'Needs geo-check: confirm Hopkins Park exists as a public park inside the boundary.' });

// ---------- Q4 Schools ----------
A(4, 'Scoil Oilibhéir National School', { a: ['Scoil Oilibheir', 'Scoil Oilibhéir', 'Scoil Oliver', 'Scoil Oilibhéir NS'], p: 0.05, area: 'Blanchardstown', s: 0 });
A(4, 'St Francis Xavier Senior School', { a: ['SFX Senior', 'St Francis Xavier Senior', 'Francis Xavier Senior', 'St Francis Xavier Senior National School', 'SFX Senior School'], p: 0.09, area: 'Blanchardstown', s: 0 });
A(4, 'St Francis Xavier Junior School', { a: ['SFX Junior', 'St Francis Xavier Junior', 'Francis Xavier Junior', 'St Francis Xavier Junior National School', 'SFX Junior School'], p: 0.07, area: 'Blanchardstown', s: 0 });
A(4, 'Scoil Bhríde Boys National School', { a: ['Scoil Bhride Boys', 'Scoil Bhríde Boys', 'Scoil Bhride Boys NS', 'Scoil Bhride Boys National School'], p: 0.03, area: 'Blanchardstown', s: 0 });
A(4, 'Scoil Bhríde Girls National School', { a: ['Scoil Bhride Girls', 'Scoil Bhríde Girls', 'Scoil Bhride Girls NS', 'Scoil Bhride Girls National School'], p: 0.03, area: 'Blanchardstown', s: 0 });
A(4, 'Coolmine Community School', { a: ['Coolmine', 'Coolmine CS', 'Coolmine Community', 'Coolmine School', 'Coolmine Secondary School'], p: 0.24, area: 'Coolmine', s: 0 });
A(4, 'Castleknock Community College', { a: ['Castleknock CC', 'Castleknock Community', 'Castleknock Community School', 'Castleknock Secondary School'], p: 0.14, area: 'Castleknock', s: 0 });
A(4, 'Castleknock College', { a: ['Castleknock Boys College', 'Castleknock College Dublin', 'Castleknock Vincentian College'], p: 0.08, area: 'Castleknock', s: 0 });
A(4, 'Hartstown Community School', { a: ['Hartstown', 'Hartstown CS', 'Hartstown Community', 'Hartstown School'], p: 0.08, area: 'Hartstown', s: 0 });
A(4, 'Blakestown Community School', { a: ['Blakestown', 'Blakestown CS', 'Blakestown Community', 'Blakestown School'], p: 0.04, area: 'Blakestown', s: 0 });
A(4, 'Le Chéile Secondary School', { a: ['Le Cheile', 'Le Cheile Secondary', 'Le Chéile', 'Le Cheile School', 'Le Cheile Tyrrelstown'], p: 0.04, area: 'Tyrrelstown', s: 0 });
A(4, "St Luke's National School", { a: ['St Lukes', 'St Lukes NS', 'St Lukes National School', 'Saint Lukes National School', 'St Lukes School'], p: 0.03, area: 'Blanchardstown', s: 0, f: "Needs geo-check: several schools are called St Luke's; confirm this one is inside the boundary." });
A(4, 'Tyrrelstown Educate Together National School', { a: ['Tyrrelstown Educate Together', 'Tyrrelstown ETNS', 'Tyrrelstown ET', 'Educate Together Tyrrelstown'], p: 0.03, area: 'Tyrrelstown', s: 0 });
A(4, 'Powerstown Educate Together National School', { a: ['Powerstown Educate Together', 'Powerstown ETNS', 'Powerstown ET', 'Educate Together Powerstown', 'Powerstown'], p: 0.03, area: 'Blanchardstown', s: 0 });
A(4, 'Gaelscoil an Chuilinn', { a: ['Gaelscoil an Chuillin', 'Gaelscoil Chuilinn', 'Gaelscoil an Chuilinn Dublin 15'], p: 0.03, area: 'Hartstown', s: 0 });
A(4, 'Mount Sackville', { a: ['Mount Sackville Secondary School', 'Mount Sackville Convent', 'Mount Sackville School'], p: 0.02, area: 'Castleknock', s: 0, f: 'Needs geo-check: Mount Sackville is generally listed in Chapelizod (Dublin 20). It may be OUTSIDE the boundary.' });

// ---------- Q5 Heritage ----------
A(5, 'Luttrellstown Castle', { a: ['Luttrellstown', 'Luttrelstown Castle', 'Luttrellstown Castle Estate', 'Luttrellstown Demesne'], p: 0.34, area: 'Luttrellstown', s: 0 });
A(5, 'Shackleton Mills', { a: ['Shackleton Mill', 'Shackletons Mills', 'Shackleton Mills Lucan'], p: 0.02, area: 'Castleknock', s: 0, f: 'Needs geo-check: Shackleton Mills / Shackleton Gardens are usually associated with the Lucan–Leixlip stretch of the Liffey. Confirm placement.' });
A(5, "St Brigid's Church", { a: ['St Brigids Church', 'Saint Brigids Church', 'St Brigid Church Castleknock', "St Brigid's Church Castleknock", 'St Brigids Church Blanchardstown'], p: 0.05, area: 'Castleknock', s: 0, f: "Needs disambiguation: confirm which St Brigid's Church is meant (Castleknock vs Blanchardstown)." });
A(5, 'Castleknock Castle', { a: ['Castleknock Motte and Bailey', 'Castleknock Motte', 'Castleknock Motte & Bailey', 'Castleknock Norman Castle', 'Castleknock Norman Motte', 'Castleknock Castle Motte'], p: 0.22, area: 'Castleknock', s: 0, n: 'The Norman motte-and-bailey site beside Castleknock College (the two names in the brief are one site).' });
A(5, 'Abbotstown Graveyard', { a: ['Abbotstown Cemetery', 'Abbotstown Graveyard Castleknock', 'Abbotstown Burial Ground'], p: 0.02, area: 'Abbotstown', s: 0 });
A(5, 'White Chapel, Coolmine', { a: ['White Chapel', 'Whitechapel Coolmine', 'White Chapel Coolmine', 'Whitechapel', 'The White Chapel'], p: 0.02, area: 'Coolmine', s: 0 });
A(5, 'Corduff Ringfort', { a: ['Corduff Ring Fort', 'Ringfort Corduff', 'Corduff Fort'], p: 0.03, area: 'Corduff', s: 0 });
A(5, 'Cappogue Ringfort', { a: ['Cappogue Ring Fort', 'Cappoge Ringfort', 'Cappogue Fort'], p: 0.01, area: 'Blanchardstown', s: 0, f: 'Needs geo-check: confirm ringfort location against the Dublin 15 heritage map.' });
A(5, 'Astagob Ringfort', { a: ['Astagob Ring Fort', 'Astagob', 'Astagob Fort'], p: 0.01, area: 'Blanchardstown', s: 0, f: 'Needs geo-check: confirm ringfort location against the Dublin 15 heritage map.' });
A(5, 'Balcurris Ringfort', { a: ['Balcurris Ring Fort', 'Balcurris', 'Balcurris Fort'], p: 0.01, area: 'Blanchardstown', s: 0, f: 'Needs geo-check: confirm ringfort location against the Dublin 15 heritage map.' });
A(5, 'Coldwinters Ringfort', { a: ['Coldwinters Ring Fort', 'Coldwinters', 'Coldwinter Ringfort', 'Coldwinters Fort'], p: 0.01, area: 'Blanchardstown', s: 0, f: 'Needs geo-check: confirm ringfort location against the Dublin 15 heritage map.' });
A(5, 'Porterstown Ringfort', { a: ['Porterstown Ring Fort', 'Porterstown Fort'], p: 0.01, area: 'Porterstown', s: 0 });
A(5, 'Shackleton Gardens', { a: ['Shackleton Garden', 'Shackletons Gardens'], p: 0.01, area: 'Castleknock', s: 0, f: 'Needs geo-check: see Shackleton Mills. Possibly the same site; admin may merge.' });

// ---------- Q6 Neighbourhoods ----------
const hoods = [
  ['Blanchardstown', ['Blanch', 'Blanchardstown Village', 'Blanchardstown Dublin 15', 'Blanchestown', 'Blanchardtown'], 0.30, 'Blanchardstown'],
  ['Castleknock', ['Castleknock Village', 'Castleknock Dublin 15', 'Castleknok'], 0.26, 'Castleknock'],
  ['Coolmine', ['Coolmine Dublin 15', 'Coolmine Village'], 0.12, 'Coolmine'],
  ['Hartstown', ['Hartstown Dublin 15'], 0.10, 'Hartstown'],
  ['Huntstown', ['Huntstown Dublin 15'], 0.04, 'Huntstown'],
  ['Corduff', ['Corduff Dublin 15'], 0.05, 'Corduff'],
  ['Mulhuddart', ['Mulhuddart Village', 'Mulhudart', 'Mulhuddart Dublin 15'], 0.10, 'Mulhuddart'],
  ['Clonsilla', ['Clonsilla Village', 'Clonsilla Dublin 15'], 0.12, 'Clonsilla'],
  ['Carpenterstown', ['Carpenterstown Dublin 15', 'Carpentierstown', 'Carpentertown'], 0.05, 'Carpenterstown'],
  ['Roselawn', ['Rose Lawn', 'Roselawn Dublin 15'], 0.03, 'Roselawn'],
  ['Tyrrelstown', ['Tyrellstown', 'Tyrrelstown Dublin 15', 'Tyrelstown'], 0.07, 'Tyrrelstown'],
  ['Blakestown', ['Blakestown Dublin 15'], 0.02, 'Blakestown'],
  ['Ongar', ['Ongar Village', 'Ongar Dublin 15'], 0.04, 'Ongar'],
  ['Porterstown', ['Porterstown Dublin 15'], 0.01, 'Porterstown'],
  ['Damastown', ['Damastown Dublin 15'], 0.01, 'Damastown'],
  ['Parslickstown', ['Parslickstown Dublin 15'], 0.01, 'Parslickstown'],
  ['Kilmartin', ['Kilmartin Dublin 15'], 0.01, 'Kilmartin'],
  ['Abbotstown', ['Abbotstown Dublin 15'], 0.01, 'Abbotstown'],
  ['Diswellstown', ['Diswellstown Dublin 15'], 0.005, 'Diswellstown'],
  ['Laurel Lodge', ['Laurel Lodge Castleknock', 'Laurellodge'], 0.01, 'Laurel Lodge'],
];
hoods.forEach(([c, a, p, area]) => A(6, c, { a, p, area, s: 0 }));

// ---------- Q7 Sports clubs ----------
A(7, "St Peregrine's GAA", { a: ['St Peregrines', 'St Peregrines GAA', 'Saint Peregrines GAA', 'St Peregrine GAA', 'St Peregrines GAA Club'], p: 0.03, area: 'Blanchardstown', s: 0, f: "Needs geo-check: St Peregrine's GAA is commonly associated with Ballymun/Dublin 11. Confirm a base inside the boundary." });
A(7, 'Castleknock GAA', { a: ['Castleknock Hurling and Football Club', 'Castleknock Hurling & Football Club', 'Castleknock Hurling and Football', 'Castleknock HFC', 'Castleknock GAA Club', 'Castleknock Gaelic'], p: 0.17, area: 'Castleknock', s: 1, n: 'Castleknock GAA and Castleknock Hurling & Football Club are the same club.' });
A(7, "St Brigid's GAA", { a: ['St Brigids GAA', 'St Brigids', 'Saint Brigids GAA', 'St Brigid GAA', 'St Brigids GAA Club', 'St Brigids Gaelic'], p: 0.14, area: 'Castleknock', s: 1 });
A(7, 'Erin Go Bragh GAA', { a: ['Erin Go Bragh', 'Erin go Bragh GAA Club', 'Erin Go Brach'], p: 0.02, area: 'Blanchardstown', s: 1, f: 'Needs geo-check: confirm Erin Go Bragh GAA has a home base inside the boundary.' });
A(7, 'Westmanstown Gaels', { a: ['Westmanstown', 'Westmanstown GAA', 'Westmanstown Gaels GAA'], p: 0.05, area: 'Westmanstown', s: 1 });
A(7, 'Castleknock Celtic', { a: ['Castleknock Celtic FC', 'Castleknock FC', 'Celtic Castleknock'], p: 0.12, area: 'Castleknock', s: 1 });
A(7, 'Corduff FC', { a: ['Corduff', 'Corduff Football Club', 'Corduff F.C.', 'Corduff Soccer'], p: 0.12, area: 'Corduff', s: 0 });
A(7, 'Coolmine RFC', { a: ['Coolmine Rugby', 'Coolmine Rugby Club', 'Coolmine Rugby Football Club', 'Coolmine RFC Clonsilla'], p: 0.10, area: 'Coolmine', s: 1 });
A(7, 'Castleknock Lawn Tennis Club', { a: ['Castleknock LTC', 'Castleknock Tennis Club', 'Castleknock Tennis', 'Castleknock Lawn Tennis'], p: 0.04, area: 'Castleknock', s: 1 });
A(7, 'Verona FC', { a: ['Verona', 'Verona Football Club', 'Verona F.C.'], p: 0.01, area: 'Blanchardstown', s: 1, f: 'Needs geo-check: confirm Verona FC base.' });
A(7, "St Mochta's FC", { a: ['St Mochtas', 'St Mochtas FC', 'Saint Mochtas', 'St Mochta FC', 'St Mochtas Football Club', 'St Mochtas Soccer'], p: 0.04, area: 'Blanchardstown', s: 1 });
A(7, 'Tyrrelstown FC', { a: ['Tyrrelstown', 'Tyrellstown FC', 'Tyrrelstown Football Club'], p: 0.02, area: 'Tyrrelstown', s: 1 });

const CATEGORY_BY_Q = Object.fromEntries(QUESTIONS.map(q => [q.n, q.category]));

function buildSeedAnswers(todayKey) {
  const counters = {};
  return raw.map(r => {
    const q = QUESTIONS[r.q - 1];
    const id = `a${r.q}-${String((counters[r.q] = (counters[r.q] || 0) + 1)).padStart(2, '0')}`;
    const [lat, lng] = CENTROIDS[r.area] || CENTROIDS['Blanchardstown'];
    const srcList = SRC[q.src];
    return {
      id,
      q: r.q,
      canonical: r.canonical,
      aliases: r.a || [],         // alternative names + spelling variants
      abbreviations: [],          // dedicated abbreviations (admins can add); seed abbreviations live in aliases
      category: CATEGORY_BY_Q[r.q],
      area: r.area,
      location: `${r.area}, Dublin 15`,
      lat, lng, coordPrecision: 'area-centroid',
      source: srcList[r.s || 0],
      sources: srcList,
      verifiedAt: todayKey,
      status: 'curated',           // curated | approved | suspended
      verification: r.f ? 'flagged' : 'curated-unverified',
      flag: r.f || null,
      prior: r.p == null ? 0.01 : r.p,
      note: r.n || null,
      addedBy: 'seed:day001',
    };
  });
}

module.exports = { QUESTIONS, COVERAGE, OUT_OF_BOUNDS, TOO_BROAD, CENTROIDS, buildSeedAnswers };
