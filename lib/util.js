'use strict';
const crypto = require('crypto');

const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const pad = n => String(n).padStart(2, '0');

/** YYYY-MM-DD in Europe/Dublin */
const dateKey = ms => fmtDate.format(new Date(ms));
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const diffDays = (a, b) => { const p = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 86400000); };
/** epoch ms of 00:00 Dublin time at the start of date `key` */
function dublinMidnight(key) {
  const [y, m, d] = key.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (const off of [0, 3600000]) {
    if (fmtFull.format(new Date(base - off)).startsWith(`${pad(d)}/${pad(m)}/${y}, 00:00`)) return base - off;
  }
  return base;
}

/** Normalise free text so spelling/punctuation/diacritic variants collapse together. */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bst\.\s*/g, 'st ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const uid = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { dateKey, addDays, diffDays, dublinMidnight, norm, levenshtein, uid, sha256 };
