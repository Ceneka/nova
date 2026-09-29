/**
 * Bring-your-own-key configuration for the assistant.
 *
 * No key ships with this app and none is needed for Tier 0 - the deterministic
 * tier that answers `push b, drive f` with no network at all. Everything in
 * this module exists to let somebody *optionally* point the model tier at
 * their own OpenAI-compatible endpoint.
 *
 * ## Two slots, and why "follow the text model" is a mode and not a pointer
 *
 * The question the brief asked was "a setting to use the same model for text
 * and voice". Both obvious implementations are wrong in a way that bites:
 *
 *   - a **shared pointer** means detaching is a second control and the state
 *     you are in is invisible until you go looking for it;
 *   - **copy-on-toggle** copies a value you then have to remember is a copy.
 *
 * So it is a mode with both behaviours and a visible state:
 *
 *     voice.mode: 'own' | 'follow-text'
 *
 * `follow-text` resolves the voice slot at CALL TIME from the text slot, and
 * Settings shows exactly what you are following with a Detach button. You can
 * always see what you are following and break the link in one tap, and it
 * never silently changes under you.
 *
 * ## On storing the key, stated honestly
 *
 * The key lives in `localStorage` under `nova_ai_config` - the only place this
 * app keeps user data, because there is no server and there is no account. It
 * is sent **only** as an `Authorization` header to the one base URL you typed,
 * and it never appears in a log line, a toast, an export, an error message or a
 * share code. `redact()` exists because that is a promise that has to be kept
 * in more than one place, and a key that leaks into a console is a key that
 * ends up in a screenshot.
 *
 * `localStorage` is readable by any script on the origin. That is fine on a
 * personal phone and is NOT fine on a shared machine, and the Settings copy
 * says so, in both languages. `sessionOnly` is offered for exactly that case:
 * the key lives in memory and dies with the tab.
 *
 * ## Node-safe
 *
 * `localStorage` is touched only inside a try/catch and only when it exists, so
 * `tests/ai.test.mjs` can import this under bare Node with a stub.
 */

const STORAGE_KEY = 'nova_ai_config';

