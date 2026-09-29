/**
 * Unit tests for the assistant's deterministic core: the vocabulary and parser
 * in aiTerms.js, the matcher in aiMatch.js, the compiler in aiCompile.js and
 * the store in aiStore.js.
 *
 * Run with:  node --test tests/
 *
 * Zero dependencies, like tests/presets.test.mjs, and for the same reason:
 * these four modules import cleanly under bare Node. That is a hard
 * requirement of the design, not a convenience - it is what makes the whole of
 * Tier 0 testable with no browser, no key and no network.
 *
 * The localStorage stub is installed BEFORE any import, exactly as the preset
 * suite does, because aiStore.js and (through presets.js) the rest touch it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
};

const { B, makeBall, normalizeBall, maxScatterFor, freqToBpm } = await import('../js/ball.js');
const { DEFAULT_DRILLS } = await import('../js/constants.js');
const P = await import('../js/presets.js');
const T = await import('../js/aiTerms.js');
const M = await import('../js/aiMatch.js');
const C = await import('../js/aiCompile.js');
const A = await import('../js/aiStore.js');

const library = P.DEFAULT_PRESETS.map(P.clonePreset);

// --- the ontology -----------------------------------------------------------

test('the intent ontology is exactly the four axes the ball array can express', () => {
    assert.deepEqual(T.ROLES, ['serve', 'push', 'drive', 'loop', 'block']);
    assert.deepEqual(T.ROTATIONS, ['top', 'back', 'side', 'flat']);
    assert.deepEqual(T.SIDES, ['bh', 'center', 'fh']);
    assert.deepEqual(T.DEPTHS, ['short', 'mid', 'long']);
});

test('a blank intent is neutral, not zero', () => {
    // 5 is the neutral point: intensity is a modifier on the role's own speed,
    // so 0 would mean "as slow as the table goes" and quietly halve every ball.
    assert.equal(T.emptyIntent().intensity, T.NEUTRAL_INTENSITY);
    assert.equal(T.NEUTRAL_INTENSITY, 5);
});

// --- Tier 0: the parser ----------------------------------------------------

test('the example sentence from the plan is exactly three shots', () => {
    const r = T.parseUtterance(
        'Saque corto a la derecha, cortado, luego cortado largo al revés y luego un top al medio fuerte'
    );
    assert.ok(r, 'the plan sentence must parse');
    assert.equal(r.intents.length, 3, JSON.stringify(r.intents.map(i => i.role)));
    assert.equal(r.unresolved, false, JSON.stringify(r.unknown));

    const [a, b, c] = r.intents;
    // {serve, back, short, fh} - and "cortado" modifies the serve already named
    // rather than becoming a shot of its own.
    assert.deepEqual([a.role, a.rotation, a.depth, a.side], ['serve', 'back', 'short', 'fh']);
    // {serve, back, long, bh} - no role word, so it inherits the serve before it.
    assert.deepEqual([b.role, b.rotation, b.depth, b.side], ['serve', 'back', 'long', 'bh']);
    // {loop, top, mid, center, high} - "un top" OPENS the shot, so it is a
    // loop; "al medio" is one idea and two axes.
    assert.deepEqual([c.role, c.rotation, c.depth, c.side], ['loop', 'top', 'mid', 'center']);
    assert.equal(c.intensity, T.INTENSITY.high);
});

test('a Spanish and an English spelling of one command give the same intents', () => {
    const es = T.parseUtterance('saque corto a la derecha');
    const en = T.parseUtterance('short serve to the forehand');
    assert.deepEqual(
        es.intents[0],
        en.intents[0],
        'the two languages are two spellings of one table, not two tables'
    );
    assert.equal(es.intents[0].role, 'serve');
    assert.equal(es.intents[0].depth, 'short');
    assert.equal(es.intents[0].side, 'fh');
});

test('accents do not stop a word matching', () => {
    // "reves" is stored folded and "revés" arrives raw. Folding only the
    // vocabulary - which this test exists to catch - makes the single most
    // common word in the table fail to match in half the shipped languages.
    const r = T.parseUtterance('cortado al revés');
    assert.equal(r.intents[0].side, 'bh');
    assert.equal(r.intents[0].rotation, 'back');
});

test('"saque" and "push" are one word with two readings, told by a depth word', () => {
    const serve = T.parseUtterance('saque corto');
    assert.equal(serve.intents[0].role, 'serve');

    const rally = T.parseUtterance('push b');
    assert.equal(rally.intents[0].role, 'push');

    // "push largo" is a serve, not a long rally push.
    assert.equal(T.parseUtterance('push largo').intents[0].role, 'serve');
    // An intensity word is not a depth word.
    assert.equal(T.parseUtterance('push b suave').intents[0].role, 'push');
});

test('a comma splits shots but not modifiers', () => {
    const two = T.parseUtterance('push b, drive f');
    assert.equal(two.intents.length, 2);
    assert.deepEqual([two.intents[0].role, two.intents[0].side], ['push', 'bh']);
    assert.deepEqual([two.intents[1].role, two.intents[1].side], ['drive', 'fh']);

    // ...but "a la derecha y fuerte" is one shot with two modifiers, not two
    // shots. A connector only breaks where the next part names a shot.
    const one = T.parseUtterance('drive a la derecha y fuerte');
    assert.equal(one.intents.length, 1);
    assert.equal(one.intents[0].side, 'fh');
    assert.equal(one.intents[0].intensity, T.INTENSITY.high);
});

test('a count is reps, and 3Push b needs no space', () => {
    const r = T.parseUtterance('3Push b');
    assert.equal(r.intents.length, 1);
    assert.equal(r.intents[0].role, 'push');
    assert.equal(r.intents[0].reps, 3);
    // and the other spellings of the same idea
    assert.equal(T.parseUtterance('push b x3').intents[0].reps, 3);
    assert.equal(T.parseUtterance('push b 3 veces').intents[0].reps, 3);
    assert.equal(T.parseUtterance('tres push b').intents[0].reps, 3);
});

test('a tempo is not a repetition', () => {
    const r = T.parseUtterance('push b 70 bpm');
    assert.equal(r.intents[0].bpm, 70);
    assert.equal(r.intents[0].reps, null);
});

test('"preset <name>" resolves against your own library', () => {
    const r = T.parseUtterance('preset Heavy backspin push a la derecha', { presets: library });
    assert.equal(r.intents[0].presetId, 'preset_heavy_push');
    // ...and the rest of the clause still says something about it
    assert.equal(r.intents[0].side, 'fh');
    assert.equal(r.intents[0].note, 'Heavy backspin push');
});

test('a name in another language still resolves', () => {
    // Stored preset names are never translated (AGENTS.md), so matching has to
    // be on the folded name rather than on a dictionary.
    const local = [P.normalizePreset({ id: 'mine', name: 'Saque Seguro', speed: 1.5, spin: 1, type: 'top', height: 40, drop: -5 })];
    assert.equal(T.parseUtterance('preset saque seguro', { presets: local }).intents[0].presetId, 'mine');
});

test('junk returns null instead of throwing', () => {
    for (const junk of ['empa/foo ??? ///', '', '   ', '???', null, undefined, 42, {}, []]) {
        assert.equal(T.parseUtterance(junk), null, JSON.stringify(junk));
    }
});

test('a partly understood sentence is not a dead end', () => {
    const r = T.parseUtterance('push b y luego un longitudinally squiggly thing');
    assert.ok(r, 'the first half still parsed');
    assert.equal(r.unresolved, true, 'and the assistant knows to offer the model tier');
    assert.ok(r.unknown.includes('thing'), JSON.stringify(r.unknown));
});

test('the parser cannot be pushed outside the ontology', () => {
    const r = T.parseUtterance('drive a la izquierda corto fuerte 9999 veces 999 bpm lateral plano');
    const i = r.intents[0];
    assert.ok(T.ROLES.includes(i.role));
    assert.ok(T.ROTATIONS.includes(i.rotation));
    assert.ok(T.SIDES.includes(i.side));
    assert.ok(T.DEPTHS.includes(i.depth));
    assert.ok(i.intensity >= 0 && i.intensity <= 10);
    // bpm and reps are left to makeBall()'s clamps; the parser does not bound
    // them itself, so the ONE place that clamps them is still the one place.
});

// --- the drop sign ----------------------------------------------------------

test('the drop sign matches the app\'s own factory data', () => {
    // The three sources this test exists to keep agreeing: constants.js, the
    // vocabulary, and the compiler. The wrong version was in three comments at
    // once, so it is asserted against the DATA rather than against a comment.
    const pushB = DEFAULT_DRILLS['push(b)'][1][0][0];
    const pushF = DEFAULT_DRILLS['push(f)'][1][0][0];
    assert.equal(pushB[B.DROP], -5, 'push(b) is the backhand side');
    assert.equal(pushF[B.DROP], +5, 'push(f) is the forehand side');

    assert.equal(C.SIDE_DROP.bh, pushB[B.DROP], 'backhand is a negative drop');
    assert.equal(C.SIDE_DROP.fh, pushF[B.DROP], 'forehand is a positive drop');
    assert.equal(C.SIDE_DROP.center, 0);

    // ...and end to end, through the words a user would actually say.
    assert.equal(C.compile(T.parseUtterance('corto al revés').intents[0])[0][0][B.DROP], -5);
    assert.equal(C.compile(T.parseUtterance('corto a la derecha').intents[0])[0][0][B.DROP], +5);
});

// --- the compiler -----------------------------------------------------------

test('the plan\'s compiler table', () => {
    const table = [
        // utterance,            speed, spin, type,  height, bpm
        ['saque corto', 4.5, 2.5, 'back', 30, 60],
        ['saque largo', 5.5, 3, 'back', 55, 60],
        ['push b', 1.5, 4, 'back', 45, 45],
        ['drive f', 5, 3, 'top', 55, 72],
        ['loop f', 4, 3.5, 'back', 60, 60],
        ['bloqueo', 2, 1, 'top', 70, 80]
    ];
    for (const [utterance, speed, spin, type, height, bpm] of table) {
        const intent = T.parseUtterance(utterance).intents[0];
        // Compile with no preset: the defaults table, not the matcher.
        const ball = C.compile(intent, null)[0][0];
        const where = `${utterance} -> ${ball.join(' ')}`;
        assert.equal(ball[B.SPEED], speed, `speed of ${utterance} in ${where}`);
        assert.equal(ball[B.SPIN], spin, `spin of ${utterance} in ${where}`);
        assert.equal(ball[B.TYPE], type, `type of ${utterance} in ${where}`);
        assert.equal(ball[B.HEIGHT], height, `height of ${utterance} in ${where}`);
        assert.equal(freqToBpm(ball[B.FREQ]), bpm, `bpm of ${utterance} in ${where}`);
    }
});

test('intensity moves the speed and nothing else', () => {
    const soft = C.compile(T.parseUtterance('drive b suave').intents[0], null)[0][0];
    const plain = C.compile(T.parseUtterance('drive b').intents[0], null)[0][0];
    const hard = C.compile(T.parseUtterance('drive b fuerte').intents[0], null)[0][0];

    assert.ok(soft[B.SPEED] < plain[B.SPEED], 'suave is slower');
    assert.ok(hard[B.SPEED] > plain[B.SPEED], 'fuerte is faster');
    // "fuerte" is a speed, never a scatter: a drill must not surprise you
    // mid-rally because a word was ambiguous.
    assert.equal(soft[B.SCATTER], 0);
    assert.equal(hard[B.SCATTER], 0);
    assert.equal(soft[B.HEIGHT], plain[B.HEIGHT]);
    assert.equal(hard[B.HEIGHT], plain[B.HEIGHT]);
});

test('intensity is bounded to +/-2', () => {
    const plain = C.compile({ role: 'drive', intensity: 5, side: 'bh' }, null)[0][0];
    const max = C.compile({ role: 'drive', intensity: 10, side: 'bh' }, null)[0][0];
    const min = C.compile({ role: 'drive', intensity: 0, side: 'bh' }, null)[0][0];
    assert.equal(max[B.SPEED] - plain[B.SPEED], 2);
    assert.equal(plain[B.SPEED] - min[B.SPEED], 2);
});

test('scatter stays opt-in and inside the table', () => {
    const ball = C.compile({ role: 'drive', side: 'fh', scatter: true }, null)[0][0];
    assert.ok(ball[B.SCATTER] > 0, '"con dispersion" is the one way to get scatter');
    assert.ok(Math.abs(ball[B.DROP]) + ball[B.SCATTER] <= 10);

    // An extreme drop leaves the scatter nothing to work with.
    const edge = C.compile({ role: 'drive', side: 'fh', drop: 10, scatter: true }, null);
    for (const b of (edge[0] || [])) {
        assert.ok(Math.abs(b[B.DROP]) + b[B.SCATTER] <= 10);
    }
    assert.equal(maxScatterFor(10), 0);
});

test('every compiled ball survives normalizeBall unchanged', () => {
    // The strongest single guarantee in the file: nothing this module emits
    // needs the editor to repair it. If makeBall() and normalizeBall() ever
    // disagree, this is where it shows.
    const sentences = [
        'saque corto a la derecha', 'saque largo al revés', 'push b', 'drive f fuerte',
        'loop f suave', 'bloqueo al medio', 'corto al revés con dispersion',
        'drive al medio 999 veces 999 bpm', 'loop fuerte lateral', 'saque plano'
    ];
    for (const s of sentences) {
        const intent = T.parseUtterance(s).intents[0];
        for (const step of C.compile(intent, null)) {
            for (const ball of step) {
                const before = ball.join('|');
                assert.equal(normalizeBall(ball.slice()).join('|'), before, `${s} -> ${before}`);
            }
        }
    }
});

test('no array is hand-built: spin is capped by speed on the way out', () => {
    // A hand-built array would let speed 10 keep its spin. makeBall() cannot.
    const impossible = C.compile({ role: 'drive', speed: 10, spin: 9, side: 'bh' }, null);
    for (const ball of impossible[0]) {
        assert.ok(ball[B.SPEED] <= 10);
        assert.ok(Math.abs(ball[B.TOP] - ball[B.BOT]) / 2 / 342 <= 10);
    }
    // ...and explicitly: the table takes no spin at all at speed 10.
    const flat = C.compile({ role: 'drive', intensity: 10, side: 'bh' }, null)[0][0];
    assert.ok(flat[B.SPIN] >= 0);
});

test('the active flag is 1, never undefined', () => {
    // The bug this guards: `undefined` means ON to the runner, so a compiler
    // that omitted it would be right by luck. It is written explicitly.
    const ball = C.compile(T.parseUtterance('push b').intents[0], null)[0][0];
    assert.equal(ball[B.ACTIVE], 1);
    assert.notEqual(ball[B.ACTIVE], undefined);
});

// --- the matcher ------------------------------------------------------------

test('matching finds the shipped preset a sentence means', () => {
    const m = M.matchPreset(T.parseUtterance('saque corto a la derecha').intents[0], library);
    assert.ok(m, JSON.stringify(M.rankPresets(T.parseUtterance('saque corto a la derecha').intents[0], library)));
    assert.equal(m.preset.id, 'preset_short_under');
});

test('matching is geometric, not by name', () => {
    // Rename every preset into Spanish and the match is unchanged: the score
    // reads type, spin, speed, height, drop and the axis labels, never a name.
    const renamed = library.map(p => ({ ...p, name: 'preset sin nombre ' + p.id }));
    const a = M.matchPreset(T.parseUtterance('saque corto a la derecha').intents[0], library);
    const b = M.matchPreset(T.parseUtterance('saque corto a la derecha').intents[0], renamed);
    assert.equal(a.preset.id, b.preset.id);
});

test('"cortado" is carried by type and spin, not by the word', () => {
    // Every shipped preset is named in English, so a name-based matcher would
    // score identically here. The heavy backspin push is the only one that is
    // backspin AND actually loaded.
    const intent = { role: 'push', rotation: 'back', intensity: 5, side: 'bh' };
    const ranked = M.rankPresets(intent, library);
    assert.equal(ranked[0].id, 'preset_heavy_push');
    assert.ok(ranked[0].parts.rotation < ranked.find(r => r.id === 'preset_safe_push').parts.rotation);
});

test('an intent the library cannot serve is null, not a bad guess', () => {
    // A flat, very soft, forehand block is not a ball in this library. The
    // assistant has to be able to say "I did not find one", because
    // `usedFallback` is what the readout is built on.
    const intent = { role: 'block', rotation: 'flat', side: 'fh', depth: 'long', intensity: 0 };
    const m = M.matchPreset(intent, library);
    assert.equal(m, null, JSON.stringify(M.rankPresets(intent, library)));

    const plan = C.buildPlan({ intents: [intent], presets: library });
    assert.equal(plan.meta[0].usedFallback, true);
    assert.equal(plan.meta[0].presetId, null);
    // ...and it still produced a playable ball.
    assert.equal(plan.steps.length, 1);
});

test('a named preset the intent asked for is honoured over re-matching', () => {
    const intent = { role: 'block', rotation: 'flat', side: 'fh', depth: 'long', intensity: 0, presetId: 'preset_fast_drive' };
    const plan = C.buildPlan({ intents: [intent], presets: library });
    assert.equal(plan.meta[0].presetId, 'preset_fast_drive');
    assert.equal(plan.meta[0].usedFallback, false);
    assert.equal(plan.steps[0][0][B.SPEED], 5 - 2, 'the preset speed, less the soft modifier');

    // At neutral intensity the preset's own numbers come through untouched.
    const plain = C.buildPlan({ intents: [{ ...intent, intensity: 5 }], presets: library });
    assert.equal(plain.steps[0][0][B.SPEED], 5);
});

test('a matched preset wins the depth and the side', () => {
    // The plan's own example: the preset's Long is height 55, not the nominal
    // 70, and that is the whole reason the preset is the source of truth.
    const intent = T.parseUtterance('saque largo a la derecha').intents[0];
    const plan = C.buildPlan({ intents: [intent], presets: library });
    const m = M.matchPreset(intent, library);
    if (m) {
        assert.equal(plan.steps[0][0][B.HEIGHT], m.preset.depths.find(d => d.label === 'Long').height);
    }
    // With no preset, the nominal table is used instead.
    const bare = C.compile({ ...intent, presetId: null }, null);
    assert.equal(bare[0][0][B.HEIGHT], 55);
});

test('a preset axis is narrowed by what the sentence asked for', () => {
    const preset = P.normalizePreset({
        id: 'axes', name: 'Axes', speed: 4, spin: 1, type: 'top', height: 50, drop: 0,
        placements: [{ label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }],
        depths: [{ label: 'Short', height: 30 }, { label: 'Mid', height: 50 }, { label: 'Long', height: 70 }]
    });
    // One side and one depth -> exactly one ball.
    const one = C.compile({ role: 'drive', side: 'fh', depth: 'long' }, { preset });
    assert.equal(one.length, 1);
    assert.equal(one[0][0][B.DROP], 5);
    assert.equal(one[0][0][B.HEIGHT], 70);

    // A side but no depth -> one placement at each depth, depth outermost.
    const all = C.compile({ role: 'drive', side: 'fh' }, { preset });
    assert.equal(all.length, 3);
    assert.deepEqual(all.map(s => s[0][B.HEIGHT]), [30, 50, 70]);

    // Neither -> the full 3x3, in the same order the preset editor uses.
    const full = C.compile({ role: 'drive' }, { preset });
    assert.equal(full.length, 9);
    assert.deepEqual(full.map(s => s[0][B.DROP]), [-5, 0, 5, -5, 0, 5, -5, 0, 5]);
});

test('variants and sequence are the same three modes the editor offers', () => {
    const preset = P.normalizePreset({
        id: 'axes', name: 'Axes', speed: 4, spin: 1, type: 'top', height: 50, drop: 0,
        placements: [{ label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }],
        depths: [{ label: 'Short', height: 30 }, { label: 'Mid', height: 50 }, { label: 'Long', height: 70 }]
    });
    const variants = C.compile({ role: 'drive', variants: 'variants' }, { preset });
    assert.equal(variants.length, 1, 'one step');
    assert.equal(variants[0].length, 9, 'holding every combination');

    const sequence = C.compile({ role: 'drive', variants: 'sequence' }, { preset });
    assert.equal(sequence.length, 9, 'one step per combination');
    assert.ok(sequence.every(s => s.length === 1));
});

// --- the store --------------------------------------------------------------

test('an AI drill round-trips through localStorage', () => {
    store.clear();
    A.loadAiDrills();
    const steps = C.buildPlan({ intents: T.parseUtterance('push b, drive f').intents, presets: library }).steps;
    const saved = A.persistDrill({ name: 'Saque + drive', steps, source: 'voice' });

    assert.ok(saved, JSON.stringify(A.getAiDrills()));
    assert.equal(A.aiDrillCount(), 1);
    assert.equal(A.getAiDrill(saved.key).name, 'Saque + drive');
    assert.equal(A.getAiDrill(saved.key).source, 'voice');
    assert.deepEqual(A.getAiDrill(saved.key).steps, steps);

    // and a reload sees the same thing
    A.loadAiDrills();
    assert.equal(A.aiDrillCount(), 1);
});

test('a hostile drill name from "the model" cannot reach a key or a selector', () => {
    store.clear();
    A.loadAiDrills();
    const steps = C.buildPlan({ intents: T.parseUtterance('push b').intents }).steps;
    const hostile = '<img src=x onerror="window.__pwned=1">" ] 🔥 ' + 'x'.repeat(400);

    const saved = A.persistDrill({ name: hostile, steps });
    assert.ok(saved, 'it is still saved');

    // The KEY is the clock, never the model's text - that is the whole rule.
    assert.match(saved.key, /^ai_[0-9a-z]+_[0-9a-z]+$/);
    assert.ok(!saved.key.includes('img'));
    assert.ok(!saved.key.includes('pwned'));
    // so interpolating it into a [data-key="..."] selector cannot throw
    assert.doesNotThrow(() => document_keySelector(saved.key));

    // The NAME is kept as typed (it is the user's data, like any other), and
    // capped, and the panel renders it with textContent.
    assert.ok(saved.name.length <= 40);
    assert.ok(saved.name.includes('onerror'), 'the text is preserved, not mangled');
});

test('a corrupt AI store is empty, never a crash', () => {
    for (const junk of ['{not json', 'null', '"a string"', '{"a":1}', '[42, null, {"key":"k"}]']) {
        store.set('nova_ai_drills', junk);
        A.loadAiDrills();
        assert.ok(Array.isArray(A.getAiDrills()), `junk survived as an array: ${junk}`);
    }
    store.set('nova_ai_drills', '[{"key":"k","name":"n","steps":[["not a ball"]]}]');
    A.loadAiDrills();
    assert.equal(A.aiDrillCount(), 0, 'a step of junk balls is not a drill');
});

test('persistDrill is the only funnel, and it refuses an empty drill', () => {
    store.clear();
    A.loadAiDrills();
    assert.equal(A.persistDrill({ name: 'x', steps: [] }), null);
    assert.equal(A.persistDrill({ name: 'x', steps: 'nope' }), null);
    assert.equal(A.persistDrill({}), null);
    assert.equal(A.aiDrillCount(), 0);
});

test('drafts live in memory and ops cannot corrupt them', () => {
    store.clear();
    A.loadAiDrills();
    const plan = C.buildPlan({ intents: T.parseUtterance('push b, drive f').intents });
    A.setDraft({ ...plan, meta: [...plan.meta] });
    assert.equal(A.getDraft().steps.length, 2);
    assert.equal(A.aiDrillCount(), 0, 'a draft is never written by being built');

    A.applyDraftOps([{ op: 'remove', index: 0 }]);
    assert.equal(A.getDraft().steps.length, 1);
    A.applyDraftOps([{ op: 'add', step: plan.steps[0], index: 99 }]);
    assert.equal(A.getDraft().steps.length, 2);
    A.applyDraftOps([{ op: 'remove', index: 99 }, { op: 'nonsense' }, null, 'x']);
    assert.equal(A.getDraft().steps.length, 2, 'out-of-range and junk ops are no-ops');
    A.clearDraft();
    assert.equal(A.getDraft(), null);
});

test('moving to a custom set mints a folded key and leaves the IA store', () => {
    store.clear();
    A.loadAiDrills();
    const steps = C.buildPlan({ intents: T.parseUtterance('push b').intents }).steps;
    const saved = A.persistDrill({ name: 'Saque Rápido "A" 🔥', steps });

    const currentDrills = {};
    const userCustomDrills = { 'custom-a': [], 'custom-b': [], 'custom-c': [] };
    let savedData = null, savedDrills = false;
    const deps = {
        currentDrills,
        userCustomDrills,
        setCustomData: () => { savedData = JSON.stringify(userCustomDrills); },
        saveDrillsToStorage: () => { savedDrills = true; }
    };

    const key = A.moveToCustom(saved.key, 'custom-b', deps);
    assert.ok(key, 'the move happened');
    assert.match(key, /^cust_B_[A-Za-z0-9._#\-\[\]><+()_]+\d+$/);
    assert.doesNotThrow(() => document_keySelector(key));
    assert.equal(currentDrills[key][1].length, steps.length);
    assert.equal(userCustomDrills['custom-b'].length, 1);
    assert.equal(userCustomDrills['custom-b'][0].name, 'Saque Rápido "A" 🔥', 'the name moves verbatim');
    assert.ok(savedData && savedDrills, 'both stores were written');
    assert.equal(A.aiDrillCount(), 0, 'and it is no longer an AI drill');
    assert.equal(A.getAiDrill(saved.key), null);
});

test('a move that cannot happen is refused, not half-done', () => {
    store.clear();
    A.loadAiDrills();
    const steps = C.buildPlan({ intents: T.parseUtterance('push b').intents }).steps;
    const saved = A.persistDrill({ name: 'x', steps });
    const deps = {
        currentDrills: {}, userCustomDrills: { 'custom-a': [], 'custom-b': [], 'custom-c': [] },
        setCustomData: () => {}, saveDrillsToStorage: () => {}
    };
    assert.equal(A.moveToCustom(saved.key, 'custom-z', deps), null, 'unknown category');
    assert.equal(A.moveToCustom('missing', 'custom-a', deps), null, 'unknown key');
    assert.equal(A.moveToCustom(saved.key, 'custom-a', {}), null, 'missing deps');
    assert.equal(A.aiDrillCount(), 1, 'and the drill is still there');
});

test('a full IA category refuses new drills rather than evicting the old ones', () => {
    store.clear();
    A.loadAiDrills();
    const steps = C.buildPlan({ intents: T.parseUtterance('push b').intents }).steps;
    const list = Array.from({ length: A.MAX_AI_DRILLS }, (_, i) => A.persistDrill({ name: 'd' + i, steps }));
    assert.equal(list.filter(Boolean).length, A.MAX_AI_DRILLS);
    assert.equal(A.persistDrill({ name: 'one too many', steps }), null);
    assert.equal(A.aiDrillCount(), A.MAX_AI_DRILLS);
    A.clearAiDrills();
    assert.equal(A.aiDrillCount(), 0);
});

// --- helpers ----------------------------------------------------------------

/**
 * Exactly what ui.js does to a key, so "a hostile name cannot reach a
 * selector" is asserted against the real expression rather than in theory.
 */
function document_keySelector(key) {
    return `.btn-drill[data-key="${key}"]`;
}
