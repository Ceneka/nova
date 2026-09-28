/**
 * Translation runtime. Hand-rolled on purpose: AGENTS.md forbids npm
 * dependencies and a build step, and this app is downloaded-and-hosted
 * anywhere with no toolchain, so i18next & friends are not available.
 *
 * Three ways to reach a string:
 *
 *   1. Markup:  <span data-i18n="menu.settings">Settings</span>
 *      `applyI18n()` walks those and rewrites textContent. The English text
 *      stays in index.html, so the page still reads correctly before this
 *      module runs (or if it never runs at all).
 *
 *   2. Attributes, for the ones textContent cannot reach:
 *        data-i18n-attr="placeholder:preset.name;aria-label:a11y.backToDrills"
 *
 *   3. Code:    showToast(t('toast.drillDeleted'))
 *
 * `t()` never throws. A missing key falls back to English, then to the key
 * itself, and complains once in the console. A half-translated build has to
 * degrade to English words, not to a blank button.
 *
 * ## What is deliberately NOT translated
 *
 * Stored user data. Drill names, preset names, preset axis labels and any
 * shared code all round-trip through localStorage, the CSV export and the
 * share-code server; translating them would make a file exported in Spanish
 * unreadable in English, and would mean migrating data already on devices.
 * So the data stays as the user typed it and only the *chrome* around it
 * moves. The one place this needed care is the built-in preset axis labels
 * ("BH" / "Center" / "FH"): they are generated on the fly and then stored, so
 * they are translated at render time by `axisLabel()` rather than at
 * generation time, and a label the user typed themselves passes through
 * untouched.
 *
 * ## Adding a language
 *
 * Add a file under js/locales/, register it in LOCALES below, and add it to
 * PRECACHE in sw.js. The integration suite fails on a key that exists in one
 * dictionary and not another, so a partial translation cannot ship.
 */

import { en } from './locales/en.js';
import { es } from './locales/es.js';

const STORAGE_KEY = 'nova_lang';
const FALLBACK = 'en';

/**
 * Endonyms, deliberately untranslated: a language picker that reads
 * "Spanish" to someone who only speaks Spanish has failed at its one job.
 */
export const LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' }
];

const LOCALES = { en, es };

let current = FALLBACK;
const warned = new Set();

// --- lookup -----------------------------------------------------------------

/** Dotted path into a nested dictionary. Returns undefined, never throws. */
function lookup(dict, key) {
    if (!dict) return undefined;
    let node = dict;
    for (const part of key.split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return node;
}

/**
 * A dictionary entry is either a string, or `{one, other}` for anything that
 * counts. Spanish and English share the same plural rule (n === 1 takes the
 * singular), so one split covers every language in LOCALES. A language that
 * does not need it can still write plain strings.
 */
function isPlural(value) {
    return value !== null && typeof value === 'object';
}

function interpolate(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (match, name) => {
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
    });
}

function warnOnce(key) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`i18n: no translation for "${key}"`);
}

/**
 * Translate `key` into the current language.
 *
 * @param {string} key
 * @param {object} [params]  values for `{name}` holes, plus `n` for plurals
 */
export function t(key, params) {
    if (typeof key !== 'string' || !key) return '';

    let value = lookup(LOCALES[current], key);
    if (value === undefined) value = lookup(LOCALES[FALLBACK], key);
    if (value === undefined) {
        warnOnce(key);
        return key;
    }

    if (isPlural(value)) {
        const n = Number(params?.n);
        const form = n === 1 ? value.one : value.other;
        if (form === undefined) {
            warnOnce(key);
            return key;
        }
        value = form;
    }

    return params ? interpolate(value, params) : String(value);
}

// --- applying to the DOM ----------------------------------------------------

/**
 * Rewrite every marked node under `root` (default: the whole document).
 *
 * `data-i18n` sets textContent, which is right for the overwhelming majority
 * and safe by construction. The handful of strings that carry markup use
 * `data-i18n-html` instead - those come from our own dictionary, never from
 * user input, and `t()` does not escape params, so a caller that interpolates
 * untrusted data must escape it itself first.
 */
export function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });

    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
        el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });

    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
            const [attr, key] = pair.split(':').map((s) => s && s.trim());
            if (attr && key) el.setAttribute(attr, t(key));
        });
    });
}

// --- language state ---------------------------------------------------------

export function getLang() {
    return current;
}

export function isSupported(code) {
    return Object.prototype.hasOwnProperty.call(LOCALES, code);
}

/**
 * The browser's preference, narrowed to a language we actually ship.
 * Only consulted on the very first visit - see `initI18n`.
 */
export function detectLang() {
    const candidates = navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
    for (const tag of candidates) {
        if (!tag) continue;
        const base = String(tag).toLowerCase().split('-')[0];
        if (isSupported(base)) return base;
    }
    return FALLBACK;
}

