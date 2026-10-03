/**
 * Deterministic preset matching.
 *
 * Given an intent and the user's own library, decide which preset is the best
 * stand-in for it - or say there isn't one, so the compiler builds the ball
 * from defaults and the assistant *says so out loud* rather than quietly
 * inventing something and presenting it as the user's own preset.
 *
 * This is the same function the model tier is handed as a tool
 * (`search_presets`), so the model never has to guess which of the user's
 * presets a sentence means: it asks, and gets the same answer Tier 0 would.
 *
 * ## Why a score and not a lookup
 *
 * The eight shipped presets are all named in English, so matching on the word
 * "cortado" cannot work - what actually carries it is `preset.type === 'back'`
 * together with `preset.spin > 2`. Every term below is therefore geometric:
 * how far is this preset from the thing that was asked for. Nothing here reads
 * a name, so a library of presets the user renamed in Spanish works exactly as
 * well as the shipped one.
 *
 * ## Anchoring, not snapping
 *
 * `d(depth)` and `d(side)` prefer a *matching axis entry* in
 * `preset.placements` / `preset.depths` by label - `BH`/`Center`/`FH` and
 * `Short`/`Mid`/`Long`, which is what `standardPlacements()` and
 * `standardDepths()` write - and fall back to comparing `preset.drop` /
 * `preset.height` against the nominal value. That is the same
 * "re-anchor on whatever you are editing" trick the preset editor already
 * uses, and it means a preset whose axes were moved still matches.
 *
 * Node-safe: no DOM, no storage.
 */

import { clamp } from './utils.js';
import { expectationFor } from './aiTerms.js';

/**
 * How much each axis is allowed to matter. Rotation dominates because it is
 * the one that changes what the ball does; side and depth are the two axes the
 * app actually has to place a ball with, so they are not decoration either.
 */
const WEIGHTS = { rotation: 0.45, intensity: 0.20, depth: 0.20, side: 0.15 };

/**
 * The distance below which a preset is close enough to use. Above it the
 * assistant invents a ball from the compiler's defaults and flags the step
 * `usedFallback`, which is what makes "no encontré un preset, lo generé"
 * something it can say honestly.
 */
export const MATCH_THRESHOLD = 0.28;

/** Rotation -> the `type` slot of the ball array. `side` is backspin. */
function typeFor(rotation) {
    return rotation === 'back' || rotation === 'side' ? 'back' : 'top';
}

/**
 * How far the preset's spin is from the rotation that was asked for.
 *
 * "cortado" asks for backspin, and backspin is a ball with some on it - so
 * the target is a LOADED ball rather than the middle of the range. Proximity
 * to a midpoint would score a dead push and a heavy backspin push equally,
 * which is exactly backwards for the one word this has to get right.
 */
const WANT_SPIN = { back: 3.5, side: 3, top: 2.5 };

function rotationDistance(preset, rotation) {
    if (!rotation) return 0;
    if (preset.type !== typeFor(rotation)) return 1;
    // "flat" means a ball with no spin on it at all, which is a narrow ask.
    if (rotation === 'flat') return preset.spin <= 0.5 ? 0 : 0.8;
    return clamp(Math.abs(preset.spin - (WANT_SPIN[rotation] ?? 2.5)) / 5, 0, 1);
}

/** `|preset.speed - target| / 10`, the plan's definition. */
function intensityDistance(preset, target) {
    if (target === null || target === undefined) return 0;
    return clamp(Math.abs(preset.speed - target) / 10, 0, 1);
}

/**
 * How far the preset is from the depth that was asked for.
 *
 * **A serve is scored against its DEPTH LABEL, not its ball height.** A serve
 * height is negative - a service is played down onto the receiver's half - and
 * a rally preset's height is positive, so comparing the two numbers measures
 * nothing at all and saturates the term: `|50 - (-35)| / 60` clamps to 1, and
 * every preset is pushed past MATCH_THRESHOLD for being a rally shot. Serves
 * stopped matching presets entirely when the heights were corrected.
 *
 * The labels are the right comparison and the module already preferred them:
 * `standardDepths()` writes `Short` / `Mid` / `Long`, and those are the words a
 * sentence uses. A preset with a `Long` depth entry is a better stand-in for a
 * long serve than one without, and a preset with no depth axis says nothing
 * about it - which is neutral, not disqualifying.
 */
function depthDistance(preset, nominal, intent = null) {
    if (intent?.role === 'serve' && intent.depth) {
        const wanted = String(intent.depth).toLowerCase();
        const entries = Array.isArray(preset.depths) ? preset.depths : [];
        if (!entries.length) return 0;
        const hit = entries.some(d => String(d.label || '').toLowerCase() === wanted);
        return hit ? 0 : 1;
    }
    if (nominal === null || nominal === undefined) return 0;
    return clamp(Math.abs((preset.height ?? 50) - nominal) / 60, 0, 1);
}

function sideDistance(preset, nominal) {
    if (nominal === null || nominal === undefined) return 0;
    return clamp(Math.abs((preset.drop ?? 0) - nominal) / 10, 0, 1);
}

/** The four distances plus the weighted average, for the tool trace. */
export function scorePreset(intent, preset) {
    const want = expectationFor(intent);
    const parts = {
        rotation: rotationDistance(preset, intent.rotation),
        intensity: intensityDistance(preset, want.speed),
        depth: depthDistance(preset, want.height, intent),
        side: sideDistance(preset, want.drop)
    };

    // Only the slots the sentence actually mentioned are allowed to vote.
    // An intent that says nothing about spin should not be pushed away from
    // every backspin preset by a penalty for not having said so.
    const relevant = {
        rotation: !!intent.rotation,
        // Speed always votes, because a serve and a rally push differ mostly
        // in speed and the role already tells us which one was meant.
        intensity: want.speed !== undefined,
        depth: !!intent.depth,
        side: !!intent.side
    };

    let total = 0;
    let weight = 0;
    for (const slot of Object.keys(WEIGHTS)) {
        if (!relevant[slot]) continue;
        total += WEIGHTS[slot] * parts[slot];
        weight += WEIGHTS[slot];
    }

    return { score: weight ? total / weight : 1, parts, relevant };
}

/**
 * The best preset for an intent, or `null`.
 *
 * @param {object} intent
 * @param {Array}  presets
 * @param {object} [opts]
 * @param {number} [opts.threshold]
 * @returns {{preset: object, score: number, parts: object}|null}
 */
export function matchPreset(intent, presets, { threshold = MATCH_THRESHOLD } = {}) {
    if (!intent || !Array.isArray(presets) || !presets.length) return null;

    let best = null;
    for (const preset of presets) {
        if (!preset || typeof preset !== 'object') continue;
        const { score, parts, relevant } = scorePreset(intent, preset);
        if (!best || score < best.score) best = { preset, score, parts, relevant };
    }

    if (!best || best.score > threshold) return null;
    return best;
}

/**
 * The same ranking, unfiltered - what `search_presets` returns so the model can
 * see how close the runners-up were instead of only being told yes or no.
 */
export function rankPresets(intent, presets, limit = 5) {
    if (!intent || !Array.isArray(presets)) return [];
    return presets
        .filter(p => p && typeof p === 'object')
        .map(preset => ({ preset, ...scorePreset(intent, preset) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map(({ preset, score, parts }) => ({ id: preset.id, name: preset.name, score, parts }));
}
