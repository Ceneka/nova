/**
 * Regenerate the README screenshots.
 *
 *   node tools/screenshots.mjs            # writes images/*.png
 *
 * ## Why this exists rather than a shell script
 *
 * **A screenshot taken while a CSS transition is running is the whole problem
 * this file is about.** `.modal-overlay` is `opacity: 0` with
 * `transition: opacity 0.25s` and `.open { opacity: 1 }`. Capture in that window
 * and the modal - AND its `backdrop-filter: blur(6px)` backdrop - land at
 * partial opacity, blended with the page underneath. The result is not a
 * screenshot that looks wrong, it is one that looks *almost* right: washed out,
 * slightly smeared, the text legible. The committed `editor.png` measured a
 * mean brightness of 33.2 against 17.0 for the same screen settled, which is
 * what "ghostly" turned out to mean.
 *
 * So every capture here waits for the page to be genuinely still, by awaiting
 * the animations the browser says are running, and then waiting again anyway.
 *
 * ## The other trap
 *
 * The service worker precaches the whole shell and answers `index.html` and
 * `css/style.css` FROM CACHE, revalidating only in the background. A profile
 * left over from a previous run therefore photographs the last build, one load
 * behind and silently. `Network.setCacheDisabled` does not help - the worker
 * still answers. The shell is thrown away before anything is measured, and
 * `sw.js` VERSION has to be bumped by hand whenever a precached file changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8123';
const PORT = process.env.CDP_PORT || 9222;

// The shapes the README already uses, so its table does not change.
const PHONE = { width: 600, height: 1280 };
const EDITOR = { width: 600, height: 1560 };

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(targets.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
    }
});
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
});

const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

/** Load the app with an EMPTY shell, or photograph the last build. */
async function freshLoad(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { ...width ? { width, height } : {}, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: `${BASE}/?shot=${Date.now()}` });
    await evaluate(`(async () => {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
        for (const k of await caches.keys()) if (k.startsWith('nova-shell-')) await caches.delete(k);
    })()`);
    await send('Page.reload', { ignoreCache: true });
    await new Promise(r => setTimeout(r, 1500));
}

/**
 * Wait until the page is genuinely still. `getAnimations()` is the browser's
 * own answer to "is anything moving", which beats a guessed sleep, and the
 * extra margin covers the compositor settling after the last frame.
 */
const settle = () => evaluate(`(async () => {
    await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
})()`);

const capture = async (name, file) => {
    await settle();
    await new Promise(r => setTimeout(r, 250));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(ROOT, 'images', file);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`  ${file.padEnd(14)} ${fs.statSync(out).size} bytes`);
};

const SHOTS = [
    {
        name: 'the drill list',
        file: 'main.png',
        size: PHONE,
        async run() {
            await evaluate('scrollTo(0,0); document.getElementById("theme-menu").classList.remove("open")');
        }
    },
    {
        name: 'the drill editor',
        file: 'editor.png',
        size: EDITOR,
        async run() {
            await evaluate('window.openEditor("push(b)")');
        }
    },
    {
        name: 'the countdown',
        file: 'countdown.png',
        size: PHONE,
        async run() {
            // The countdown needs no robot: startSequence() runs the UI and the
            // packet only goes out when the user connects one.
            await evaluate('window.closeEditor(); window.startDrillSequence("push(b)")');
        }
    }
];

for (const shot of SHOTS) {
    console.log(shot.name);
    await freshLoad(shot.size.width, shot.size.height);
    await shot.run();
    await capture(shot.name, shot.file);
    await evaluate('stopRun(); closeEditor()').catch(() => {});
}

ws.close();
console.log('\ndone. Remember: bump VERSION in sw.js when a precached file changes.');
