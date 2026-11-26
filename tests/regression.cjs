// Regressionstests: prüfen, dass früher behobene Fehler nicht zurückkommen.
// Aufruf: node tests/regression.cjs
// Wie beim Rauchtest wird nur für den Test ein Zugang ins Spielskript eingefügt;
// die Datei im Repo bleibt unverändert.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const HOOK = 'window.__ev=function(c){return eval(c)};';
function withHook(html) {
  const end = '\n})();\n</script>';
  const i = html.lastIndexOf(end);
  if (i < 0) throw new Error('Ende des Spielskripts nicht gefunden – Test muss angepasst werden');
  return html.slice(0, i) + '\n' + HOOK + html.slice(i);
}

(async () => {
withHook(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  if (path.basename(f) === 'index.html') { res.end(withHook(fs.readFileSync(f, 'utf8'))); return; }
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push('Seitenfehler: ' + (e.stack || e.message)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|fonts\.(googleapis|gstatic)/.test(t)) return;
  jsErrors.push('Konsole: ' + t);
});
const ev = c => page.evaluate(c => window.__ev(c), c);
const wait = ms => page.waitForTimeout(ms);
// Kampagnen-Zwischensequenzen und Schicksalsfenster durchklicken (immer erste Wahl)
const skipCut = () => ev(`(()=>{let n=0;while(CUT&&n++<30){const p=CUT.pages[CUT.i];if(p.o)cutNext(p.o[0].fn());else cutNext()}if(fateOpen)fateClose();return S.story?S.story.ch:null})()`);

async function newGame(nat) {
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForSelector('#btnNew', { state: 'visible' });
  await wait(800);
  await page.click('#btnNew');
  await page.waitForSelector('#natsel:not([hidden])');
  await page.click(`#natlist [data-nat="${nat}"]`);
  await page.waitForFunction('window.__ev && __ev("mode")==="play"', null, { timeout: 30000, polling: 250 });
  await wait(1200);
  await skipCut();
}

const results = [];
async function check(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try { await fn(); console.log('ok'); results.push([name, null]); }
  catch (e) { console.log('FEHLER'); results.push([name, e.message || String(e)]); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

await newGame('eng');

await check('Handel: kein Gewinn durch Kaufen und sofort Zurückverkaufen (alle Häfen, alle Waren)', async () => {
  // Mit allen Kauf-Boni (Niederlande, hoher Titel, Händler-Herkunft) ist die Lücke am kleinsten.
  const bad = await ev(`(()=>{const out=[],sv=JSON.stringify(S.dm||{}),keep={nat:S.nat,ttl:S.ttl,bio:S.bio,gold:S.gold,goods:JSON.stringify(S.goods)};
    S.nat='nl';S.ttl=6;S.bio=0;
    for(const p of PORTS){curPort=p;for(const g of GOODS){
      S.dm=JSON.parse(sv);let gold=0;for(let i=0;i<20;i++){gold-=Math.round(price(p,g,1)*BUYM());dmAdd(p,g,1,true)}gold+=20*Math.round(price(p,g,-1)*SELLM());if(gold>0)out.push('kaufen+verkaufen '+p.n+' '+g+' +'+gold);
      S.dm=JSON.parse(sv);gold=20*Math.round(price(p,g,-1)*SELLM());dmAdd(p,g,20,false);gold-=20*Math.round(price(p,g,1)*BUYM());if(gold>0)out.push('verkaufen+zurückkaufen '+p.n+' '+g+' +'+gold);
    }}
    curPort=null;S.dm=JSON.parse(sv);S.nat=keep.nat;S.ttl=keep.ttl;S.bio=keep.bio;S.gold=keep.gold;S.goods=JSON.parse(keep.goods);return out})()`);
  expect(bad.length === 0, 'Gewinn möglich: ' + bad.slice(0, 5).join(', '));
});

await check('Festung: "Angriff befehlen" hat Vorrang vor einem nahen Hafen', async () => {
  await ev(`(()=>{const p=PORTS.find(q=>!portHostile(q)&&reach(q));S.story={ch:10,fx:p.x,fy:p.y+40,used:[],side:'frei',cons:[]};P.x=p.x;P.y=p.y+30;P.v=0;P.sail=0})()`);
  await wait(1200);
  const t = await ev(`$('ctx').hidden?'(versteckt)':$('ctx').textContent`);
  expect(t === 'Angriff befehlen', 'Knopf zeigt: ' + t);
  const marked = await ev(`(()=>{S.story.ch=11;return typeof drawMarkers==='function'})()`);
  expect(marked, 'drawMarkers fehlt');
});

await check('Kampagne: Kapitel 9 geht nach Neuladen weiter (Akt III, dann Kapitel 10)', async () => {
  await ev(`(()=>{S.story={ch:9,fx:P.x+3000,fy:P.y,used:[],side:'frei',cons:[]};save()})()`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#btnContinue:not([hidden])', { timeout: 15000 });
  await wait(600);
  await page.click('#btnContinue');
  await page.waitForFunction('__ev("mode")==="play"', null, { timeout: 30000, polling: 250 });
  await page.waitForFunction('__ev("!!CUT")', null, { timeout: 8000, polling: 250 }).catch(() => {});
  const h = await ev('CUT&&CUT.pages[0].h');
  expect(h === 'Akt III: Die Schwarze Flagge', 'Akt III startet nicht, Zwischensequenz: ' + h);
  const ch = await skipCut();
  expect(ch === 10, 'Kapitel danach: ' + ch);
});

await check('Kampagne: Kapitel 12 startet das Finale, ein gewähltes Ende wird nicht doppelt belohnt', async () => {
  await ev(`(()=>{S.story.ch=12;delete S.story.end;save()})()`);
  await page.waitForFunction('__ev("!!CUT")', null, { timeout: 8000, polling: 250 }).catch(() => {});
  const h = await ev('CUT&&CUT.pages[0].h');
  expect(h === 'Der Sieg', 'Finale startet nicht, Zwischensequenz: ' + h);
  const ch = await skipCut();
  expect(ch === 13, 'Kapitel nach Finale: ' + ch);
  await ev(`(()=>{S.story.ch=12;save()})()`);
  await wait(2500);
  const st = await ev(`[S.story.ch,!!CUT]`);
  expect(st[0] === 13 && !st[1], 'Mit gewähltem Ende: Kapitel ' + st[0] + ', Zwischensequenz offen: ' + st[1]);
});

await newGame('pir');

await check('Freibeuter: Angriff auf Story-Gegner ist kein Verbrechen', async () => {
  const r = await ev(`(()=>{const e=mkShip('w','pir',P.x+200,P.y,0,{story:3,nm:'Die Krähe',fleet:1,alert:3});enemies.push(e);const ok=typeof legalShip==='function'?legalShip(e):legalTarget(e.nat);hitEnemy(e,{x:e.x,y:e.y,k:'ball'});return [ok,JSON.stringify(S.wars||{})]})()`);
  expect(r[0] === true, 'Story-Gegner gilt nicht als erlaubtes Ziel');
  expect(r[1] === '{}', 'Krieg erklärt: ' + r[1]);
});

await check('3D-Ansicht: einschalten und Seeschlacht ohne Fehler', async () => {
  await ev(`setViewMode('3')`);
  await page.waitForFunction('__ev("V3D")', null, { timeout: 20000, polling: 250 });
  const ok = await ev(`(()=>{const e=enemies.find(x=>x.sink===0&&!x.dead&&!x.story);if(!e)return false;startBattle([e]);return true})()`);
  expect(ok, 'Kein Gegnerschiff gefunden');
  await page.waitForFunction('__ev("mode")==="battle"', null, { timeout: 15000, polling: 250 });
  for (let i = 0; i < 6; i++) { await page.keyboard.press(i % 2 ? 'e' : 'q'); await wait(500); }
  await ev(`setViewMode('2')`);
});

await check('Fehlerprotokoll des Spiels ist leer', async () => {
  const log = await ev(`JSON.parse(localStorage.getItem('kk-err')||'[]')`);
  expect(log.length === 0, log.slice(0, 3).join(' | '));
});

await browser.close();
server.close();

const failed = results.filter(r => r[1]);
if (jsErrors.length) failed.push(['JavaScript-Fehler', jsErrors.slice(0, 5).join('\n    ')]);
if (failed.length) {
  console.error('\n❌ Regressionstest fehlgeschlagen:\n' + failed.map(([n, m]) => `  • ${n}: ${m}`).join('\n'));
  process.exit(1);
}
console.log(`\n✅ Alle ${results.length} Regressionstests bestanden.`);
})();
