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
 *   - Cache the Nova API. `js/cloud.js` and `js/account.js` talk to
 *     `tenisdemesa.ar` on another origin. Those responses are not ours to
 *     store, a cached "code not found" is worse than no answer, and a cached
 *     sign-in response is worse still. Every cross-origin request is left
 *     completely alone.
 *   - Runtime-cache on a miss and call it a day. A cached 404 that then serves
 *     itself forever is a bug factory, so only `res.ok` basic responses are
 *     stored, and the precache below is atomic - one bad entry means no
 *     install at all, rather than an app that half-works offline.
 */

const VERSION = 'v15';
const CACHE = `nova-shell-${VERSION}`;

/** The precached address of the app itself. Serve as the navigation fallback. */
const SHELL = './';

/**
 * Documents that are pages in their own right, not routes into the app.
 *
 * Every OTHER navigation is answered with the app shell, because the app is a
 * single document: `/`, `/index.html` and `/settings` are the same page and
 * must behave identically. These two are different documents that merely live
 * in the same directory, and handing them the shell means the user ends up in
 * the drill list.
 *
 * `callback.html` was broken exactly this way. Signing in completed, the
 * browser arrived here carrying a one-time code, and the worker answered with
 * `index.html` - so the code was never redeemed and signing in silently did
 * nothing. It read like a server fault because the server had done everything
 * right, and the failure was that the user landed on a perfectly working app.
 *
 * `callback` is here because Cloudflare Pages strips the `.html` extension and
 * 308s to it, so the worker sees that URL too.
 *
 * Matched on the LAST SEGMENT rather than the whole path, because the app is
 * also developed and tested under a `/v2/` prefix and is meant to be
 * downloadable and hostable anywhere. Matching `/callback.html` exactly meant
 * any prefix at all - a subdirectory, a test harness - served the shell again.
 * This is the same instinct as the manifest, where every path is relative.
 */
const STANDALONE = new Set(['converter.html', 'callback.html', 'callback']);

/** The final path segment, or '' for the root. */
function lastSegment(pathname) {
    const parts = String(pathname || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

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
    'callback.html',
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
    // The account and backup modules. `callback.html` is precached too, even
    // though a sign-in needs the network: it is a static handoff page like
    // converter.html, and the worker navigation handler sends it to the network
    // first. Being in the list only matters with no signal, where rendering the
    // handoff page and failing is better than a browser error page.
    'js/account.js',
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
    'js/sync.js',
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

    // A real document rather than a route into the app. Network first, because
    // a sign-in is a one-shot handoff and a cached copy of it is a stale one -
    // falling back to the cache is only here so the page renders offline
    // instead of showing the browser's error page.
    if (STANDALONE.has(lastSegment(new URL(request.url).pathname))) {
        try {
            return await fetch(request);
        } catch {
            const standalone = await cache.match(request, { ignoreSearch: true });
            if (standalone) return standalone;
            return new Response('Offline', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
    }

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
