/**
 * Does the service worker serve the app shell for the sign-in callback?
 *
 * Runs against a real browser and a real worker: registers sw.js, waits for it
 * to take control, then navigates to callback.html?code=...&state=... and
 * reports what actually rendered.
 *
 * Usage: node sw-probe.mjs [origin]
 *   origin defaults to http://127.0.0.1:8124
 */
const CDP = 'http://127.0.0.1:9222';
const ORIGIN = process.argv[2] || 'http://127.0.0.1:8124';

const rpc = (ws) => {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  return (method, params = {}) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP}/json/list`)).json();
let page = targets.find((t) => t.type === 'page');
if (!page) page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
const send = rpc(ws);
await send('Page.enable');
await send('Runtime.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value;
};
const go = async (url) => { await send('Page.navigate', { url }); await sleep(3000); };

// load the app, install the worker, then reload so it is in control
await go(`${ORIGIN}/`);
const registered = await evaluate(
  `navigator.serviceWorker.register('/sw.js').then(r => !!r.active || !!r.installing || !!r.waiting).catch(e => String(e))`
);
console.log('worker registered:', registered);
await sleep(2500);
await go(`${ORIGIN}/`);
const controlled = await evaluate(`!!navigator.serviceWorker.controller`);
console.log('page controlled by the worker:', controlled);

const report = async (label, url) => {
  await go(url);
  const info = await evaluate(`(() => ({
    path: location.pathname + location.search,
    title: document.title,
    heading: (document.querySelector('h1')?.textContent || '').trim(),
    bodyStart: (document.body?.innerText || '').trim().slice(0, 90).replace(/\\s+/g, ' '),
    drillButtons: document.querySelectorAll('.btn-drill').length,
    isCallbackPage: !!document.querySelector('#msg')
  }))()`);
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(info, null, 2));
  return info;
};

const cb = await report('callback.html?code=PROBE&state=PROBE', `${ORIGIN}/callback.html?code=PROBE&state=PROBE`);
const conv = await report('converter.html', `${ORIGIN}/converter.html`);
const shell = await report('the app itself (should be the shell)', `${ORIGIN}/`);

const verdict = [];
verdict.push([cb.isCallbackPage && !cb.drillButtons, 'callback.html renders the handoff page, not the drill list']);
verdict.push([conv.drillButtons === 0, 'converter.html renders the converter, not the drill list']);
verdict.push([shell.drillButtons > 0, 'the app itself still gets the shell']);

console.log('\n=== VERDICT ===');
let bad = 0;
for (const [ok, name] of verdict) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; }
ws.close();
process.exit(bad ? 1 : 0);
