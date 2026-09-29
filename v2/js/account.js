/**
 * Sign-in and authenticated transport for the Nova app.
 *
 * ## Why there is an account at all
 *
 * The app is localStorage-first and works with no account, offline, forever.
 * Nothing in this module is required to play a drill, and nothing here gates
 * the assistant, the editor, or Bluetooth. An account buys two things that
 * genuinely need a server: a backup of your drills somewhere other than the
 * phone, and (later) hosted AI. Everything else stays local.
 *
 * ## The flow, and why the password never comes here
 *
 * The app is a static PWA on `nova.tenisdemesa.ar`; the accounts belong to
 * `tenisdemesa.ar`. Rather than shipping a password box to a client, sign-in
 * is a redirect to that site's own login - which it already has, with Google -
 * and the site hands back a one-time code:
 *
 *   1. `startSignIn()` mints a PKCE verifier, stores it, and navigates to
 *      `/api/nova/auth/start` with the *challenge*.
 *   2. That endpoint uses the site's existing session, or bounces through
 *      `/login` first, and redirects back to `callback.html?code=...&state=...`.
 *   3. `completeSignIn()` exchanges the code plus the verifier for a token pair.
 *
 * The verifier never leaves this device, so an intercepted redirect URL is not
 * a login - it is a useless string without it. `state` is checked against the
 * copy stored here in step 1, so a callback that this browser did not start is
 * refused.
 *
 * ## Node-safe and DOM-optional
 *
 * `crypto.subtle` is present in browsers, in the service worker and (Node 18+)
 * under a global flag, so this module imports cleanly under bare Node for the
 * unit tests. It reads `localStorage` only behind a guard, and touches
 * `document` only inside `startSignIn()`.
 */

/** Where the accounts and the Nova API live. */
export const DEFAULT_API_BASE = 'https://tenisdemesa.ar';

/** The static page the site redirects back to. Same directory as converter.html. */
export const CALLBACK_PATH = 'callback.html';

const STORAGE_KEY = 'nova_account';
/** In flight sign-in: verifier + state + where to return to. */
const PENDING_KEY = 'nova_account_pending';

/** Refresh this far ahead of expiry, so a token never dies mid-flight. */
const REFRESH_MARGIN_MS = 60 * 1000;

export const MAX_ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// --- storage -----------------------------------------------------------------

const hasStorage = () => {
    try {
        return typeof localStorage !== 'undefined' && !!localStorage;
    } catch {
        return false;
    }
};

const hasSession = () => {
    try {
        return typeof sessionStorage !== 'undefined' && !!sessionStorage;
    } catch {
        return false;
    }
};

/**
 * The API base. A developer can point a local copy of the app at a local API
 * with `localStorage.setItem('nova_api_base', 'http://localhost:3000')`; the
 * app itself never writes this key and there is no UI for it.
 */
