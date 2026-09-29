/**
 * Cloud backup for drills, presets, history and settings.
 *
 * ## What this is, honestly
 *
 * A backup of what `localStorage` holds, kept somewhere other than the phone,
 * so a lost or wiped device is not a lost training history. It is not a sync
 * engine: there is no merge, no conflict resolution and no per-drill diff.
 * Last write wins, and that is a deliberate choice rather than a missing
 * feature - a real merge would need the server to understand the drill format,
 * and that format is a compatibility surface this app owns and versions by
 * itself.
 *
 * ## What is deliberately NOT in a bundle
 *
 * `nova_ai_config` holds a bring-your-own-key API key. That key is sent to
 * exactly one base URL, typed by the user, and by definition never to us - so
 * it is excluded here, and excluding it is the whole reason `pushBundle()`
 * walks a fixed list of keys rather than sweeping `localStorage`.
 *
 * `nova_account` and `nova_api_base` are excluded for the obvious reasons: one
 * is the credential used to talk to the server, the other points at it.
 *
 * Nothing in this module runs unless somebody is signed in and asks for it.
 */

import { apiFetch } from './account.js';

/**
 * The keys that travel. This is a list, not a sweep, and it has to stay a
 * list: "upload everything in localStorage" would one day upload the key.
 *
 * `user_defaults` is in here, `nova_lang` and `nova_theme_pref` too - a new
 * phone restoring somebody's drills should also come back in their language
 * rather than reverting to whatever the browser says.
 */
export const SYNC_KEYS = [
    'custom_drills',
    'custom_data',
    'drill_order',
    'user_defaults',
    'nova_ball_presets',
    'nova_ai_drills',
    'nova_stats',
    'nova_sessions',
    'nova_active_session',
    'nova_lang',
    'nova_theme_pref',
    'nova_last_played'
];

/** Keys that must never leave the device, restated so the pairing is visible. */
export const LOCAL_ONLY_KEYS = ['nova_ai_config', 'nova_account', 'nova_api_base'];

const LAST_SYNC_KEY = 'nova_last_sync';

const hasStorage = () => {
    try {
        return typeof localStorage !== 'undefined' && !!localStorage;
    } catch {
        return false;
    }
};

/**
 * Read the keys that travel, parsed.
 *
 * A value that will not parse is kept as its raw string rather than dropped:
 * a half-written entry costs that one key on the far side and nothing here,
 * which is the rule the rest of the app follows for its own storage.
 */
export function collectBundle() {
    const bundle = {};
    if (!hasStorage()) return bundle;
    for (const key of SYNC_KEYS) {
        let raw;
        try {
            raw = localStorage.getItem(key);
        } catch {
            continue;
        }
        if (raw === null || raw === undefined) continue;
        try {
            bundle[key] = JSON.parse(raw);
        } catch {
            bundle[key] = raw;
        }
    }
    return bundle;
}

/**
 * Write a bundle back into `localStorage`.
 *
 * A string is written raw and everything else is re-stringified, which is the
 * exact inverse of `collectBundle()` above: that one parses a stored value and
 * falls back to the raw string when the parse fails, so a raw string coming
 * back in has to go out unquoted. For the way this app stores things - `forest`
 * rather than `"forest"` for a theme - the pair is the identity, and there is a
 * check that says so.
 *
 * Only keys this app knows about are written, and only ones the bundle
 * actually has: a restore must never *delete* a key the backup did not carry,
 * because an older backup restoring onto a newer app would otherwise quietly
 * reset whatever the newer version added.
 */
export function applyBundle(bundle) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        return { applied: 0, ignored: 0 };
    }
    let applied = 0;
    let ignored = 0;
    for (const key of SYNC_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(bundle, key)) {
            ignored++;
            continue;
        }
        const value = bundle[key];
        if (value === undefined) {
            ignored++;
            continue;
        }
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            applied++;
        } catch {
            // A full quota costs the rest of the restore, not the whole thing.
            ignored++;
        }
    }
    return { applied, ignored };
}

export function getLastSyncAt() {
    if (!hasStorage()) return null;
    try {
        const raw = localStorage.getItem(LAST_SYNC_KEY);
        return raw || null;
    } catch {
        return null;
    }
}

function setLastSyncAt(iso) {
    try {
        localStorage.setItem(LAST_SYNC_KEY, iso);
    } catch {
        /* the marker is a convenience */
    }
}

export function deviceLabel() {
    try {
        const ua = String(navigator.userAgent || '');
        // Something a human can read in a token list, not a 4000-character UA.
        const platform = navigator.platform || '';
        return `${platform} ${ua}`.replace(/\s+/g, ' ').trim().slice(0, 120) || 'web';
    } catch {
        return 'web';
    }
}

/** A rough size, so the UI can refuse to push a bundle the server will reject. */
export function bundleSize(bundle) {
    try {
        return new Blob([JSON.stringify(bundle)]).size;
    } catch {
        return 0;
    }
}

/**
 * Push the current bundle. Returns the server's timestamp rather than making
 * the caller invent one, so "saved 2 minutes ago" does not depend on the
 * device clock being right.
 */
export async function pushBundle() {
    const payload = collectBundle();
    const response = await apiFetch('/api/nova/sync', {
        method: 'PUT',
        body: JSON.stringify({
            payload,
            device: deviceLabel(),
            client_updated_at: getLastSyncAt()
        })
    });
    if (!response.ok) {
        return { ok: false, error: response.error || `http_${response.status}` };
    }
    const at = response.data?.updatedAt || new Date().toISOString();
    setLastSyncAt(at);
    return { ok: true, updatedAt: at, size: bundleSize(payload) };
}

/** Pull whatever is stored, without touching this device. */
export async function pullBundle() {
    const response = await apiFetch('/api/nova/sync', { method: 'GET' });
    if (!response.ok) {
        return { ok: false, error: response.error || `http_${response.status}` };
    }
    return {
        ok: true,
        saved: !!response.data?.saved,
        payload: response.data?.payload || null,
        updatedAt: response.data?.updatedAt || null,
        device: response.data?.device || null
    };
}

/**
 * Pull and write. The caller is responsible for asking the user first: this
 * overwrites local drills with whatever was last backed up, which is exactly
 * right for "I lost my phone" and exactly wrong for a stray tap.
 */
export async function restoreFromCloud() {
    const result = await pullBundle();
    if (!result.ok) return result;
    if (!result.saved || !result.payload) return { ...result, applied: null };
    const { applied, ignored } = applyBundle(result.payload);
    return { ...result, applied, ignored };
}
