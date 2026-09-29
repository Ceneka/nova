/**
 * Share codes: upload a drill, download somebody else's.
 *
 * ## Where this goes
 *
 * This used to POST to a PocketBase instance run by the original author of the
 * upstream project (`nova.varandal.de`), which meant every drill anybody
 * shared on this deployment passed through a machine run by somebody else. It
 * now talks to the same tenisdemesa.ar account API the rest of the app uses,
 * which is run by the same people who run the site - see
 * `~/L/tdm-scrapper/web/src/app/api/nova/share/`.
 *
 * ## The old codes still work
 *
 * Codes already written are still sitting in that PocketBase, and people have
 * them written on paper and in messages. `downloadLegacy()` tries them only
 * after the new API has answered 404, so a shared link from before keeps
 * working and nothing is asked of anybody who pasted one.
 *
 * ## A share code needs no account
 *
 * That is the point of a share code: it has to work for whoever it was sent
 * to, including somebody who has never heard of this site. Uploading is
 * anonymous unless the user happens to be signed in, and is rate limited by
 * IP either way. Signing in only means the share is attributed to them.
 */

import { getAccessToken } from './account.js';

/** The pre-2026 backend, kept alive for codes that are already in the wild. */
const LEGACY_API_URL = 'https://nova.varandal.de/api/collections/shared_drills/records';

const asCode = (value) => String(value ?? '').trim().toUpperCase();

/** The app's own rule, kept here so a malformed code never reaches a server. */
export const isValidCode = (value) => /^[A-Z]{3}\d{3}$/.test(asCode(value));

async function parseJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Upload a drill and return its 6-character code.
 *
 * The same signature the editor has always called, so `handleShareDrill()` in
 * `editor.js` did not change. A failure is an `Error` with a `.status` when the
 * server said one, which the toast does not use but the console does.
 */
export async function uploadDrill(drillPayload) {
    const token = await getAccessToken();
    const response = await fetch(`${apiBase()}/api/nova/share`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        // No credentials: the API sets no cookies and accepts none, so there is
        // nothing for a cross-site page to ride on. See nova-cors.ts.
        credentials: 'omit',
        body: JSON.stringify({ drill: drillPayload })
    });

    if (!response.ok) {
        const json = await parseJson(response);
        const error = new Error(json?.error || `Upload failed (${response.status})`);
        error.status = response.status;
        throw error;
    }

    const json = await parseJson(response);
    const code = asCode(json?.code);
    if (!code) throw new Error('Upload failed: no code returned');
    return code;
}

/**
 * Download a drill by code, or null when there is no such code.
 *
 * A 404 from the new API is the only thing that triggers the legacy lookup,
 * and the legacy 404 means the code genuinely does not exist - so "not found"
 * still takes one round trip in the common case.
 */
export async function downloadDrill(code) {
    const clean = asCode(code);
    if (!isValidCode(clean)) return null;

    const response = await fetch(`${apiBase()}/api/nova/share/${encodeURIComponent(clean)}`, {
        credentials: 'omit'
    });

    if (response.ok) {
        const json = await parseJson(response);
        return json?.drill ?? null;
    }
    if (response.status !== 404) throw new Error('Network error');

    const legacy = await downloadLegacy(clean);
    if (legacy) return legacy;
    return null;
}

/** The old PocketBase shape. Nothing new is written here, ever. */
async function downloadLegacy(clean) {
    try {
        const url = `${LEGACY_API_URL}?filter=(share_code='${encodeURIComponent(clean)}')`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const json = await parseJson(response);
        if (json?.items?.length > 0) return json.items[0].drill_data;
    } catch {
        // An unreachable legacy server is not a download failure worth showing:
        // the user gets the same "code not found" either way.
    }
    return null;
}

let apiBaseCache = null;

/**
 * The API origin.
 *
 * Mirrors `getApiBase()` in `account.js` but reads it lazily and caches it, so
 * this module stays importable without dragging the account state in at load -
 * sharing a drill must work for somebody who has never signed in.
 */
function apiBase() {
    if (apiBaseCache) return apiBaseCache;
    let base = 'https://tenisdemesa.ar';
    try {
        const override = String(localStorage.getItem('nova_api_base') || '').trim();
        if (/^https?:\/\//i.test(override)) base = override;
    } catch {
        /* private mode */
    }
    apiBaseCache = base.replace(/\/+$/, '');
    return apiBaseCache;
}