export function getApiBase() {
    let base = DEFAULT_API_BASE;
    if (hasStorage()) {
        try {
            const override = String(localStorage.getItem('nova_api_base') || '').trim();
            if (/^https?:\/\//i.test(override)) base = override;
        } catch {
            /* private mode: the default is fine */
        }
    }
    return base.replace(/\/+$/, '');
}

export function apiUrl(path) {
    const suffix = String(path || '').startsWith('/') ? path : `/${path || ''}`;
    return `${getApiBase()}${suffix}`;
}

// --- PKCE --------------------------------------------------------------------

/** base64url without padding, from a CSPRNG. */
export function randomToken(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** S256 challenge: base64url(sha256(verifier)). */
export async function codeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The return-to URL for this app. Always same-origin, never user supplied. */
export function appReturnTo() {
    try {
        return new URL('./', location.href).toString();
    } catch {
        return './';
    }
}

// --- stored session ----------------------------------------------------------

const emptyAccount = () => ({ access: '', expiresAt: 0, refresh: '', user: null, savedAt: null });

/**
 * Everything read back out of storage is hostile: a hand-edited entry, a
 * half-written one, a shape from a version that no longer exists. Nothing
 * throws and nothing keeps a value it does not recognise.
 */
export function normalizeAccount(raw) {
    const out = emptyAccount();
    if (!raw || typeof raw !== 'object') return out;
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    out.access = str(raw.access, 4000);
    out.refresh = str(raw.refresh, 4000);
    out.expiresAt = Number.isFinite(raw.expiresAt) ? Number(raw.expiresAt) : 0;
    out.savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : null;
    if (raw.user && typeof raw.user === 'object') {
        out.user = {
            id: String(raw.user.id ?? ''),
            email: str(raw.user.email, 320),
            name: str(raw.user.name, 160) || null
        };
    }
    return out;
}

export function readAccount() {
    if (!hasStorage()) return emptyAccount();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeAccount(JSON.parse(raw)) : emptyAccount();
    } catch {
        return emptyAccount();
    }
}

function writeAccount(account) {
    if (!hasStorage()) return account;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    } catch {
        // A full quota costs the convenience of staying signed in, not the
        // session's validity for this tab.
    }
    return account;
}

export function clearAccount() {
    if (hasStorage()) {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* nothing to do */
        }
    }
    return emptyAccount();
}

export function isSignedIn() {
    return !!readAccount().refresh;
}

export function getUser() {
    return readAccount().user;
}

function storeFromResponse(json) {
    const access = typeof json?.access_token === 'string' ? json.access_token : '';
    const refresh = typeof json?.refresh_token === 'string' ? json.refresh_token : '';
    if (!access) return null;
    const ttlMs = Number.isFinite(json?.expires_in)
        ? Math.min(Number(json.expires_in) * 1000, MAX_ACCESS_TOKEN_TTL_MS)
        : 15 * 60 * 1000;
    const account = {
        access,
        refresh,
        expiresAt: Date.now() + ttlMs,
        user: json?.user && typeof json.user === 'object'
            ? {
                id: String(json.user.id ?? ''),
                email: typeof json.user.email === 'string' ? json.user.email.slice(0, 320) : '',
                name: typeof json.user.name === 'string' ? json.user.name.slice(0, 160) : null
            }
            : null,
        savedAt: new Date().toISOString()
    };
    // A rotation response carries a new refresh token; a plain refresh should
    // keep the one we already have rather than signing the user out.
    return writeAccount({ ...account, refresh: refresh || readAccount().refresh });
}

// --- sign in / out -----------------------------------------------------------

/** A short label so the server-side token list says more than "a token". */
export function deviceLabel() {
    try {
        return String(navigator.userAgent || '').slice(0, 120);
    } catch {
        return 'web';
    }
}

/**
 * Begin sign-in by navigating away. There is nothing to render: the site
 * handles the login screen, and `callback.html` brings the user back.
 */
export async function startSignIn({ returnTo } = {}) {
    const verifier = randomToken(32);
    const challenge = await codeChallenge(verifier);
    const state = randomToken(16);
    const redirectUri = new URL(CALLBACK_PATH, location.href).toString();

    if (hasSession()) {
        try {
            sessionStorage.setItem(
                PENDING_KEY,
                JSON.stringify({ verifier, state, returnTo: returnTo || appReturnTo() })
            );
        } catch {
            /* private mode: the flow still completes, minus the state check */
        }
    }

    const authorize = new URL(apiUrl('/api/nova/auth/start'));
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('device', deviceLabel());
    location.assign(authorize.toString());
}

/**
 * Finish sign-in on `callback.html`.
 *
 * The state stored by `startSignIn()` is compared first and consumed either
 * way, so a replayed callback URL cannot be reused. A missing pending entry is
 * not an error - it just means this browser did not start this sign-in.
 */
