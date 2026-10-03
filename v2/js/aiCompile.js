/**
 * The compiler: an intent (and optionally a matched preset) becomes a real
 * drill step.
 *
 * ## The whole point of this file
 *
 * **No ball array is ever hand-built here.** Every value goes through
 * `makeBall()` in `ball.js`, which is the one place that knows about
 * `normalizeSpin()` (spin is capped by speed - at speed 10 the table takes no
 * spin at all), `bpmToFreq()`, and `maxScatterFor()` (`abs(drop) + scatter <=
 * 10`). That is what makes an invalid array structurally impossible: the model
 * writes intent, the compiler writes the array, and the array cannot be wrong
 * in the ways the editor would otherwise have to repair.
 *
 * ## "corto" / "largo" is a proxy, and the preset wins
 *
 * Short and long are serve-legality properties, not heights - this app has no
 * such flag anywhere. So they map to a height, and **when a preset matched, the
 * matched preset's own height wins**, because a preset is the user's own
 * answer to "how deep do I want this". `preset.depths` is the real source of
 * truth, and only the no-preset path falls back to the nominal table below.
 *
 * ## Intensity is a speed, never a scatter
 *
 * "fuerte" moves `speed` by at most +/-2 and nothing else. Scatter stays the
 * explicit "con dispersion" intent, so an AI-built drill can never surprise you
 * by spraying balls across the table mid-rally.
 *
 * ## The `drop` sign
 *
 * `SIDE_DROP` is the app's own convention and the reason this table is here
 * rather than computed: backhand is a NEGATIVE drop, forehand POSITIVE
 * (`constants.js`: `PUSH_B` is drop -5, `PUSH_F` is drop +5). See the
 * `## The drop sign` block in `ball.js` - it was documented backwards in three
 * files at once once already.
 *
 * Node-safe: no DOM, no storage.
 */

import { makeBall, B, LIMITS, freqToBpm, maxScatterFor } from './ball.js';
import { clamp } from './utils.js';
import {
    sideFromLabel, depthFromLabel, baseFor, expectationFor,
    SIDE_DROP, DEPTH_HEIGHT, SERVE_HEIGHTS, SCATTER_UNITS
} from './aiTerms.js';
import { matchPreset, MATCH_THRESHOLD } from './aiMatch.js';

// Re-exported so the compiler is the one place a caller has to import to ask
// "what does a backhand drop to?". The values themselves live in aiTerms.js,
// which is where the vocabulary and its numbers belong together.
export { SIDE_DROP, DEPTH_HEIGHT };


/**
 * Narrow a preset's axes down to what the sentence asked for.
 *
 * An intent that names a side takes that one placement; one that does not
 * keeps them all, so "saque corto" off a preset with BH/Center/FH is still
 * three placements. An axis with no matching entry falls back to the preset's
 * own drop/height, which is the same anchoring trick as the matcher.
 */
/**
 * The one place rotation becomes a ball type. 'side' maps to backspin because
 * that is the only gear the robot has - sidespin is the head turned by hand,
 * and the step says so rather than pretending the machine did it.
 */
const typeFor = rotation => (rotation === 'back' || rotation === 'side') ? 'back' : 'top';

/**
 * Does this preset at least agree with the intent about WHICH WAY IT SPINS?
 *
 * The matcher has always weighed rotation, but a preset the MODEL names used
 * to be taken on trust, so the weighting was skipped exactly when it was
 * needed most. A disagreement is not a near miss worth tolerating: back and
 * top are different balls, and quietly swapping one for the other produces a
 * drill that plays something the user did not ask for and will not notice
 * until the robot does it.
 */
function agreesOnRotation(intent, preset) {
    if (!intent.rotation || !preset || !preset.type) return true;
    return typeFor(intent.rotation) === preset.type;
}

function resolveAxes(preset, intent) {
    const placements = (preset.placements || []).filter(Boolean);
    const depths = (preset.depths || []).filter(Boolean);

    const wantedSide = intent.side
        ? placements.find(p => sideFromLabel(p.label) === intent.side)
        : null;
    const wantedDepth = intent.depth
        ? depths.find(d => depthFromLabel(d.label) === intent.depth)
        : null;

    // **A serve's height comes from the serve band, never from the preset.**
    // Everywhere else a preset owns the height - it is the user's own answer to
    // "how deep" - but a serve is played DOWN (-35 short, -50 long) and every
    // preset's depth axis is positive, written for a rally ball. Letting the
    // preset win here is how "saque corto al reves" came out at +35 and "saque
    // largo" at +75: the sign correction in SERVE_HEIGHTS was simply being
    // overridden by the match, and the assistant produced rallies labelled as
    // serves.
    //
    // The preset still supplies everything that makes it that serve - speed,
    // spin, type, and the lateral drop. Only the vertical band is not the
    // preset's to decide, because the band is what "serve" means.
    const serveHeight = intent.role === 'serve'
        ? (SERVE_HEIGHTS[intent.depth] ?? SERVE_HEIGHTS.mid)
        : null;

    return {
        drops: placements.length
            ? (wantedSide ? [wantedSide.drop] : placements.map(p => p.drop))
            : [preset.drop],
        heights: serveHeight !== null
            ? [serveHeight]
            : depths.length
                ? (wantedDepth ? [wantedDepth.height] : depths.map(d => d.height))
                : [preset.height]
    };
}

