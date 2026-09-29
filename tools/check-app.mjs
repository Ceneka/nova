/**
 * Boot the REAL index.html in headless Chrome over CDP and report anything the
 * console says - errors, warnings, failed requests.
 *
 * Why this exists: every other check in this repo runs against
 * tests/integration.html, which STUBS the page chrome the app modules expect
 * (the drill list, the menu, the header). The real index.html is loaded by
 * main.js and by nothing else in the suite, so a wiring mistake there - a
 * missing element id, a module that throws on load - would sail past
 * integration.html and break the app in a way no test had noticed.
 *
 * Usage: node tools/check-app.mjs [url]
 *   Start Chrome with --remote-debugging-port=9222 first, or let this script
 *   find an already-running one.
 */

const URL_UNDER_TEST = process.argv[2] || 'http://127.0.0.1:8123/';
const PORT = process.env.CDP_PORT || 9222;

const endpoint = await (async () => {
    for (const base of [`http://127.0.0.1:${PORT}`, `http://127.0.0.1:${PORT}/json`]) {
        try {
            const res = await fetch(`${base}/json/version`);
            if (res.ok) return (await res.json()).webSocketDebuggerUrl;
        } catch { /* not listening yet */ }
    }
    throw new Error(`no Chrome on ${PORT}; start one with --remote-debugging-port=${PORT}`);
})();

// A fresh tab, so the app gets a clean localStorage the way a first visit does.
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(targets.webSocketDebuggerUrl);

let nextId = 1;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});

const problems = [];
const notes = [];

ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
    }

    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        problems.push(`uncaught: ${d.exception?.description || d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (msg.params.type === 'error') problems.push(`console.error: ${text}`);
        else if (msg.params.type === 'warning') notes.push(`console.warn: ${text}`);
    }
    if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        if (e.level === 'error') problems.push(`log(${e.source}): ${e.text} ${e.url || ''}`);
    }
});

await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
// The HTTP cache. A browser profile reused across runs will happily serve a
// STALE js/*.js, and this tool exists to catch things the test suite cannot -
// so it reading last run's modules makes it worse than useless, silently. It
// cost a confusing "undefined" while wiring the wake word up.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: URL_UNDER_TEST });

// Let the modules load, the service worker register and the first paint settle.
await new Promise(r => setTimeout(r, 4000));

const probe = await send('Runtime.evaluate', {
    expression: `(() => {
        const q = (s) => document.querySelector(s);
        return JSON.stringify({
            title: document.title,
            docWidth: document.documentElement.scrollWidth,
            winWidth: window.innerWidth,
            tabs: [...document.querySelectorAll('.tab-btn')].map(b => b.textContent.trim()),
            drillButtons: document.querySelectorAll('.btn-drill').length,
            aiView: !!q('#ai-view'),
            settingsView: !!q('#settings-view'),
            statsView: !!q('#stats-view'),
            openAiBtn: !!q('.ai-open-btn'),
            // Settings is a full screen rendered on open, so it has to be
            // opened before it has rows. A non-zero count is proof main.js ran
            // rather than merely that the markup parsed.
            settingsRows: (window.openSettings(),
                           document.querySelectorAll('#settings-body [data-row]').length),
            openBtn: q('#btn-connect')?.textContent,
            lang: document.documentElement.getAttribute('lang')
        });
    })()`,
    returnByValue: true
});

const state = JSON.parse(probe.result.value);
await send('Runtime.evaluate', { expression: `window.closeSettings()`, returnByValue: true });

// Exercise the entry point, the way a user would.
await send('Runtime.evaluate', { expression: `window.openAiView()`, returnByValue: true });
await new Promise(r => setTimeout(r, 400));
const panel = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
        visible: !document.getElementById('ai-view').hasAttribute('hidden'),
        hasComposer: !!document.querySelector('#ai-body .ai-composer input'),
        empty: (document.getElementById('ai-body').textContent || '').slice(0, 90)
    })`,
    returnByValue: true
});

const panelState = JSON.parse(panel.result.value);

// ...and type into it, still with no key and no network.
await send('Runtime.evaluate', {
    expression: `(() => {
        const i = document.querySelector('#ai-body .ai-composer input');
        i.value = 'push b, then drive f fuerte';
        window.aiSubmit();
    })()`,
    returnByValue: true
});
await new Promise(r => setTimeout(r, 400));
const draft = await send('Runtime.evaluate', {
    expression: `JSON.stringify({ steps: document.querySelectorAll('#ai-body .ai-step').length })`,
    returnByValue: true
});
const draftState = JSON.parse(draft.result.value);

