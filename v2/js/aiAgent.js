/**
 * The agent's tools.
 *
 * ## The rule this file exists to enforce
 *
 * **No tool writes a ball array, and no tool writes `currentDrills`.** The
 * model composes INTENT; `aiCompile.js` turns intent into a real array through
 * `makeBall()`, which is the only thing that clamps spin against speed and
 * scatter against drop. `persist_draft` is the single funnel into storage, and
 * it is the user's decision, not the model's - the assistant may *propose*,
 * and `ask_user` is how it asks.
 *
 * The tools are ordinary OpenAI function-calling schemas, so the model can
 * only choose from a fixed vocabulary of verbs. It cannot invent one: an
 * unknown tool name is reported back to it rather than executed.
 *
 * ## What is deliberately absent
 *
 * There is no `set_ball`, no `set_speed`, no `write_drill`. Everything numeric
 * a model could say is a field of an intent object, and every one of those
 * fields is validated by `normalizeIntent()` below before it reaches the
 * compiler. A model that sends `speed: 99` gets the field dropped, not a robot
 * that tries to spin at 99.
 *
 * ## Confirmation policy (the plan's Q4, decided)
 *
 *   - **free:** play a draft, read anything, search presets, compose a draft,
 *     rename it. Nothing durable changes.
 *   - **ask once, then remember for the turn:** `persist_draft`. The assistant
 *     proposes, the user taps or says yes.
 *   - **ask every time:** anything that deletes or overwrites something the
 *     user made - `delete_preset`, `update_preset` on a non-AI preset, and
 *     clearing the IA category.
 *
 * `CONFIRM` is the single list that says so, so a tool cannot quietly become
 * destructive by omission.
 */

import {
    intentLabel, ROLES, ROTATIONS, SIDES, DEPTHS, NEUTRAL_INTENSITY
} from './aiTerms.js';
import { matchPreset, rankPresets } from './aiMatch.js';
import { buildPlan, compile } from './aiCompile.js';
import { getPresets, getPresetById, addPreset, updatePreset, deletePreset, presetFromBall } from './presets.js';
import {
    getDraft, setDraft, clearDraft, applyDraftOps, persistDrill,
    getAiDrills, deleteAiDrill, clearAiDrills
} from './aiStore.js';
import { currentDrills, userCustomDrills, drillOrder } from './state.js';

/** Tools that need the user to say yes first. See the policy above. */
export const CONFIRM = new Set([
    'delete_preset',
    'clear_ia_drills',
    'delete_ai_drill',
    'update_preset'
]);

// --- intent validation ------------------------------------------------------

/**
 * Announce a change to the rest of the app.
 *
 * `aiAgent.js` imports cleanly under bare Node (tests/ai-client.test.mjs does
 * exactly that) and there is no document there. These events are a browser
 * convenience - they make open screens redraw - and a missing one must not
 * turn a tool call into a crash.
 */
const announce = (name) => {
    try {
        document.dispatchEvent(new CustomEvent(name));
    } catch { /* no DOM: nothing is listening anyway */ }
};

/** The same ceiling `aiStore` applies, so a name is not cut twice. */
const MAX_NAME = 40;

const oneOf = (value, allowed, fallback = null) =>
    allowed.includes(value) ? value : fallback;

const num = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Coerce whatever the model sent into a valid intent, or `null`.
 *
 * This is the boundary where untrusted output becomes the app's own model, and
 * it is deliberately total: every field is either recognised and clamped, or
 * dropped. A model that sends `{role: 'nuke', intensity: 999}` gets
 * `{intensity: 10}` and no role, and the compiler then falls back to a serve -
 * it does not get a drill it asked for.
 */
export function normalizeIntent(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const role = oneOf(raw.role, ROLES);
    if (!role) return null;

    const intent = {
        role,
        rotation: oneOf(raw.rotation, ROTATIONS),
        side: oneOf(raw.side, SIDES),
        depth: oneOf(raw.depth, DEPTHS),
        intensity: num(raw.intensity, 0, 10, NEUTRAL_INTENSITY),
        bpm: null,
        reps: null,
        variants: oneOf(raw.variants, ['single', 'variants', 'sequence'], null),
        scatter: raw.scatter === true
    };

    if (raw.bpm !== undefined && raw.bpm !== null) intent.bpm = num(raw.bpm, 30, 90, null);
    if (raw.reps !== undefined && raw.reps !== null) intent.reps = num(raw.reps, 1, 200, null);

    // A preset the model named is only honoured if it exists.
    if (typeof raw.presetId === 'string') {
        const found = getPresetById(raw.presetId);
        if (found) intent.presetId = found.id;
    }

    // Free text, because it is shown back to the user - and it is RENDERED WITH
    // textContent everywhere it is displayed. Length-capped here so a model
    // cannot park a megabyte of text in a step.
    if (typeof raw.note === 'string') intent.note = raw.note.slice(0, 200);

    return intent;
}