/** A provider is a base URL and a couple of headers. Nothing more. */
export const PROVIDERS = {
    openrouter: {
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        // OpenRouter identifies the calling app from these two headers. They
        // are not authentication; they are attribution, and they are also how
        // a self-hosted OpenAI-compatible proxy recognises the client.
        extraHeaders: { 'HTTP-Referer': 'https://nova.tenisdemesa.ar/', 'X-Title': 'Nova Drill' }
    },
    openai: {
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        extraHeaders: {}
    },
    custom: {
        id: 'custom',
        // Deliberately empty. §16 Q6: we do not hardcode a model id, and by
        // the same argument a self-hosted endpoint must be typed in full.
        baseUrl: '',
        extraHeaders: {}
    }
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export const VOICE_MODES = ['own', 'follow-text'];

/** A blank configuration: two empty slots and the safe defaults. */
export function defaultConfig() {
    return {
        text: { provider: 'openrouter', baseUrl: '', apiKey: '', model: '' },
        voice: { mode: 'follow-text', provider: 'custom', baseUrl: '', apiKey: '', model: '', language: '' },
        speak: true,
        // History is per-session unless this is turned on. Off by default
        // because "remember this conversation" is opt-in everywhere else too.
        remember: false,
        // The screen lock is on by default because it is what keeps the
        // browser from suspending the microphone the wake word depends on -
        // see aiVoice.js. It is still released the moment the panel closes.
        screenLock: true,
        // "Hey Nova" and friends. Off by default: arming the microphone has to
        // be a thing the user does, not a thing that happens to them.
        wake: { enabled: false, phrases: ['hey nova', 'ok nova', 'nova'] },
        // The key is kept in memory only, never written to localStorage.
        sessionOnly: false
    };
}

// --- the in-memory copy -----------------------------------------------------

let config = null;
/** The session-only key, when one is in use. Never persisted. */
let sessionKey = '';

const hasStorage = () => {
    try {
        return typeof localStorage !== 'undefined' && !!localStorage;
    } catch {
        return false;
    }
};

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Everything in localStorage is hostile input: a hand-edited key, a half
 * written object, a provider id from two versions ago. Nothing here throws and
 * nothing here keeps a value it did not recognise.
 */
function normalizeSlot(raw, fallback) {
    const out = { ...fallback };
    if (!raw || typeof raw !== 'object') return out;
    if (PROVIDER_IDS.includes(raw.provider)) out.provider = raw.provider;
    if (raw.baseUrl !== undefined) out.baseUrl = str(raw.baseUrl, 400);
    if (raw.apiKey !== undefined) out.apiKey = str(raw.apiKey, 400);
    if (raw.model !== undefined) out.model = str(raw.model, 120);
    if (raw.language !== undefined) out.language = str(raw.language, 20);
    if (VOICE_MODES.includes(raw.mode)) out.mode = raw.mode;
    return out;
}

/** A wake phrase is a couple of short words. Anything else is a typo. */
const normalizePhrases = (list) => (Array.isArray(list) ? list : String(list || '').split(','))
    .map(p => String(p ?? '').trim().slice(0, 40))
    .filter(p => /^[\p{L}\p{N} ]+$/u.test(p))
    .slice(0, 5);

export function normalizeConfig(raw) {
    const base = defaultConfig();
    if (!raw || typeof raw !== 'object') return base;
    const phrases = normalizePhrases(raw.wake?.phrases ?? base.wake.phrases);
    return {
        text: normalizeSlot(raw.text, base.text),
        voice: normalizeSlot(raw.voice, base.voice),
        speak: raw.speak === undefined ? base.speak : !!raw.speak,
        remember: !!raw.remember,
        sessionOnly: !!raw.sessionOnly,
        screenLock: raw.screenLock === undefined ? base.screenLock : !!raw.screenLock,
        // An empty list would mean "never wakes up", which is not a thing
        // anybody asked for, so it falls back to the shipped phrases.
        wake: {
            enabled: !!raw.wake?.enabled,
            phrases: phrases.length ? phrases : base.wake.phrases
        }
    };
}

/** The wake phrases that will actually be used, in the form the panel needs. */
export function getWakePhrases() {
    return getAiConfig().wake.phrases;
}

/**
 * The configuration, loaded once. `sessionOnly` is honoured on read, so a
 * stored key is not handed back when the user asked for it not to be stored.
 */
export function getAiConfig() {
    if (config) return config;
    let raw = null;
    if (hasStorage()) {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) raw = JSON.parse(stored);
        } catch {
            raw = null;
        }
    }
    config = normalizeConfig(raw);
    if (config.sessionOnly) {
        // The persisted copy must not be a back door for a key that was
        // supposed to die with the tab.
        config.text.apiKey = sessionKey;
        config.voice.apiKey = sessionKey;
    }
    return config;
}

/**
 * The whole configuration. Pass a patch to change any of it; everything is
 * normalized again on the way in, so a caller cannot store a bad provider.
 */
export function setAiConfig(patch = {}) {
    const current = getAiConfig();
    const next = normalizeConfig({
        ...current,
        ...patch,
        text: { ...current.text, ...(patch.text || {}) },
        voice: { ...current.voice, ...(patch.voice || {}) }
    });

    if (next.sessionOnly) {
        // Hold the key in memory and keep it out of the store entirely.
        sessionKey = next.text.apiKey || next.voice.apiKey || sessionKey;
        next.text.apiKey = sessionKey;
        next.voice.apiKey = sessionKey;
    } else {
        sessionKey = '';
    }

    config = next;
    persist();
    return config;
}