/**
 * Stored choice wins over the browser's preference, always. The detection
 * exists so a Spanish phone gets Spanish on first open without a hunt through
 * Settings; once anyone has touched the setting, their choice is the answer
 * and a later trip through an English browser must not undo it.
 */
export function initI18n() {
    let stored = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch {
        // Private mode, disabled storage: fall through to detection.
    }
    current = isSupported(stored) ? stored : detectLang();
    document.documentElement.setAttribute('lang', current);
    return current;
}

export function setLang(code) {
    if (!isSupported(code)) return current;
    current = code;
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch {
        // A language that cannot be remembered still works for this session.
    }
    document.documentElement.setAttribute('lang', current);
    // The open screens are rebuilt from their own render functions, which read
    // t() at the moment they draw. Nothing else has to care.
    document.dispatchEvent(new CustomEvent('locale-changed', { detail: { lang: code } }));
    return current;
}

// --- shared, derived strings ------------------------------------------------

/**
 * The built-in preset axis labels are stored inside the preset, so they are
 * translated here rather than at generation time. A label the user typed is
 * not in the table and is returned unchanged.
 *
 * Chips only, never an editable field. The axis-label <input> holds the stored
 * value and writes back to the model on `oninput`, so translating what it
 * displays would quietly rewrite "BH" as "Rev." inside the user's saved preset
 * the first time they touched that field. Read-only display gets the
 * translation; the record keeps what the user actually has.
 */
const AXIS_LABELS = {
    bh: 'axis.bh',
    center: 'axis.center',
    fh: 'axis.fh',
    short: 'axis.short',
    mid: 'axis.mid',
    long: 'axis.long'
};

export function axisLabel(label) {
    const key = AXIS_LABELS[String(label ?? '').trim().toLowerCase()];
    return key ? t(key) : label;
}

/** Tokens a factory drill key is built from. Anything else is not a factory drill. */
const DRILL_TOKENS = {
    push: 'drill.stroke.push',
    drive: 'drill.stroke.drive',
    loop: 'drill.stroke.loop',
    random: 'drill.word.random',
    all: 'drill.word.all'
};

const SIDE_TOKENS = { b: 'drill.side.b', f: 'drill.side.f' };

/**
 * The one place a drill key becomes a display name.
 *
 * The key itself is storage - it is the `custom_drills` object key and the
 * `Set` column of the shared CSV - so it is never translated. Only the label
 * shown to a person is. ui.js, editor.js and statsUi.js each had their own
 * copy of this; they now share this one, which is also why switching language
 * re-labels all three at once.
 *
 * @param {string} key
 * @param {boolean} [verbatimCustom=true]  show custom drill keys as stored
 */
export function drillDisplayName(key, verbatimCustom = true) {
    if (!key) return '';
    // Custom drill keys are the user's own text; the app has always shown
    // them as they are in the history.
    if (key.startsWith('cust_')) return key;

    const composed = composeDrillName(key);
    if (composed) return composed;

    // Not a factory drill (an imported key, a hand-edited one): keep the
    // title-cased form the app has always fallen back to.
    return key.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/** null when the key contains a token we do not recognise. */
function composeDrillName(key) {
    const parts = [];

    for (const raw of String(key).split('-')) {
        const pair = /^([a-z]+)\(([bf])\)$/.exec(raw);   // push(b)
        if (pair) {
            const stroke = DRILL_TOKENS[pair[1]];
            const side = SIDE_TOKENS[pair[2]];
            if (!stroke || !side) return null;
            parts.push(t(stroke) + t(side));
            continue;
        }

        if (/^\d+$/.test(raw)) {                          // 23-random-drive
            parts.push(raw);
            continue;
        }

        const token = DRILL_TOKENS[raw.toLowerCase()];
        if (!token) return null;
        parts.push(t(token));
    }

    if (!parts.length) return null;

    // A leading count is a prefix on the whole name, not one more element in
    // the series, so it takes a space rather than the separator.
    // "23-random-drive" is "23 Random Drive" in English and
    // "23 Aleatorio · Golpe" in Spanish. Joining the number with the separator
    // would give "23 · Aleatorio · Golpe", which reads as three things.
    const [head, ...rest] = parts;
    return /^\d+$/.test(head)
        ? head + ' ' + rest.join(t('drill.sep'))
        : parts.join(t('drill.sep'));
}

// --- window bindings --------------------------------------------------------
// index.html uses inline onclick handlers, so the language switcher lives here
// alongside every other handler rather than behind an import in main.js.
//
// The guard is load-bearing, not defensive. `tests/presets.test.mjs` imports
// js/presets.js under bare Node, and presets.js reaches i18n.js through
// describePreset(). An unguarded `window.x =` at module scope throws there and
// takes the whole unit suite down with it - the shape is the same as the
// try/catch around localStorage further up.
if (typeof window !== 'undefined') {
    window.setLang = setLang;
    window.t = t;
}
