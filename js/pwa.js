/**
 * Progressive Web App plumbing: registers the service worker, keeps the
 * browser chrome in step with the app's theme, and owns the "Install app"
 * affordance that Settings renders.
 *
 * This module imports nothing from the rest of the app, in either direction
 * of the dependency. Settings reads it directly - `pwa.js` has no imports at
 * all, so that cannot close a cycle - but it also fires `pwa-state-changed` on
 * `document` rather than reaching into Settings, which is how the preset and
 * editor pair are kept apart.
 *
 * Nothing in here is allowed to break the app if it is missing. Opened over
 * file://, or in a browser without service workers, every entry point is a
 * no-op and the app runs exactly as it always did.
 */

/** Fired on `document` whenever the install/offline state changes. */
const STATE_EVENT = 'pwa-state-changed';

let deferredPrompt = null;
let offlineReady = false;
let registered = false;
/** Set when the user declines the prompt, so we can tell that apart from a
 *  browser that never offered one. The copy is different and the difference
 *  matters: "this browser can't" reads as broken, "not now" does not. */
let declined = false;
/** Set once the browser has taken the prompt. `appinstalled` is the
 *  confirmation, but it does not arrive synchronously, and without this the
 *  row would spend that gap claiming the browser cannot install. */
let accepted = false;

const supported = typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && window.isSecureContext;

/* ------------------------------------------------------------------ *
 * Install state
 * ------------------------------------------------------------------ */

/**
 * True when the page is already running as an installed app rather than in a
 * browser tab. `display-mode` is the standard test; the navigator.standalone
 * fallback is the old iOS spelling and costs nothing to keep.
 */
export function isInstalled() {
    if (window.navigator.standalone === true) return true;
    return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches;
}

/**
 * What the Install row should say:
 *
 *   'installed'    - already running as an app, nothing left to do
 *   'installable'  - the browser has offered us a prompt, we can call it
 *   'declined'     - the user said no; the prompt is spent for this session
 *   'unavailable'  - no prompt at all, so the row explains how to do it by hand
 *
 * 'unavailable' is a real state rather than a hidden row, because the
 * commonest way to reach it is a browser that supports PWAs but not
 * `beforeinstallprompt`. Saying nothing there is how users conclude the app
 * is broken.
 */
export function getInstallState() {
    if (isInstalled()) return 'installed';
    if (deferredPrompt) return 'installable';
    // Between accepting and `appinstalled` the app really is being installed;
    // the confirmation is only a formality, and the copy is the same either
    // way so a browser that never fires it still reads correctly.
    if (accepted) return 'installed';
    return declined ? 'declined' : 'unavailable';
}

/** True once a service worker is active, i.e. the app can now open offline. */
export function isOfflineReady() {
    return offlineReady;
}

function notify() {
    document.dispatchEvent(new CustomEvent(STATE_EVENT));
}

/* ------------------------------------------------------------------ *
 * Installing
 * ------------------------------------------------------------------ */

/**
 * Show the browser's own install prompt.
 *
 * Resolves to true if the user accepted. The stored prompt is dropped before
 * `prompt()` is called: Chrome will not fire `beforeinstallprompt` a second
 * time for the same app in the same session, so holding onto it would leave
 * the Settings button permanently dead after one dismissal.
 */
export async function promptInstall() {
    if (!deferredPrompt) return false;

    const event = deferredPrompt;
    deferredPrompt = null;
    // The row must stop offering the button before the browser's own dialog
    // opens, or a double tap fires two prompts.
    notify();

    try {
        await event.prompt();
        const choice = await event.userChoice;
        const took = !!choice && choice.outcome === 'accepted';
        if (took) accepted = true;
        else declined = true;
        notify();
        return took;
    } catch {
        // Some browsers reject prompt() when the document is not visible. The
        // prompt is spent either way - Chrome will not offer it again this
        // session - so record it as "not now" rather than leaving the row to
        // claim the browser cannot install at all.
        declined = true;
        notify();
        return false;
    }
}

window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the default mini-infobar off the bottom of the screen; the app
    // offers this itself, in Settings, where it can explain what it does.
    event.preventDefault();
    deferredPrompt = event;
    declined = false;
    accepted = false;
    notify();
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    declined = false;
    accepted = false;
    notify();
});

// Leaving display-mode (an installed app can be opened in a browser) has to
// put the button back.
for (const mode of ['standalone', 'minimal-ui', 'browser']) {
    const query = window.matchMedia(`(display-mode: ${mode})`);
    const onChange = () => notify();
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);   // older Safari
}

/* ------------------------------------------------------------------ *
 * Service worker
 * ------------------------------------------------------------------ */

/**
 * The worker has to sit at the app root or it cannot control the app root, but
 * this module lives one directory down in js/. Resolving against the module's
 * own URL rather than the page's means the path is right no matter which page
 * imported us - a relative './sw.js' would silently look for /tests/sw.js the
 * moment the test page loaded this.
 */
const SW_URL = new URL('../sw.js', import.meta.url);

export function registerServiceWorker() {
    if (!supported || registered) return;
    registered = true;

    navigator.serviceWorker.register(SW_URL, {
        // The worker is what tells the browser a new deploy exists, so serving
        // it from the HTTP cache defeats the entire update path.
        updateViaCache: 'none'
    }).then(() => navigator.serviceWorker.ready)
      .then(() => {
          offlineReady = true;
          notify();
      })
      .catch((err) => {
          // Not fatal - the app just will not be available offline. Worth a
          // console line because "it silently did not install" is otherwise
          // invisible from the device.
          console.warn('[nova] service worker registration failed:', err);
      });
}

/* ------------------------------------------------------------------ *
 * Theme colour
 * ------------------------------------------------------------------ */

/**
 * Keep `<meta name="theme-color">` on the active theme's background, so the
 * Android status bar matches the app instead of sitting there in a fixed
 * colour that clashes with three of the four themes.
 *
 * The manifest can only carry one static theme_color, so the live value is
 * this meta tag. It is read off the theme's own `--bg` rather than a table
 * here, which is the point: a fifth theme would be handled for free.
 */
function syncThemeColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;

    const bg = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim();

    if (bg) meta.setAttribute('content', bg);
}

// A MutationObserver rather than an event from setTheme(): the theme can also
// be changed by anything that sets `data-theme` directly, and a status bar
// that silently stops matching is not worth the coupling.
new MutationObserver(syncThemeColor)
    .observe(document.documentElement, { attributeFilter: ['data-theme'] });

syncThemeColor();
// The stylesheet is in <head> and blocks module execution, but stylesheet
// load and module evaluation are not ordered by the spec - re-run on load so
// the first paint of the status bar is never the default colour.
window.addEventListener('load', syncThemeColor);
