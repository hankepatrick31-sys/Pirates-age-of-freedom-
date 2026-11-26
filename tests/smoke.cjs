// Rauchtest: Spiel laden, neue Fahrt starten, Seeschlacht betreten.
// Schlägt fehl, sobald ein JavaScript-Fehler auftritt.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

(async () => {
// Das Spiel steckt komplett in einer Funktion (function(){ ... })().
// Nur für den Test wird am Ende ein kleiner Zugang eingefügt, damit der Test
// den Spielzustand lesen und eine Seeschlacht starten kann. Die Datei im Repo bleibt unverändert.
const HOOK = "window.__kkTest={mode:()=>mode,enemies:()=>enemies,startBattle:l=>startBattle(l)};";
function withTestHook(html) {
  const end = '\n})();\n</script>';
  const i = html.lastIndexOf(end);
  if (i < 0) throw new Error('Ende des Spielskripts nicht gefunden – Test muss angepasst werden');
  return html.slice(0, i) + '\n' + HOOK + html.slice(i);
}
withTestHook(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')); // früh scheitern

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  if (path.basename(f) === 'index.html') { res.end(withTestHook(fs.readFileSync(f, 'utf8'))); return; }
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
page.on('pageerror', e => errors.push('Seitenfehler: ' + (e.stack || e.message)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Externe Schriften o.ä. dürfen fehlen (kein Internet nötig für den Test)
  if (/Failed to load resource|fonts\.(googleapis|gstatic)/.test(t)) return;
  errors.push('Konsole: ' + t);
});

const step = async (name, fn) => {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log('ok');
};

let failed = null;
try {
  await step('Spiel laden', async () => {
    await page.goto(URL_, { waitUntil: 'load' });
    await page.waitForSelector('#btnNew', { state: 'visible' });
    await page.waitForTimeout(1500);
  });

  await step('Neue Fahrt starten (England)', async () => {
    await page.click('#btnNew');
    await page.waitForSelector('#natsel:not([hidden])');
    await page.click('#natlist [data-nat="eng"]');
    await page.waitForFunction('window.__kkTest && !["title", "dead"].includes(__kkTest.mode())', null, { timeout: 30000, polling: 250 });
    console.log('(Spielmodus: ' + await page.evaluate(() => __kkTest.mode()) + ') ');
    await page.waitForTimeout(3000); // ein paar Sekunden segeln
  });

  await step('Seeschlacht betreten', async () => {
    const ok = await page.evaluate(() => {
      const e = __kkTest.enemies().find(x => x.sink === 0 && !x.dead);
      if (!e) return false;
      __kkTest.startBattle([e]);
      return true;
    });
    if (!ok) throw new Error('Kein Gegnerschiff gefunden');
    await page.waitForFunction('__kkTest.mode() === "battle"', null, { timeout: 15000, polling: 250 });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i % 2 ? 'e' : 'q'); // Breitseiten feuern
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(2000);
  });

  await step('Fehlerprotokoll des Spiels prüfen', async () => {
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('kk-err') || '[]'));
    for (const l of log) errors.push('Spiel-Fehlerprotokoll: ' + l);
  });
} catch (e) {
  failed = e;
  console.log('FEHLER');
  // Hilfe bei der Fehlersuche: Spielzustand und sichtbare Fenster ausgeben
  const diag = await page.evaluate(() => ({
    mode: window.__kkTest ? __kkTest.mode() : '(Testzugang fehlt)',
    sichtbar: [...document.querySelectorAll('body > *[id]')].filter(el => !el.hidden && getComputedStyle(el).display !== 'none').map(el => el.id).join(', '),
  })).catch(err => ({ fehler: String(err) }));
  console.log('  Zustand:', JSON.stringify(diag));
}

await page.screenshot({ path: path.join(ROOT, 'tests', 'smoke-letzter-stand.png') }).catch(() => {});
await browser.close();
server.close();

if (failed) errors.unshift('Testschritt fehlgeschlagen: ' + (failed.stack || failed.message));
if (errors.length) {
  console.error('\n❌ Rauchtest fehlgeschlagen:\n' + errors.map(e => '  • ' + e).join('\n'));
  process.exit(1);
}
console.log('\n✅ Rauchtest bestanden: keine JavaScript-Fehler.');
})();
