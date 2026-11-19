/* BLANION WEIGH-IN — objects, question pairs, daily selection and scoring. UMD: window.WeighData / require().
 * All masses are round, widely quoted averages (kg) and are shown to players as approximate ("≈"). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WeighData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ROUNDS = 5;

  // kg: mass in kilograms · a: how it reads in the question ("an elephant") · pl: plural unit ("eggs") · desc: what we mean exactly
  const BIG = {
    elephant:  { kg: 6000,    emoji: '🐘', a: 'an elephant',            desc: 'adult male African bush elephant', fact: 'Adult African bush elephant bulls typically weigh 4–6 tonnes; the heaviest on record was about 10 tonnes.' },
    whale:     { kg: 150000,  emoji: '🐋', a: 'a blue whale',           desc: 'large adult blue whale', fact: 'Blue whales can reach about 150 tonnes, the heaviest animal known to have ever lived.' },
    giraffe:   { kg: 1200,    emoji: '🦒', a: 'a giraffe',              desc: 'adult male giraffe', fact: 'A male giraffe averages roughly 1,200 kg.' },
    hippo:     { kg: 1500,    emoji: '🦛', a: 'a hippo',                desc: 'adult male hippopotamus', fact: 'Male hippos average roughly 1,500 kg.' },
    polarbear: { kg: 450,      emoji: '🐻‍❄️', a: 'a polar bear',         desc: 'adult male polar bear', fact: 'Polar bears are the largest living land carnivores; males are typically 350–700 kg.' },
    trex:      { kg: 8000,    emoji: '🦖', a: 'a T. rex',               desc: 'full-grown Tyrannosaurus rex', fact: 'Scientific estimates for a full-grown T. rex range from about 6 to 9 tonnes.' },
    gorilla:   { kg: 170,     emoji: '🦍', a: 'a silverback gorilla',   desc: 'adult male gorilla', fact: 'Adult male gorillas weigh around 140–220 kg.' },
    cow:       { kg: 650,     emoji: '🐄', a: 'a dairy cow',            desc: 'adult dairy cow', fact: 'A dairy cow weighs roughly 600–700 kg.' },
    horse:     { kg: 500,     emoji: '🐎', a: 'a horse',                desc: 'typical riding horse', fact: 'A typical riding horse weighs about 500 kg.' },
    lion:      { kg: 190,     emoji: '🦁', a: 'a male lion',            desc: 'adult male lion', fact: 'Adult male lions average around 190 kg.' },
    panda:     { kg: 100,     emoji: '🐼', a: 'a giant panda',          desc: 'adult giant panda', fact: 'Adult giant pandas weigh about 70–125 kg.' },
    human:     { kg: 70,      emoji: '🧍', a: 'an adult human',         desc: 'adult person (round average)', fact: 'We used 70 kg as a round figure for an adult; real people vary a lot.' },
    baby:      { kg: 3.5,     emoji: '👶', a: 'a newborn baby',         desc: 'average newborn', fact: 'The average newborn weighs about 3.5 kg.' },
    sumo:      { kg: 150,     emoji: '🤼', a: 'a sumo wrestler',        desc: 'professional sumo wrestler', fact: 'Professional sumo wrestlers average roughly 150 kg.' },
    car:       { kg: 1400,    emoji: '🚗', a: 'a family car',           desc: 'typical family car', fact: 'A typical family car weighs about 1,400 kg.' },
    jumbo:     { kg: 180000,  emoji: '✈️', a: 'a Boeing 747',           desc: 'Boeing 747-400, operating empty', fact: 'A 747-400 weighs about 180 tonnes with crew and equipment but no passengers, cargo or fuel.' },
    liberty:   { kg: 204000,  emoji: '🗽', a: 'the Statue of Liberty',  desc: 'copper skin plus frame', fact: 'The Statue of Liberty weighs about 204 tonnes (225 US tons): copper skin on an iron and steel frame.' },
    container: { kg: 2300,    emoji: '📦', a: 'an empty shipping container', desc: 'empty 20-foot container', fact: 'An empty 20-foot shipping container weighs about 2.3 tonnes.' },
  };
  const SMALL = {
    egg:      { kg: 0.058,    emoji: '🥚', pl: 'eggs',              desc: 'medium hen’s egg' },
    golf:     { kg: 0.0459,   emoji: '⛳', pl: 'golf balls',        desc: 'regulation golf ball (max 45.9 g)' },
    clip:     { kg: 0.001,    emoji: '📎', pl: 'paperclips',        desc: 'standard paperclip' },
    euro:     { kg: 0.0075,   emoji: '🪙', pl: '€1 coins',          desc: 'euro €1 coin (7.5 g)' },
    sugar:    { kg: 0.004,    emoji: '🥄', pl: 'teaspoons of sugar', desc: 'level teaspoon of sugar' },
    banana:   { kg: 0.118,    emoji: '🍌', pl: 'bananas',           desc: 'medium banana, peeled' },
    apple:    { kg: 0.182,    emoji: '🍎', pl: 'apples',            desc: 'medium apple' },
    football: { kg: 0.43,     emoji: '⚽', pl: 'footballs',         desc: 'size 5 football' },
    rugby:    { kg: 0.44,     emoji: '🏉', pl: 'rugby balls',       desc: 'match rugby ball' },
    tennis:   { kg: 0.0575,   emoji: '🎾', pl: 'tennis balls',      desc: 'tennis ball' },
    pint:     { kg: 0.568,    emoji: '🍺', pl: 'pints of water',    desc: 'pint of water (568 ml)' },
    bowling:  { kg: 7.26,     emoji: '🎳', pl: 'bowling balls',     desc: 'heaviest regulation bowling ball (16 lb)' },
    cat:      { kg: 4.5,      emoji: '🐱', pl: 'cats',              desc: 'average house cat' },
    loaf:     { kg: 0.8,      emoji: '🍞', pl: 'loaves of bread',   desc: '800 g sliced pan' },
    phone:    { kg: 0.17,     emoji: '📱', pl: 'smartphones',       desc: 'typical smartphone' },
    a4:       { kg: 0.005,    emoji: '📄', pl: 'sheets of A4 paper', desc: 'sheet of 80 gsm A4' },
    aa:       { kg: 0.023,    emoji: '🔋', pl: 'AA batteries',      desc: 'alkaline AA battery' },
    rice:     { kg: 0.000025, emoji: '🍚', pl: 'grains of rice',    desc: 'grain of long-grain rice (~25 mg)' },
    bee:      { kg: 0.0001,   emoji: '🐝', pl: 'honey bees',        desc: 'worker honey bee (~100 mg)' },
    lego:     { kg: 0.0025,   emoji: '🧱', pl: 'Lego bricks',       desc: 'standard 2×4 Lego brick' },
    car:      { kg: 1400,     emoji: '🚗', pl: 'family cars',       desc: 'typical family car' },
    human:    { kg: 70,       emoji: '🧍', pl: 'adults',            desc: 'adult person (round average)' },
    elephant: { kg: 6000,     emoji: '🐘', pl: 'elephants',         desc: 'adult male African bush elephant' },
    giraffe:  { kg: 1200,     emoji: '🦒', pl: 'giraffes',          desc: 'adult male giraffe' },
    sumo:     { kg: 150,      emoji: '🤼', pl: 'sumo wrestlers',    desc: 'professional sumo wrestler' },
  };

  // [big, small] — every pair is a sensible, surprising comparison
  const PAIRS = [
    ['elephant', 'egg'], ['elephant', 'aa'], ['elephant', 'rice'], ['whale', 'car'], ['whale', 'human'], ['liberty', 'giraffe'] ,
    ['jumbo', 'sumo'], ['jumbo', 'elephant'], ['car', 'bowling'], ['hippo', 'pint'], ['hippo', 'sugar'], ['giraffe', 'football'],
    ['giraffe', 'rugby'], ['polarbear', 'euro'], ['polarbear', 'tennis'], ['trex', 'human'], ['container', 'cat'], ['gorilla', 'apple'],
    ['cow', 'loaf'], ['human', 'golf'], ['baby', 'a4'], ['lion', 'clip'], ['sumo', 'phone'], ['panda', 'lego'],
    ['horse', 'banana'], ['human', 'bee'], ['car', 'euro'], ['liberty', 'elephant'], ['cow', 'egg'], ['gorilla', 'lego'],
  ].map(([b, s]) => ({ id: b + '/' + s, big: b, small: s }));

  const truth = p => BIG[p.big].kg / SMALL[p.small].kg;

  function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /** 5 rounds: distinct big objects and distinct small units, at least one "small number" answer and one huge one. */
  function pairsFor(key) {
    const rand = mulberry32(hashStr('blanion-weigh:' + key));
    let pick;
    for (let attempt = 0; attempt < 500; attempt++) {
      const pool = PAIRS.slice(), chosen = [];
      while (chosen.length < ROUNDS) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      const bigs = new Set(chosen.map(p => p.big)), smalls = new Set(chosen.map(p => p.small));
      const t = chosen.map(truth);
      if (bigs.size === ROUNDS && smalls.size === ROUNDS && t.some(x => x <= 1500) && t.some(x => x >= 50000)) { pick = chosen; break; }
      pick = chosen;
    }
    return pick;
  }

  /** 100 for an exact answer, falling linearly with the number of orders of magnitude you are off: 10x out (either way) = 0. */
  function score(guess, actual) {
    if (!(guess > 0) || !isFinite(guess)) return 0;
    return Math.round(100 * Math.max(0, 1 - Math.abs(Math.log10(guess / actual))));
  }

  /** "2.3x too high" / "about 12% too low" / "spot on" */
  function describeError(guess, actual) {
    const r = guess / actual;
    if (Math.abs(r - 1) < 0.02) return 'Spot on!';
    if (r > 1) return r >= 2 ? (r >= 10 ? Math.round(r) : r.toFixed(1)) + '× too high' : Math.round((r - 1) * 100) + '% too high';
    const inv = 1 / r;
    return inv >= 2 ? (inv >= 10 ? Math.round(inv) : inv.toFixed(1)) + '× too low' : Math.round((1 - r) * 100) + '% too low';
  }

  function fmtMass(kg) {
    if (kg >= 1000) return (kg / 1000).toLocaleString('en-IE', { maximumFractionDigits: 1 }) + ' tonnes';
    if (kg >= 1) return kg.toLocaleString('en-IE', { maximumFractionDigits: 2 }) + ' kg';
    const g = kg * 1000;
    return g >= 1 ? g.toLocaleString('en-IE', { maximumFractionDigits: 1 }) + ' g' : (g * 1000).toLocaleString('en-IE', { maximumFractionDigits: 0 }) + ' mg';
  }
  function fmtCount(n) {
    if (n >= 100) return Math.round(n).toLocaleString('en-IE');
    return n.toLocaleString('en-IE', { maximumFractionDigits: 1 });
  }

  return { ROUNDS, BIG, SMALL, PAIRS, truth, pairsFor, score, describeError, fmtMass, fmtCount, mulberry32, hashStr };
});