// The dropdown is anchored to the sticky header, so it has to follow the page
// down. It did not once: it was a child of .container, which does not scroll,
// so `top: 58px` meant 58px from the top of the DOCUMENT and the menu opened
// most of the way above the viewport - while the hamburger that opens it stayed
// on screen, because that one IS in the header. Tapping it did nothing.
const menu = await send('Runtime.evaluate', {
    expression: `(() => {
        window.scrollTo(0, 99999);
        toggleMenu();
        return new Promise(r => setTimeout(() => {
            const m = document.getElementById('theme-menu');
            const box = m.getBoundingClientRect();
            r(JSON.stringify({
                scrolled: Math.round(scrollY),
                open: m.classList.contains('open'),
                top: Math.round(box.top),
                bottom: Math.round(box.bottom),
                left: Math.round(box.left),
                right: Math.round(box.right),
                insideViewport: box.top >= 0 && box.bottom <= innerHeight
                                    && box.left >= 0 && box.right <= innerWidth,
                inStickyHeader: m.offsetParent === document.querySelector('header'),
                headerSticky: getComputedStyle(document.querySelector('header')).position
            }));
        }, 300));
    })()`,
    returnByValue: true,
    awaitPromise: true
});
await send('Runtime.evaluate', { expression: `toggleMenu(); scrollTo(0,0)`, returnByValue: true });
const menuState = JSON.parse(menu.result.value);

console.log('--- the menu, scrolled to the bottom');
console.log('  containing block', menuState.inStickyHeader ? 'the sticky header' : 'NOT the header');
console.log('  header position  ', menuState.headerSticky);
console.log('  still on screen  ', `${menuState.top}..${menuState.bottom}`);

ws.close();

console.log('--- page');
console.log('  title        ', state.title);
console.log('  language     ', state.lang);
console.log('  tabs         ', state.tabs.join(' | '));
console.log('  drill buttons', state.drillButtons);
console.log('  width        ', `${state.docWidth} / ${state.winWidth}`);
console.log('  settings rows', state.settingsRows, '(non-zero means main.js ran)');
console.log('--- the assistant, in the real app');
console.log('  panel opens  ', panelState.visible);
console.log('  composer     ', panelState.hasComposer);
console.log('  Tier 0 steps ', draftState.steps, '(no key, no network)');

let failed = false;
if (problems.length) {
    failed = true;
    console.log('--- PROBLEMS');
    for (const p of problems) console.log('  ' + p);
} else {
    console.log('--- console: clean');
}
if (notes.length) {
    console.log('--- warnings');
    for (const n of notes) console.log('  ' + n);
}

// The structural facts that matter, as explicit checks.
const must = [
    [state.drillButtons > 0, 'the drill list rendered'],
    // The real app, with its real header. The integration suite measures the
    // Settings and Statistics screens, but those hide the drill list - and
    // therefore the header - behind `screen-hidden`, so the main screen had no
    // overflow check at all. A sideways-scrolling app is exactly what that gap
    // let through: .menu-btn hung 8px past the viewport.
    [state.docWidth <= state.winWidth + 1, 'the app does not scroll sideways'],
    [state.settingsRows > 0, 'Settings rendered, so main.js ran'],
    [state.tabs.length === 7, 'seven tabs, the IA one included'],
    [state.aiView && state.settingsView && state.statsView, 'all three full screens are present'],
    [state.openAiBtn, 'the assistant entry point is in the header'],
    [panelState.visible && panelState.hasComposer, 'the panel opens with a composer'],
    [draftState.steps === 2, 'Tier 0 built two steps with no key and no network'],
    [menuState.scrolled > 0, 'the page actually scrolled, so this is a real test'],
    [menuState.inStickyHeader, 'the menu is anchored to the sticky header'],
    [menuState.headerSticky === 'sticky', 'the header is sticky'],
    [menuState.insideViewport, 'the menu is still on screen after scrolling']
];
for (const [pass, what] of must) {
    if (!pass) { failed = true; console.log(`FAIL  ${what}`); }
}

process.exit(failed ? 1 : 0);