export async function completeSignIn({ code, state } = {}) {
    if (!code) return { ok: false, error: 'missing_code' };

    let pending = null;
    if (hasSession()) {
        try {
            pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
            sessionStorage.removeItem(PENDING_KEY);
        } catch {
            pending = null;
        }
    }
    if (pending?.state && state && pending.state !== state) {
        return { ok: false, error: 'state_mismatch' };
    }
    if (!pending?.verifier) return { ok: false, error: 'no_pending_signin' };

    const redirectUri = new URL(CALLBACK_PATH, location.href).toString();
    const response = await fetch(apiUrl('/api/nova/auth/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
            code,
            code_verifier: pending.verifier,
            redirect_uri: redirectUri,
            state,
            device: deviceLabel()
        })
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
        return { ok: false, error: json?.error || 'token_exchange_failed' };
    }
    const account = storeFromResponse(json);
    if (!account) return { ok: false, error: 'bad_token_response' };

    return { ok: true, user: account.user, returnTo: pending?.returnTo || './' };
}

/** Sign out. The local copy is cleared even if the server call fails. */
export async function signOut() {
    const account = readAccount();
    clearAccount();
    if (!account.refresh) return true;
    try {
        await fetch(apiUrl('/api/nova/auth/logout'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            body: JSON.stringify({ refresh_token: account.refresh })
        });
    } catch {
        // Best effort. The server keeps the token alive for at most its own
        // TTL, and the user asked to be signed out here, which they are.
    }
    return true;
}

// --- authenticated requests --------------------------------------------------

let refreshing = null;

/**
 * A valid access token, refreshing first if it is about to expire.
 *
 * `force` skips the not-yet-expired shortcut. It exists for one caller: the
 * retry in `apiFetch()` after a 401, where the token may have been revoked
 * server-side while it still looked fine locally.
 *
 * Concurrent callers share one refresh. Without that, a page that fires a sync
 * and a model request at the same moment would rotate the refresh token twice
 * - and the server treats a second presentation of a rotated token as a lost
 * race and mints yet another token, so the loser would keep chasing it.
 */
export async function getAccessToken({ force = false } = {}) {
    const account = readAccount();
    if (!account.refresh) return null;
    if (!force && account.access && account.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
        return account.access;
    }

    if (!refreshing) {
        refreshing = (async () => {
            const response = await fetch(apiUrl('/api/nova/auth/refresh'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'omit',
                body: JSON.stringify({ refresh_token: account.refresh })
            });
            const json = await response.json().catch(() => null);
            if (!response.ok) {
                // A refresh the server will not honour is a dead session.
                clearAccount();
                return null;
            }
            return storeFromResponse(json)?.access || null;
        })().finally(() => {
            refreshing = null;
        });
    }

    try {
        return await refreshing;
    } catch {
        clearAccount();
        return null;
    }
}

/**
 * `fetch` with the bearer token attached, refreshed once on a 401.
 *
 * `credentials: 'omit'` is not a default, it is the point: the API sets no
 * cookies and accepts no credentials, so there is no ambient authority for a
 * cross-site page to ride on.
 */
export async function apiFetch(path, options = {}) {
    const token = await getAccessToken();
    if (!token) {
        return { ok: false, status: 401, error: 'not_signed_in', data: null };
    }

    const send = (bearer) => fetch(apiUrl(path), {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
            Authorization: `Bearer ${bearer}`
        },
        credentials: 'omit'
    });

    let response = await send(token);
    if (response.status !== 401) {
        return { ok: response.ok, status: response.status, data: await safeJson(response) };
    }

    // The token may have been revoked server-side since it was issued; one
    // refresh-and-retry, then give up rather than loop.
    const fresh = await getAccessToken({ force: true });
    if (!fresh || fresh === token) {
        return { ok: false, status: 401, error: 'unauthorized', data: null };
    }
    response = await send(fresh);
    return { ok: response.ok, status: response.status, data: await safeJson(response) };
}

async function safeJson(response) {
    return response.json().catch(() => null);
}