/** The one configuration a ball is built from, before `makeBall()`. */
function configFor(intent, match) {
    const base = baseFor(intent);
    const preset = match?.preset || null;

    // A preset is the user's own answer to "how hard, how deep, how far", so it
    // owns speed, spin and type. Intensity is the only thing that still moves
    // a matched ball, and it moves both by the same bounded amount - which is
    // the point: "fuerte" is a modifier, not a different ball.
    const want = expectationFor(intent);
    const bump = want.speed - base.speed;
    const speed = (preset ? preset.speed : base.speed) + bump;
    const spin = preset ? preset.spin : base.spin;

    let type = preset ? preset.type : base.type;
    if (intent.rotation) type = typeFor(intent.rotation);
    if (intent.rotation === 'flat') type = 'top';

    const { drops, heights } = preset
        ? resolveAxes(preset, intent)
        : { drops: [want.drop ?? 0], heights: [want.height ?? base.height] };

    // depth is the outer loop, so the balls read top to bottom like the
    // preset expansion in presets.js does.
    const out = [];
    for (const height of heights) {
        for (const drop of drops) {
            out.push({
                speed: clamp(speed, ...LIMITS.speed),
                spin: clamp(spin, 0, 10),
                type,
                height: clamp(height, ...LIMITS.height),
                drop: clamp(drop, ...LIMITS.drop),
                bpm: clamp(intent.bpm ?? base.bpm, ...LIMITS.bpm),
                reps: clamp(intent.reps ?? 1, ...LIMITS.reps),
                scatter: 0,
                active: 1
            });
        }
    }

    // Scatter is opt-in and applied last, so it can only ever shrink to fit.
    if (intent.scatter) {
        for (const cfg of out) {
            cfg.scatter = Math.min(SCATTER_UNITS, maxScatterFor(cfg.drop));
        }
    }

    return out;
}

/**
 * Compile one intent into steps.
 *
 * @param {object} intent
 * @param {object|null} [match]  what `matchPreset()` returned
 * @returns {Array<step>}  an array of steps, each an array of variant balls
 */
export function compile(intent, match = null) {
    if (!intent) return [];
    const configs = configFor(intent, match && match.preset ? match : null);
    if (!configs.length) return [];

    // makeBall() is the only thing that builds a ball. Everything above this
    // line is intent and defaults; everything below is the real array.
    const balls = configs.map(cfg => makeBall(cfg));

    // `variants` collapses the expansion into one multi-variant step the runner
    // picks from at random; `sequence` (and the default) keeps one ball per
    // step, in order. Same three modes as the editor's preset buttons.
    if (intent.variants === 'variants' && balls.length > 1) return [balls];
    return balls.map(b => [b]);
}

/**
 * Everything the panel needs to show about one compiled step, without any
 * translation in it. `aiUi.js` turns `label` into a sentence with `t()`.
 *
 * @returns {{presetId: string|null, presetName: string|null, usedFallback: boolean,
 *            speed: number, spin: number, type: string, bpm: number, reps: number,
 *            height: number, drop: number, balls: number}}
 */
export function stepFacts(intent, match, steps) {
    const first = steps?.[0]?.[0];
    const preset = match?.preset || null;
    const usedFallback = !preset;

    return {
        presetId: preset?.id ?? null,
        presetName: preset?.name ?? null,
        usedFallback,
        score: match?.score ?? null,
        balls: (steps || []).reduce((n, step) => n + step.length, 0),
        speed: first ? first[B.SPEED] : null,
        spin: first ? first[B.SPIN] : null,
        type: first ? first[B.TYPE] : null,
        bpm: first ? freqToBpm(first[B.FREQ]) : null,
        reps: first ? first[B.REPS] : null,
        height: first ? first[B.HEIGHT] : null,
        drop: first ? first[B.DROP] : null
    };
}

/**
 * The whole draft: a name, the steps, and the per-step facts the panel reads.
 *
 * `name` is whatever was asked for, stored as typed. It is model text at the
 * far end of a network call, so the caller must treat it as hostile - see
 * `aiStore.js`, where the key is minted from the clock and never from this
 * string, and `aiUi.js`, which renders it with `textContent`.
 *
 * @param {object}   spec
 * @param {Array}    spec.intents
 * @param {string}   [spec.name]
 * @param {Array}    [spec.presets]  the library, for matching
 */
export function buildPlan({ intents, name = '', presets = [] } = {}) {
    const list = Array.isArray(intents) ? intents : [];
    const steps = [];
    const meta = [];

    for (const intent of list) {
        // An intent the model handed us already names a preset; trust that over
        // re-matching it, but still verify the preset exists.
        let match = null;
        if (intent.presetId) {
            const named = presets.find(p => p && p.id === intent.presetId);
            // ...and verify it does not CONTRADICT the intent. "saque cortado
            // corto al reves" came back as "Topspin loop" because a model that
            // picked a preset took its speed and spin wholesale, and a loop is
            // the one ball in the library whose spin is not backspin. Naming a
            // preset is a preference; naming one that is the other rotation is
            // not, and silently honouring it makes the drill play a loop.
            if (named && agreesOnRotation(intent, named)) match = { preset: named, score: 0 };
        }
        if (!match) match = matchPreset(intent, presets, { threshold: MATCH_THRESHOLD });

        const compiled = compile(intent, match);
        if (!compiled.length) continue;

        steps.push(...compiled);
        meta.push({ intent, ...stepFacts(intent, match, compiled) });
    }

    return { name: String(name ?? ''), steps, meta };
}