const normalizeIntents = (list) => (Array.isArray(list) ? list : [])
    .map(normalizeIntent)
    .filter(Boolean);

/** A name for a draft: the model's, if it gave one, or something honest. */
function safeName(raw, fallback) {
    if (typeof raw !== 'string') return fallback;
    // Kept verbatim, because stored data is the user's own text and the app
    // never translates it. The KEY is minted from the clock instead - see
    // aiStore.newAiDrillKey() - so nothing hostile reaches a selector.
    const flat = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (flat.length <= MAX_NAME) return flat || fallback;
    // Cut on a WORD. A live draft came back as
    // "Push suave al reves + drive fuerte a la " - a 40-character slice landed
    // mid-phrase, and a name that stops in the middle of a word reads as a bug
    // rather than as a limit. Falling back to the hard slice only if the last
    // word is absurdly long keeps the length bounded either way.
    const cut = flat.slice(0, MAX_NAME);
    const boundary = cut.lastIndexOf(' ');
    return (boundary > MAX_NAME * 0.5 ? cut.slice(0, boundary) : cut).trim() || fallback;
}

// --- the schemas ------------------------------------------------------------

const intentShape = {
    type: 'object',
    properties: {
        role: { type: 'string', enum: ROLES, description: 'What the ball does. "serve" and "push" are the same spoken word: use "serve" when a depth word is present, "push" for the rally shot.' },
        rotation: { type: 'string', enum: ROTATIONS },
        side: { type: 'string', enum: SIDES, description: 'From the receiver\'s view: backhand is a negative drop, forehand positive.' },
        depth: { type: 'string', enum: DEPTHS },
        intensity: { type: 'number', minimum: 0, maximum: 10, description: '5 is neutral. Never use it for scatter.' },
        bpm: { type: 'integer', minimum: 30, maximum: 90 },
        reps: { type: 'integer', minimum: 1, maximum: 200 },
        variants: { type: 'string', enum: ['single', 'variants', 'sequence'] },
        scatter: { type: 'boolean', description: 'Only when the user explicitly asked for dispersion.' },
        presetId: { type: 'string', description: 'Only if search_presets returned it.' },
        note: { type: 'string' }
    },
    required: ['role']
};

export const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'list_presets',
            description: 'The user\'s own preset library. Call this before saying you could not find a preset.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_presets',
            description: 'Deterministically rank the user\'s presets against an intent. Returns candidates and scores.',
            parameters: {
                type: 'object',
                properties: { intent: intentShape },
                required: ['intent']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_drills',
            description: 'The user\'s saved drills, by name.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_drill',
            description: 'One saved drill by key.',
            parameters: {
                type: 'object',
                properties: { key: { type: 'string' } },
                required: ['key']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'compose_drill',
            description: 'The main one. Turn intents into a draft. Returns the compiled steps, which preset was used per step, and a spoken readout.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'A short name for the drill. Free text.' },
                    steps: { type: 'array', items: intentShape },
                    use_presets: { type: 'boolean', description: 'Default true. Set false to ignore the library.' }
                },
                required: ['steps']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_draft',
            description: 'Add, remove or replace a step of the current draft, by index.',
            parameters: {
                type: 'object',
                properties: {
                    ops: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                op: { type: 'string', enum: ['add', 'remove', 'replace'] },
                                index: { type: 'integer' },
                                step: { type: 'array', items: intentShape }
                            },
                            required: ['op']
                        }
                    }
                },
                required: ['ops']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_draft_name',
            description: 'Rename the current draft.',
            parameters: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_preset',
            description: 'Compile one step into a new preset, so the second time the user asks for it is free.',
            parameters: {
                type: 'object',
                properties: { name: { type: 'string' }, intent: intentShape },
                required: ['name', 'intent']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_preset',
            description: 'Change an existing preset. Asks the user first if it is one they made.',
            parameters: {
                type: 'object',
                properties: { id: { type: 'string' }, patch: { type: 'object' } },
                required: ['id', 'patch']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_preset',
            description: 'Delete a preset. Always asks the user first.',
            parameters: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'open_draft_in_editor',
            description: 'Materialise the draft into a real drill and open the normal editor on it.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'persist_draft',
            description: 'Save the draft into the IA category. The USER decides; propose and stop.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'discard_draft',
            description: 'Throw the draft away.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'play_draft',
            description: 'Play the draft on the robot. Needs a connection; nothing durable changes.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'play_drill',
            description: 'Play a saved drill by key.',
            parameters: {
                type: 'object',
                properties: { key: { type: 'string' } },
                required: ['key']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'ask_user',
            description: 'Ask the user a question with tappable options. The answer comes back to you.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string' },
                    options: { type: 'array', items: { type: 'string' } }
                },
                required: ['question']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'clear_ia_drills',
            description: 'Delete every drill in the IA category. Always asks the user first.',
            parameters: { type: 'object', properties: {} }
        }
    }
];

