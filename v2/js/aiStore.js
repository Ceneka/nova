/**
 * The AI category's storage, and the draft the assistant is building.
 *
 * ## Why `nova_ai_drills` is its own key and not a `custom-ia` set
 *
 * `importCustomDrills()` in `state.js` rebuilds `custom_data` from scratch and
 * overwrites it. AI drills living inside `userCustomDrills` would be
 * **silently deleted by importing any CSV**, including a CSV the user exported
 * themselves. A separate key cannot be hit by that.
 *
 * The shared drill CSV is also a compatibility surface other apps read - its
 * `Set;Ball;Name;...` column set is frozen - so a new `IA` row value would
 * break every consumer of it. AI drills are simply not in that file until the
 * user moves one into Custom A/B/C, at which point it is an ordinary drill.
 *
 * ## The name rule
 *
 * An AI-generated drill name is the most hostile name source this app will
 * ever have: text from a third-party model, verbatim, with arbitrary
 * punctuation. So:
 *
 *   - the **key** is `ai_` + the clock + a random suffix, and is NEVER derived
 *     from the model's text. It is interpolated into
 *     `.btn-drill[data-key="..."]` by `updateLastPlayedHighlight()`, so a `"`
 *     or a `]` in it throws a `SyntaxError` on the *next* render, a long way
 *     from the keystroke.
 *   - the **display name** is stored as typed and rendered with `textContent`.
 *   - `asciiSlug()` is used only where a plainer string is structurally
 *     required, and nowhere else.
 *
 * ## Nothing here throws
 *
 * Same rule as `stats.js`: a full or hand-edited `localStorage` costs the AI
 * drills and nothing else. It must never break a drill run or the app boot.
 *
 * Node-safe: `localStorage` is touched only inside a try/catch and only when
 * it exists.
 */

import { drillKeyName } from './utils.js';

const STORAGE_KEY = 'nova_ai_drills';

/**
 * A drill is ~20 balls x 11 slots. 200 is a couple of hundred KB at worst and
 * a deliberately small fraction of the ~5 MB that has to stay free for the
 * user's own drills and presets.
 */
export const MAX_AI_DRILLS = 200;

/** Long enough for a model's prose, short enough to be a button. */
const MAX_NAME = 40;

// --- the store --------------------------------------------------------------

let drills = null;

const hasStorage = () => {
    try {
        return typeof localStorage !== 'undefined' && !!localStorage;
    } catch {
        return false;
    }
};

/**
 * Every stored record is hostile input. A drill without steps cannot be played,
 * and a drill whose steps are not arrays of arrays would take the runner down.
 */
function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.key !== 'string' || !raw.key) return null;

    // A step whose balls were ALL junk collapses to an empty step, and an
    // array of empty steps is not a drill - it is a runner crash waiting for
    // the first "play" tap. Drop the empties, then decide.
    const steps = (Array.isArray(raw.steps) ? raw.steps : [])
        .filter(step => Array.isArray(step) && step.length > 0)
        .map(step => step
            .filter(ball => Array.isArray(ball) && ball.length >= 7)
            .map(ball => ball.slice(0, 11)))
        .filter(step => step.length > 0);

    if (!steps.length) return null;

    return {
        key: raw.key,
        name: String(raw.name ?? '').slice(0, MAX_NAME) || 'Draft',
        steps,
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
        // 'voice' | 'text' | 'model' - a glyph on the row, nothing more.
        source: ['voice', 'text', 'model'].includes(raw.source) ? raw.source : 'text',
        // The plan is a diagnostic, not a rendering input: the panel reads it to
        // say which preset each step came from. It is dropped on load rather
        // than trusted, because nothing in the UI depends on it.
        plan: Array.isArray(raw.plan) ? raw.plan.slice(0, MAX_AI_DRILLS) : []
    };
}

function read() {
    if (!hasStorage()) return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalize).filter(Boolean);
    } catch {
        return [];
    }
}

function write() {
    if (!hasStorage()) return false;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(drills));
        return true;
    } catch {
        // Almost certainly QuotaExceededError. Shed the oldest until it fits
        // rather than losing all of them.
        while (drills.length > 1) {
            drills.shift();
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(drills));
                return true;
            } catch { /* still too big */ }
        }
        return false;
    }
}

/** Call once from initData(). A corrupt store reads as empty, never as a crash. */
export function loadAiDrills() {
    drills = read();
    if (hasStorage()) write();
    return getAiDrills();
}

/** Newest last, the same order the other drill lists use. */
export function getAiDrills() {
    if (drills === null) drills = read();
    return drills.slice();
}

export function getAiDrill(key) {
    if (drills === null) drills = read();
    return drills.find(d => d.key === key) || null;
}

export function aiDrillCount() {
    if (drills === null) drills = read();
    return drills.length;
}

/**
 * A key the model cannot influence.
 *
 * `Date.now()` in base36 plus a random suffix, exactly like `generateId()` in
 * presets.js. Deliberately NOT `drillKeyName(name)`: that is for keys derived
 * from a human's typed name, where a readable key is worth the fold. Here the
 * name is a third party's, and the readable part would only ever be a way to
 * smuggle a `"` into a selector.
 */
