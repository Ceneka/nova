/**
 * Service worker for Nova Drill | Tenisdemesa.ar.
 *
 * The whole point of this app is that it runs at a table, where the wifi is
 * whatever the hall happens to have. So the entire app shell is precached on
 * first visit and served from cache forever after; after that the app opens
 * instantly and works with no connection at all.
 *
 * This is a plain script at the site root, like every other file here. There is
 * no build step, and this file is not generated - bump VERSION by hand.
 *
 * Two things this deliberately does NOT do:
 *
 *   - Cache the share-code API. `js/cloud.js` talks to a PocketBase instance
 *     on another origin. That is somebody else's server, the responses are not
 *     ours to store, and a cached "code not found" would be worse than no
 *     answer. Every cross-origin request is left completely alone.
 *   - Runtime-cache on a miss and call it a day. A cached 404 that then serves
 *     itself forever is a bug factory, so only `res.ok` basic responses are
 *     stored, and the precache below is atomic - one bad entry means no
 *     install at all, rather than an app that half-works offline.
 */

const VERSION = 'v6';
const CACHE = `nova-shell-${VERSION}`;

/** The precached address of the app itself. Serve as the navigation fallback. */
const SHELL = './';

/**
 * Every file the browser needs to boot the app with no network.
 *
 * The js/ list is the whole module graph, and it is the part that goes stale:
 * add a module in js/ and forget it here, and the app installs fine, opens
 * fine, and then fails the first time you are out of signal. The integration
 * checks walk the real import graph and fail if anything reachable is missing
 * from this list, so treat a new module as incomplete until it is in here.
 */
const PRECACHE = [
    SHELL,
    'index.html',
    'manifest.webmanifest',
    'converter.html',
    'css/style.css',

    // Self-hosted so the app still looks right with no signal. A webfont
    // fetched from a CDN is a webfont that falls back to the system stack at
    // exactly the moment this app matters most.
    'fonts/dm-sans-latin.woff2',
    'fonts/dm-sans-latin-ext.woff2',
    'fonts/jbm-latin.woff2',
    'fonts/jbm-latin-ext.woff2',

    'js/aiAgent.js',
    'js/aiClient.js',
    'js/aiCompile.js',
    'js/aiConfig.js',
    'js/aiMatch.js',
    'js/aiStore.js',
    'js/aiTerms.js',
    'js/aiVoice.js',
    'js/aiUi.js',
    'js/ball.js',
    'js/bluetooth.js',
    'js/cloud.js',
    'js/constants.js',
    'js/editor.js',
    'js/i18n.js',
    'js/locales/en.js',
    'js/locales/es.js',
    'js/main.js',
    'js/presets.js',
    'js/presetUi.js',
    'js/pwa.js',
    'js/runner.js',
    'js/settingsUi.js',
    'js/state.js',
    'js/stats.js',
    'js/statsUi.js',
    'js/ui.js',
    'js/utils.js',

    'icons/icon.svg',
    'icons/favicon-32.png',
    'icons/apple-touch-icon.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // `cache: 'reload'` bypasses the HTTP cache, so a stale index.html
        // sitting in the disk cache cannot be baked into a brand new shell.
        await cache.addAll(PRECACHE.map(path => new Request(path, { cache: 'reload' })));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter(k => k.startsWith('nova-shell-') && k !== CACHE)
                .map(k => caches.delete(k))
        );
        // Take over pages that are already open. Combined with skipWaiting()
        // this means a deploy reaches a phone on its next launch rather than
        // sitting in the "waiting" state until every tab is closed, which on a
        // phone that means never.
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    // Anything on another origin is the share-code API. No respondWith, no
    // cache, no opinion - the browser handles it exactly as it would without
    // a service worker.
    if (new URL(request.url).origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigate(request));
        return;
    }
    event.respondWith(handleAsset(request));
});

/**
 * Navigations always resolve to the app shell. Every URL in scope is the same
 * single page - the drill list, the editor and Settings are all one document -
 * so `/` and `/index.html` must behave identically, and both keys are
 * precached above to make sure neither misses.
 */
async function handleNavigate(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(SHELL) || await cache.match('index.html');

    if (cached) {
        // Refresh in the background rather than blocking the launch on the
        // network. Freshness is the cache name's job: a new deploy ships a new
        // VERSION, which installs a whole new shell, so serving the current
        // one and quietly fetching the next is not how staleness happens.
        revalidate(cache, request);
        return cached;
    }

    try {
        return await fetch(request);
    } catch {
        return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

/** Modules, CSS and icons: cache first, network only to fill a hole. */
async function handleAsset(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) {
        revalidate(cache, request);
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Not in the shell and not reachable. Say so plainly instead of
        // returning a cached 404 body under a 200.
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}

function revalidate(cache, request) {
    fetch(request)
        .then(response => {
            if (response && response.ok && response.type === 'basic') {
                return cache.put(request, response);
            }
        })
        .catch(() => { /* offline: the cached copy is the answer */ });
}