// --- the implementations ----------------------------------------------------

/**
 * A read-only view of the user\'s drills, for the model. Factory keys are the
 * storage keys, exactly as they are in the CSV - the app never translates
 * stored data.
 */
function drillSummaries() {
    const out = [];
    for (const cat of ['basic', 'combined', 'complex', 'custom-a', 'custom-b', 'custom-c']) {
        const list = cat.startsWith('custom') ? userCustomDrills[cat] : (drillOrder[cat] || []);
        for (const key of list) {
            if (!currentDrills[key]) continue;
            out.push({ key, name: (list.find?.(d => d.key === key)?.name) || key, set: cat });
        }
    }
    return out.slice(0, 120);
}

/**
 * The tool implementations.
 *
 * `ask` is the panel's confirmation hook: `ask({question, options})` resolves
 * with what the user tapped, so `ask_user` re-enters the loop with their
 * answer. The handlers are `async` because of it - `runAgent` already awaits
 * every tool result - which is the difference between a tool that asks and a
 * tool that assumes.
 *
 * With no `ask` hook installed - the unit tests, and the app before Phase 5
 * wires one - the destructive tools resolve as declined, so the safe default
 * is "do nothing", not "delete the user's preset".
 */
export function makeToolHandlers({ ask = null, onTrace = null, onDraft = null } = {}) {
    const trace = (kind, params) => { if (onTrace) onTrace(kind, params); };
    const confirmed = async (question, options = ['yes', 'no']) => {
        if (!ask) return false;
        const answer = await ask({ question, options });
        return answer === true || answer === 'yes';
    };

    return {
        list_presets() {
            const list = getPresets().map(p => ({
                id: p.id,
                name: p.name,
                speed: p.speed,
                spin: p.spin,
                type: p.type,
                bpm: p.bpm,
                origin: p.origin === 'ai' ? 'ai' : 'user'
            }));
            return { presets: list };
        },

        search_presets(args) {
            const intent = normalizeIntent(args?.intent);
            if (!intent) return { candidates: [], note: 'That intent was not usable.' };
            const ranked = rankPresets(intent, getPresets(), 5);
            const best = matchPreset(intent, getPresets());
            return {
                chosen: best ? { id: best.preset.id, name: best.preset.name, score: best.score } : null,
                candidates: ranked
            };
        },

        list_drills() {
            return { drills: drillSummaries() };
        },

        get_drill(args) {
            const drill = currentDrills[args?.key];
            if (!drill) return { error: 'No such drill.' };
            const level = drill[1] || [];
            return {
                key: args.key,
                random: !!drill.random,
                steps: level.length,
                balls: level.reduce((n, step) => n + step.length, 0)
            };
        },

        /**
         * The main tool. Composes the draft and returns a readout the model
         * can read out loud, including WHICH preset each step used - so "I
         * used your Safe push" is a fact rather than a claim.
         */
        compose_drill(args) {
            const intents = normalizeIntents(args?.steps);
            if (!intents.length) return { error: 'No usable step in that request.' };

            const usePresets = args?.use_presets !== false;
            const plan = buildPlan({
                intents,
                name: safeName(args?.name, ''),
                presets: usePresets ? getPresets() : []
            });
            if (!plan.steps.length) return { error: 'That produced no playable steps.' };

            setDraft(plan);
            if (onDraft) onDraft(plan);
            trace('composed', { n: plan.steps.length });

            return {
                name: plan.name,
                steps: plan.steps.length,
                detail: plan.meta.map(m => ({
                    label: intentLabel(m.intent, 'en'),
                    preset: m.usedFallback ? null : m.presetName,
                    generated: m.usedFallback,
                    speed: m.speed,
                    spin: m.spin,
                    type: m.type,
                    bpm: m.bpm,
                    reps: m.reps
                }))
            };
        },

        update_draft(args) {
            const ops = (Array.isArray(args?.ops) ? args.ops : []).slice(0, 20).map(op => {
                if (!op || typeof op !== 'object') return null;
                if (op.op === 'add' || op.op === 'replace') {
                    const step = (Array.isArray(op.step) ? op.step : [op.step])
                        .map(normalizeIntent).filter(Boolean);
                    // Recompile rather than trusting a model-supplied array.
                    const compiled = step.flatMap(i => compile(i, matchPreset(i, getPresets())));
                    return { op: op.op, index: Number.isInteger(op.index) ? op.index : undefined, step: compiled };
                }
                return { op: op.op, index: Number.isInteger(op.index) ? op.index : undefined };
            }).filter(Boolean);

            if (!ops.length) return { error: 'Nothing to change.' };
            const draft = applyDraftOps(ops);
            if (onDraft) onDraft(draft);
            return { steps: draft ? draft.steps.length : 0 };
        },

        set_draft_name(args) {
            const draft = getDraft();
            if (!draft) return { error: 'There is no draft.' };
            draft.name = safeName(args?.name, draft.name);
            if (onDraft) onDraft(draft);
            return { name: draft.name };
        },

        /**
         * Compiling a step into a preset is what makes the second request free,
         * and it is why `origin: 'ai'` exists. The ball itself comes from
         * `compile()` - never from anything the model wrote.
         */
        create_preset(args) {
            const intent = normalizeIntent(args?.intent);
            if (!intent) return { error: 'That intent was not usable.' };
            const name = safeName(args?.name, '');
            if (!name) return { error: 'The preset needs a name.' };

            const match = matchPreset(intent, getPresets());
            const step = compile(intent, match)[0]?.[0];
            if (!step) return { error: 'That did not compile to a ball.' };

            const preset = addPreset(presetFromBall(step, name));
            if (!preset) return { error: 'The preset could not be saved.' };
            // origin is additive: the preset CSV header is a compatibility
            // surface and does not carry it, but the JSON export and the
            // in-memory model do.
            preset.origin = 'ai';
            announce('presets-updated');
            trace('created', { name });
            return { id: preset.id, name: preset.name, origin: 'ai' };
        },

        async update_preset(args) {
            const existing = getPresetById(args?.id);
            if (!existing) return { error: 'No such preset.' };
            // "ask every time for anything that overwrites something the user
            // made" - so an AI-made preset can be adjusted freely, and a
            // hand-built one cannot be touched without a yes.
            if (existing.origin !== 'ai' && !await confirmed(`Change the preset “${existing.name}”?`)) {
                return { error: 'The user declined.' };
            }
            const patch = { ...(args?.patch || {}) };
            delete patch.id;
            const updated = updatePreset(existing.id, patch);
            announce('presets-updated');
            return updated ? { id: updated.id, name: updated.name } : { error: 'Could not update it.' };
        },

        async delete_preset(args) {
            const existing = getPresetById(args?.id);
            if (!existing) return { error: 'No such preset.' };
            if (!await confirmed(`Delete the preset “${existing.name}”?`)) {
                return { error: 'The user declined.' };
            }
            const name = existing.name;
            const done = deletePreset(existing.id);
            announce('presets-updated');
            return done ? { deleted: name } : { error: 'Could not delete it.' };
        },

        open_draft_in_editor() {
            if (typeof window === 'undefined') return { error: 'Not available here.' };
            window.aiOpenInEditor();
            return { opened: true };
        },

        /** The only funnel into storage, and the user's decision. */
        async persist_draft() {
            const draft = getDraft();
            if (!draft) return { error: 'There is no draft to save.' };
            // Ask ONCE, then remember for the turn: the assistant proposes, and
            // the user taps or says yes. It may not save one unprompted.
            if (!await confirmed('Save this drill to the IA tab?')) {
                return { error: 'The user declined.' };
            }
            const saved = persistDrill({ name: draft.name, steps: draft.steps, source: 'model', plan: draft.meta });
            if (!saved) return { error: 'It could not be saved.' };
            announce('ai-drills-updated');
            trace('persisted', { name: saved.name });
            return { key: saved.key, name: saved.name };
        },

        discard_draft() {
            clearDraft();
            if (onDraft) onDraft(null);
            return { discarded: true };
        },

        play_draft() {
            if (typeof window === 'undefined') return { error: 'Not available here.' };
            const started = window.aiPlayDraft();
            return started ? { playing: true } : { error: 'The robot is not connected.' };
        },

        play_drill(args) {
            if (typeof window === 'undefined') return { error: 'Not available here.' };
            if (!currentDrills[args?.key]) return { error: 'No such drill.' };
            window.handleDrillClick(args.key, document.createElement('button'));
            return { playing: true, key: args.key };
        },

        async ask_user(args) {
            if (!ask) return { error: 'Nothing can answer that here.' };
            return { answer: await ask({ question: String(args?.question || ''), options: args?.options || [] }) };
        },

        async clear_ia_drills() {
            if (!await confirmed('Delete every drill in the IA category?')) {
                return { error: 'The user declined.' };
            }
            const n = getAiDrills().length;
            clearAiDrills();
            announce('ai-drills-updated');
            return { cleared: n };
        },

        async delete_ai_drill(args) {
            if (!await confirmed('Delete that drill?')) return { error: 'The user declined.' };
            const done = deleteAiDrill(args?.key);
            announce('ai-drills-updated');
            return done ? { deleted: args.key } : { error: 'No such drill.' };
        }
    };
}