export function newAiDrillKey() {
    return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The single funnel into storage. The assistant may play a draft, rename it
 * and throw it away; only this writes.
 *
 * @returns {object|null} the stored record, or null if there was nothing to save
 */
export function persistDrill({ name, steps, source = 'text', plan = [] } = {}) {
    const clean = (Array.isArray(steps) ? steps : [])
        .filter(step => Array.isArray(step) && step.length > 0)
        .map(step => step
            .filter(ball => Array.isArray(ball) && ball.length >= 7)
            .map(ball => ball.slice(0, 11)))
        .filter(step => step.length > 0);

    if (!clean.length) return null;
    if (aiDrillCount() >= MAX_AI_DRILLS) return null;

    const record = normalize({
        key: newAiDrillKey(),
        // Stored exactly as given. The app never translates stored data, so an
        // AI-generated name is treated as if the user had typed it.
        name: String(name ?? '').slice(0, MAX_NAME) || 'Draft',
        steps: clean,
        createdAt: Date.now(),
        source,
        plan
    });
    if (!record) return null;

    if (drills === null) drills = read();
    drills.push(record);
    write();
    return record;
}

export function deleteAiDrill(key) {
    if (drills === null) drills = read();
    const before = drills.length;
    drills = drills.filter(d => d.key !== key);
    if (drills.length === before) return false;
    write();
    return true;
}

export function renameAiDrill(key, name) {
    if (drills === null) drills = read();
    const drill = drills.find(d => d.key === key);
    if (!drill) return null;
    drill.name = String(name ?? '').slice(0, MAX_NAME) || drill.name;
    write();
    return drill;
}

/**
 * Replace an AI drill's steps.
 *
 * The one write path the drill editor uses for an `ai_` key, so hand-editing a
 * draft updates the IA record rather than forking a second copy of it.
 */
export function updateAiDrillSteps(key, steps) {
    if (drills === null) drills = read();
    const drill = drills.find(d => d.key === key);
    if (!drill) return null;

    const clean = (Array.isArray(steps) ? steps : [])
        .filter(step => Array.isArray(step) && step.length > 0)
        .map(step => step
            .filter(ball => Array.isArray(ball) && ball.length >= 7)
            .map(ball => ball.slice(0, 11)))
        .filter(step => step.length > 0);
    if (!clean.length) return null;

    drill.steps = clean;
    write();
    return drill;
}

/** The bulk clear behind "clear the IA category". */
export function clearAiDrills() {
    drills = [];
    write();
    return true;
}

/**
 * Move an AI drill into one of the user's own sets, and take it out of the IA
 * category. This is how an AI drill becomes permanently theirs: it is now an
 * ordinary custom drill, in `custom_drills`, and therefore in the CSV export.
 *
 * Deliberately implemented here rather than by dispatching an event, because
 * it is the one place two stores change together and a half-done move would
 * leave a drill that is in neither.
 *
 * @param {string}   key
 * @param {string}   category  'custom-a' | 'custom-b' | 'custom-c'
 * @param {object}   deps      { currentDrills, userCustomDrills, saveDrillsToStorage, setCustomData }
 * @returns {string|null} the new key, or null when it could not be moved
 */
export function moveToCustom(key, category, deps) {
    const drill = getAiDrill(key);
    if (!drill) return null;
    if (!['custom-a', 'custom-b', 'custom-c'].includes(category)) return null;

    const { currentDrills, userCustomDrills, saveDrillsToStorage, setCustomData } = deps;
    if (!currentDrills || !userCustomDrills || !saveDrillsToStorage || !setCustomData) return null;

    if (userCustomDrills[category].length >= 100) return null;

    // A custom key has to be ASCII-folded, because ui.js interpolates it into
    // a [data-key="..."] selector. drillKeyName() is the only thing allowed to
    // produce that string - see AGENTS.md, "Drill names are free text".
    const newKey = `cust_${category.split('-')[1].toUpperCase()}_${drillKeyName(drill.name)}_${Date.now()}`;

    currentDrills[newKey] = { 1: drill.steps, 2: [], 3: [], random: false };
    userCustomDrills[category].push({ name: drill.name, key: newKey });

    setCustomData();
    saveDrillsToStorage();
    deleteAiDrill(key);

    return newKey;
}

// --- the in-memory draft ----------------------------------------------------
//
// Not stored. The assistant may build and play a draft freely; only
// persistDrill() above writes anything. That is the "draft-first" rule in one
// place: there is no code path from a model response to localStorage that does
// not go through persistDrill().

let draft = null;

export function getDraft() {
    return draft;
}

export function setDraft(next) {
    draft = next && Array.isArray(next.steps) && next.steps.length ? next : null;
    return draft;
}

export function clearDraft() {
    draft = null;
}

/**
 * Apply `ops` to the draft. The one place the model's `update_draft` tool
 * touches it, so an out-of-range index is a no-op rather than a corrupt draft.
 */
export function applyDraftOps(ops) {
    if (!draft || !Array.isArray(ops)) return draft;
    const steps = draft.steps.map(step => step.map(ball => ball.slice()));

    for (const op of Array.isArray(ops) ? ops.slice(0, 20) : []) {
        if (!op || typeof op !== 'object') continue;
        const index = Number(op.index);
        switch (op.op) {
            case 'remove':
                if (Number.isInteger(index) && index >= 0 && index < steps.length) {
                    steps.splice(index, 1);
                    draft.meta = (draft.meta || []).filter((_, i) => i !== index);
                }
                break;
            case 'replace': {
                const step = Array.isArray(op.step) ? op.step : null;
                if (Number.isInteger(index) && index >= 0 && index < steps.length && step) {
                    steps[index] = step.map(ball => (Array.isArray(ball) ? ball.slice() : ball));
                }
                break;
            }
            case 'add': {
                const step = Array.isArray(op.step) ? op.step : null;
                if (step) {
                    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, steps.length)) : steps.length;
                    steps.splice(at, 0, step.map(ball => (Array.isArray(ball) ? ball.slice() : ball)));
                    if (draft.meta) draft.meta.splice(at, 0, null);
                }
                break;
            }
            default:
                break;
        }
    }

    draft.steps = steps;
    return draft;
}
