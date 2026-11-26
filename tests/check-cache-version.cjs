// Prüft: Wenn sich Spieldateien geändert haben, muss die Cache-Version in sw.js
// (z. B. karibik-korsar-v57 -> v58) hochgezählt sein. Sonst bekommen Handys,
// auf denen das Spiel installiert ist, das Update nicht.
// Aufruf: node tests/check-cache-version.cjs <Vergleichs-Commit>
const { execFileSync } = require('node:child_process');

const base = process.argv[2];
if (!base || /^0+$/.test(base)) { console.log('Kein Vergleichs-Commit (z. B. neuer Branch) – Prüfung übersprungen.'); process.exit(0); }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
const show = (ref, file) => { try { return git('show', `${ref}:${file}`); } catch { return null; } };
const version = src => { const m = src && src.match(/const CACHE\s*=\s*'([^']*?)(\d+)'/); return m ? { name: m[1] + m[2], n: +m[2] } : null; };

const oldSw = show(base, 'sw.js'), newSw = show('HEAD', 'sw.js');
if (!oldSw) { console.log('sw.js gab es vorher nicht – Prüfung übersprungen.'); process.exit(0); }
const vOld = version(oldSw), vNew = version(newSw);
if (!vNew) { console.error('❌ In sw.js wurde keine Cache-Version (const CACHE=\'...vNN\') gefunden.'); process.exit(1); }

// Dateien, die der Service Worker zwischenspeichert, plus sw.js selbst
const listMatch = newSw.match(/const FILES\s*=\s*\[([^\]]*)\]/);
const cached = (listMatch ? listMatch[1].match(/'[^']*'/g) || [] : [])
  .map(s => s.slice(1, -1).replace(/^\.\//, '')).filter(Boolean);
if (!cached.includes('index.html')) cached.push('index.html');

const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
const relevant = changed.filter(f => cached.includes(f));
if (!relevant.length) { console.log('Keine Spieldateien geändert – Cache-Version muss nicht steigen.'); process.exit(0); }

console.log('Geänderte Spieldateien: ' + relevant.join(', '));
console.log(`Cache-Version vorher: ${vOld ? vOld.name : '?'}, jetzt: ${vNew.name}`);
if (vOld && vNew.n <= vOld.n) {
  console.error(`\n❌ Cache-Version wurde nicht hochgezählt. Bitte in sw.js '${vOld.name}' auf v${vOld.n + 1} ändern.`);
  process.exit(1);
}
console.log('\n✅ Cache-Version wurde hochgezählt.');
