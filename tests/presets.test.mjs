/**
 * Zero-dependency smoke tests for the preset engine.
 * Run with:  node --test tests/
 *
 * The app is a static site, so this is the only automated check in the repo.
 * It covers the parts where a silent off-by-one would be hard to spot by eye:
 * the RPM round-trip, the placement x depth matrix, and CSV/JSON round-trips.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// presets.js persists through localStorage; give it a stub before first use.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
};

const { B, makeBall, calculateRPMs, reverseCalculate, normalizeBall, freqToBpm, bpmToFreq, maxScatterFor } =
    await import('../v2/js/ball.js');

const P = await import('../v2/js/presets.js');

const preset = (over = {}) => P.normalizePreset({
    id: 'p_test', name: 'Test', speed: 4, spin: 1.5, type: 'top',
    height: 50, drop: 0, bpm: 60, reps: 1, scatter: 0,
    placements: [{ label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }],
    depths: [{ label: 'Short', height: 30 }, { label: 'Mid', height: 50 }, { label: 'Long', height: 70 }],
    ...over
});

test('speed/spin survive a round-trip through the motor RPMs', () => {
    for (const [speed, spin, type] of [[4, 1.5, 'top'], [1.5, 4, 'back'], [7.5, 5, 'back'], [2, 2, 'top']]) {
        const rpm = calculateRPMs(speed, spin, type);
        const back = reverseCalculate(rpm.top, rpm.bot);
        assert.equal(back.speed, speed, `speed ${speed}`);
        assert.equal(back.spin, spin, `spin ${spin}`);
        assert.equal(back.type, type, `type ${type}`);
    }
});

test('spin is clamped to what the table allows at that speed', () => {
    const ball = makeBall({ speed: 10, spin: 5, type: 'top' });
    assert.equal(ball[B.SPIN], 0, 'speed 10 allows no spin at all');
    assert.equal(makeBall({ speed: 7, spin: 9, type: 'top' })[B.SPIN], 6, 'speed 7 caps at 6');
});

test('bpm and frequency are inverses', () => {
    for (const bpm of [30, 45, 60, 77, 90]) {
        assert.equal(freqToBpm(bpmToFreq(bpm)), bpm);
    }
});

test('scatter never pushes the drop point past the table edge', () => {
    assert.equal(maxScatterFor(0), 10);
    assert.equal(maxScatterFor(-8), 2);
    assert.equal(makeBall({ drop: -8, scatter: 9 })[B.SCATTER], 2);
    assert.equal(normalizeBall([400, 400, 0, -9, 0, 1, 1, 4, 1, 'top', 5])[B.SCATTER], 1);
});

test('a ball with no active flag still plays', () => {
    // Older stored drills omit index 6; the editor and the runner both treat
    // that as "enabled", so saving one must not silently disable it.
    const bare = [400, 400, 0, 0, 0, 1, undefined, 4, 1, 'top'];
    assert.equal(normalizeBall(bare)[B.ACTIVE], 1);
    assert.equal(normalizeBall([...bare])[B.ACTIVE], 1);
    assert.equal(normalizeBall([400, 400, 0, 0, 0, 1, 0, 4, 1, 'top'])[B.ACTIVE], 0);
    assert.equal(normalizeBall([400, 400, 0, 0, 0, 1, 1, 4, 1, 'top'])[B.ACTIVE], 1);
});

test('normalizing a legacy raw-RPM ball fills in the editor fields', () => {
    // Exactly the shape constants.js stores for the factory drills:
    // [top, bot, height, drop, freq, reps, active]
    const pushB = normalizeBall([1547, 2915, 50, -5, 10, 1, 1]);
    assert.equal(pushB[B.SPEED], 2);
    assert.equal(pushB[B.SPIN], 2);
    assert.equal(pushB[B.TYPE], 'back');
    assert.equal(pushB[B.HEIGHT], 50);
    assert.equal(pushB[B.DROP], -5);
    assert.equal(freqToBpm(pushB[B.FREQ]), 36);
});

test('a preset expands to placements x depths, placement fastest', () => {
    const balls = P.buildPresetBalls(preset());
    assert.equal(balls.length, 9);
    assert.equal(P.presetBallCount(preset()), 9);

    assert.deepEqual(balls.map(b => b[B.DROP]), [-5, 0, 5, -5, 0, 5, -5, 0, 5]);
    assert.deepEqual(balls.map(b => b[B.HEIGHT]), [30, 30, 30, 50, 50, 50, 70, 70, 70]);

    // The base recipe must survive into every expansion.
    for (const b of balls) {
        assert.equal(b[B.SPEED], 4);
        assert.equal(b[B.SPIN], 1.5);
        assert.equal(b[B.TYPE], 'top');
        assert.equal(freqToBpm(b[B.FREQ]), 60);
    }
});

test('an empty axis falls back to the preset drop/height', () => {
    const bare = preset({ placements: [], depths: [] });
    const balls = P.buildPresetBalls(bare);
    assert.equal(balls.length, 1);
    assert.equal(balls[0][B.DROP], 0);
    assert.equal(balls[0][B.HEIGHT], 50);
});

test('a one-sided preset varies only that axis', () => {
    const flat = preset({ depths: [] });
    const balls = P.buildPresetBalls(flat);
    assert.equal(balls.length, 3);
    assert.deepEqual(balls.map(b => b[B.HEIGHT]), [50, 50, 50]);
});

test('sequence mode emits one single-variant step per ball', () => {
    const steps = P.buildSequenceSteps(preset());
    assert.equal(steps.length, 9);
    assert.ok(steps.every(s => s.length === 1), 'no step should hold variants');
});

test('variant mode emits a single multi-variant step', () => {
    const step = P.buildVariantStep(preset());
    assert.equal(step.length, 9);
    assert.ok(step.every(b => b[B.ACTIVE] === 1));
});

test('standard axes are anchored on the ball you started from', () => {
    assert.deepEqual(P.standardPlacements(0), [
        { label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }
    ]);
    // a ball dropped at +3 keeps +3 in the set instead of snapping to centre
    assert.deepEqual(P.standardPlacements(3).map(p => p.drop), [-2, 3, 8]);
    // ...and the whole set stays on the table
    assert.ok(P.standardPlacements(10).every(p => p.drop >= -10 && p.drop <= 10));
    assert.ok(P.standardDepths(-50).every(d => d.height >= -50 && d.height <= 100));
});

test('a preset built from an editor ball keeps that ball exactly', () => {
    const ball = makeBall({ speed: 6, spin: 2, type: 'back', height: 35, drop: -4, bpm: 55, reps: 3, scatter: 1 });
    const p = P.presetFromBall(ball, 'My serve');

    assert.equal(p.name, 'My serve');
    assert.equal(P.buildSingleBall(p).join('|'), ball.join('|'));
    assert.equal(p.placements.length, 0, 'starts as a single fixed point');
});

test('normalizePreset repairs junk instead of throwing', () => {
    const p = P.normalizePreset({
        name: 'x'.repeat(80), speed: 99, spin: 99, type: 'nope',
        height: 999, drop: -999, bpm: 0, reps: 0, scatter: 99,
        placements: [{ label: 'a'.repeat(40), drop: 40 }, null, 'nope'],
        depths: [{ label: 'd', height: -900 }]
    });

    assert.equal(p.name.length, 30);
    assert.equal(p.speed, 10);
    assert.equal(p.type, 'top');
    assert.equal(p.height, 100);
    assert.equal(p.drop, -10);
    assert.equal(p.bpm, 30);
    assert.equal(p.reps, 1);
    assert.equal(p.scatter, 0, 'drop -10 leaves no room to scatter');
    assert.equal(p.placements.length, 1, 'null entries dropped');
    assert.equal(p.placements[0].label.length, 12);
    assert.equal(p.depths[0].height, -50);
});

test('normalizePreset rejects non-objects', () => {
    for (const junk of [null, undefined, 42, 'nope', [], {}]) {
        assert.equal(P.normalizePreset(junk), null);
    }
});

test('CSV round-trips the whole library', () => {
    P.setPresets(P.DEFAULT_PRESETS.map(P.clonePreset));
    const csv = P.serializePresetsToCSV();
    const back = P.parsePresetsCSV(csv);

    assert.equal(back.length, P.getPresets().length);
    assert.deepEqual(
        back.map(p => P.buildPresetBalls(p).map(b => b.join('|'))),
        P.getPresets().map(p => P.buildPresetBalls(p).map(b => b.join('|')))
    );
});

test('CSV tolerates quotes and semicolons in names', () => {
    P.setPresets([preset({ name: 'Serve "A"; low' })]);
    const back = P.parsePresetsCSV(P.serializePresetsToCSV());
    assert.equal(back[0].name, 'Serve "A"; low');
});

test('JSON round-trips and is sniffed by parsePresetsAuto', () => {
    P.setPresets(P.DEFAULT_PRESETS.map(P.clonePreset));
    const back = P.parsePresetsAuto(P.serializePresetsToJSON());
    assert.equal(back.length, P.DEFAULT_PRESETS.length);
    assert.equal(P.parsePresetsAuto(P.serializePresetsToCSV()).length, P.DEFAULT_PRESETS.length);
});

test('parsePresetsAuto rejects junk', () => {
    assert.throws(() => P.parsePresetsAuto('not;a;preset;file\n1;2;3'));
    assert.throws(() => P.parsePresetsAuto('{"nope":1}'));
});

test('a corrupt store falls back to the shipped library', () => {
    store.set('nova_ball_presets', '{not json');
    P.loadPresets();
    assert.equal(P.getPresets().length, P.DEFAULT_PRESETS.length);
});

test('a store holding junk entries keeps the good ones', () => {
    store.set('nova_ball_presets', JSON.stringify([{ name: 'keep' }, 42, null]));
    P.loadPresets();
    assert.deepEqual(P.getPresets().map(p => p.name), ['keep']);
});

test('merge skips name clashes and refreshes built-ins', () => {
    P.setPresets([preset({ id: 'preset_short_under', name: 'Short under serve' }), preset({ id: 'mine', name: 'Mine' })]);

    const result = P.mergePresets([
        preset({ id: 'preset_short_under', name: 'Short under serve', speed: 9 }), // built-in refresh
        preset({ id: 'theirs', name: 'Mine' }),                                       // name clash
        preset({ id: 'fresh', name: 'Fresh' })                                         // new
    ]);

    assert.deepEqual(result, { added: 1, updated: 1 });
    assert.equal(P.getPresetById('preset_short_under').speed, 9);
    assert.equal(P.getPresetById('mine').name, 'Mine', 'the clashing one is untouched');
    assert.ok(P.getPresetById('fresh'));
});

test('add/update/delete round-trip through the store', () => {
    P.setPresets([]);
    assert.equal(P.getPresets().length, 0, 'an empty library is allowed, not silently repopulated');

    const added = P.addPreset(preset({ id: 'ignored' }));
    assert.notEqual(added.id, 'ignored', 'a new preset gets a fresh id');
    assert.equal(P.getPresets().length, 1);

    assert.equal(P.updatePreset(added.id, { bpm: 75 }).bpm, 75);
    assert.equal(P.updatePreset('missing', { bpm: 75 }), null);
    assert.equal(P.deletePreset(added.id), true);
    assert.equal(P.deletePreset(added.id), false);

    P.resetPresetsToDefaults();
    assert.equal(P.getPresets().length, P.DEFAULT_PRESETS.length);
});

test('the shipped library expands to something sane', () => {
    for (const p of P.DEFAULT_PRESETS) {
        const clean = P.normalizePreset(p);
        assert.ok(clean, `${p.name} survives normalization`);
        assert.equal(clean.spin, P.DEFAULT_PRESETS.find(d => d.id === p.id).spin,
            `${p.name} is already within the spin limit`);

        const balls = P.buildPresetBalls(clean);
        assert.equal(balls.length, 9, `${p.name} yields 3x3`);
        for (const b of balls) {
            assert.ok(b[B.HEIGHT] >= -50 && b[B.HEIGHT] <= 100, `${p.name} height in range`);
            assert.ok(b[B.DROP] >= -10 && b[B.DROP] <= 10, `${p.name} drop in range`);
            assert.ok(b[B.TOP] >= 400 && b[B.BOT] >= 400, `${p.name} rpm in range`);
        }
    }
});