function persist() {
    if (!config || !hasStorage()) return;
    try {
        if (config.sessionOnly) {
            // Store the settings, minus every key.
            const safe = { ...config, text: { ...config.text, apiKey: '' }, voice: { ...config.voice, apiKey: '' } };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        // Private mode or a full quota: the configuration still works for
        // this session, it just will not be remembered.
        console.error('Could not persist the AI configuration', e);
    }
}

/** Called once from initData(). */
export function initAiConfig() {
    getAiConfig();
    return config;
}

/** Forget the key, and the settings that hold it. */
export function clearAiKey() {
    sessionKey = '';
    const c = getAiConfig();
    c.text.apiKey = '';
    c.voice.apiKey = '';
    persist();
    return c;
}

// --- resolving a slot -------------------------------------------------------

/**
 * The voice slot as it should be used right now.
 *
 * `follow-text` resolves the TEXT slot at call time - that is the whole point
 * of the mode - so changing the text model changes the voice model too, and
 * the Settings row still says which one that is.
 */
export function resolveVoiceSlot() {
    const c = getAiConfig();
    if (c.voice.mode === 'follow-text') return { ...c.text, followedFrom: 'text' };
    return { ...c.voice, followedFrom: null };
}

/** True when the text slot has everything a request needs. */
export function isTextConfigured() {
    const s = getAiConfig().text;
    return !!(s.baseUrl && s.apiKey && s.model);
}

export function isVoiceConfigured() {
    const s = resolveVoiceSlot();
    return !!(s.baseUrl && s.apiKey && s.model);
}

/** The base URL with any trailing slash removed, so paths concatenate cleanly. */
export function normalizeBaseUrl(baseUrl) {
    return str(baseUrl, 400).replace(/\/+$/, '');
}

/** `{base}/chat/completions`. A base that already ends in the path is left alone. */
export function chatUrl(slot) {
    const base = normalizeBaseUrl(slot?.baseUrl);
    if (!base) return '';
    return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

export function modelsUrl(slot) {
    const base = normalizeBaseUrl(slot?.baseUrl);
    if (!base) return '';
    return /\/models$/.test(base) ? base : `${base}/models`;
}

/** The audio-transcription endpoint, for the API speech-in path. */
export function transcriptionsUrl(slot) {
    const base = normalizeBaseUrl(slot?.baseUrl);
    if (!base) return '';
    return /\/audio\/transcriptions$/.test(base) ? base : `${base}/audio/transcriptions`;
}

// --- redaction --------------------------------------------------------------

/**
 * `sk-or-v1-1234...cdef` -> `sk-or-v1-…cdef`.
 *
 * Kept as a prefix and the last four characters, which is enough to tell two
 * keys apart when you are staring at a settings screen and useless to anyone
 * reading over your shoulder.
 */
export function maskKey(key) {
    const s = str(key, 400);
    if (!s) return '';
    if (s.length <= 10) return '••••';
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * Scrub every known key out of a string, for anywhere text is about to be
 * logged, toasted, put in a `title`, or shown in an error.
 *
 * Called at every exit from `aiClient.js`. The service worker already leaves
 * every cross-origin request alone, so a key cannot be cached - but it could
 * still land in a console, and a console is a screenshot.
 */
export function redact(text, extraKeys = []) {
    let out = String(text ?? '');
    const keys = [sessionKey, getAiConfig().text.apiKey, getAiConfig().voice.apiKey, ...extraKeys]
        .filter(k => typeof k === 'string' && k.length >= 8);
    for (const key of keys) {
        // split/join, not replace: a string key in a RegExp is a surprise.
        out = out.split(key).join(maskKey(key));
    }
    return out;
}

/**
 * The headers for one request. The key appears here and nowhere else in the
 * whole app - it is never concatenated into a URL, a log, or an error.
 */
export function buildHeaders(slot, { json = true } = {}) {
    const headers = {};
    if (json) headers['Content-Type'] = 'application/json';
    if (slot?.apiKey) headers['Authorization'] = `Bearer ${slot.apiKey}`;

    const provider = PROVIDERS[slot?.provider];
    if (provider?.extraHeaders) Object.assign(headers, provider.extraHeaders);
    return headers;
}
