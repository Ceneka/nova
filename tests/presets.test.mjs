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

const { B, makeBall, calculateRPMs, reverseCalculate, normalizeBall, freqToBpm, bpmToFreq, maxScatterFor, maxSpinFor, applyStarLevel } =
    await import('../v2/js/ball.js');

const P = await import('../v2/js/presets.js');
const R = await import('../v2/js/robotPosition.js');
const { DEFAULT_DRILLS } = await import('../v2/js/constants.js');
const S = await import('../v2/js/state.js');

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

test('an existing library refreshes untouched built-in serves, never edits', () => {
    // The old shipped short serve, including the half-fixed state that only
    // changed the base height (-30) and left the positive depth axis.
    const oldShort = preset({
        id: 'preset_short_under', name: 'My short serve', builtIn: true,
        speed: 4, spin: 1.5, type: 'top', height: -30, bpm: 60,
        placements: [{ label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }],
        depths: [{ label: 'Short', height: 10 }, { label: 'Mid', height: 30 }, { label: 'Long', height: 50 }]
    });
    const editedLong = preset({
        id: 'preset_long_under', name: 'Long under serve', builtIn: true,
        speed: 9, spin: 1, type: 'top', height: 55, bpm: 60,
        placements: [{ label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }],
        depths: [{ label: 'Short', height: 35 }, { label: 'Mid', height: 55 }, { label: 'Long', height: 75 }]
    });
    const mine = preset({ id: 'mine', name: 'Mine', builtIn: false });

    store.set('nova_ball_presets', JSON.stringify([oldShort, editedLong, mine]));
    P.loadPresets();

    const short = P.getPresetById('preset_short_under');
    assert.equal(short.name, 'My short serve', 'a renamed built-in keeps its name');
    assert.equal(short.type, 'back');
    assert.deepEqual(short.depths.map(d => d.height), [-35, -40, -45]);

    const long = P.getPresetById('preset_long_under');
    assert.equal(long.speed, 9, 'a hand-edited built-in is left alone');
    assert.equal(long.type, 'top');

    assert.ok(P.getPresetById('mine'), 'a custom preset survives');
});

test('an old preset export cannot put the positive serves back', () => {
    P.setPresets(P.DEFAULT_PRESETS.map(P.clonePreset));
    const oldShort = preset({
        id: 'preset_short_under', name: 'Short under serve', builtIn: true,
        speed: 4, spin: 1.5, type: 'top', height: 30, bpm: 60,
        placements: [{ label: 'BH', drop: -5 }, { label: 'Center', drop: 0 }, { label: 'FH', drop: 5 }],
        depths: [{ label: 'Short', height: 10 }, { label: 'Mid', height: 30 }, { label: 'Long', height: 50 }]
    });

    P.mergePresets([oldShort]);
    const p = P.getPresetById('preset_short_under');
    assert.equal(p.type, 'back');
    assert.deepEqual(p.depths.map(d => d.height), [-35, -40, -45]);
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

test('the factory library is built from the validated slow-feed balls', () => {
    // From the user's own tuned library. The push is a two-bounce ball and the
    // drive/loop are low; the same recipe at level 1 carries its editor fields
    // because spin 6 at speed 2 clamps the backspin wheel.
    const push = DEFAULT_DRILLS['push(b)'][1][0][0];
    assert.equal(push[B.SPEED], 2);
    assert.equal(push[B.SPIN], 6);
    assert.equal(push[B.TYPE], 'back');
    assert.equal(push[B.HEIGHT], -43);
    assert.equal(freqToBpm(push[B.FREQ]), 36);

    const drive = DEFAULT_DRILLS['drive(f)'][1][0][0];
    assert.equal(drive[B.SPEED], 3);
    assert.equal(drive[B.SPIN], 1);
    assert.equal(drive[B.TYPE], 'top');
    assert.equal(drive[B.HEIGHT], 30);
    assert.equal(freqToBpm(drive[B.FREQ]), 64);

    const loop = DEFAULT_DRILLS['loop(b)'][1][0][0];
    assert.equal(loop[B.SPEED], 2.5);
    assert.equal(loop[B.SPIN], 4);
    assert.equal(loop[B.HEIGHT], 20);

    // The combined drills use the same validated push, not the old +50 ball.
    const comboPush = normalizeBall(DEFAULT_DRILLS['push(f)-drive(f)'][1][0][0].slice());
    assert.equal(comboPush[B.SPEED], 2);
    assert.equal(comboPush[B.SPIN], 6);
    assert.equal(comboPush[B.HEIGHT], -43);

    // Level 2 is the same shot, a little harder - never a higher arc.
    const comboPush2 = normalizeBall(DEFAULT_DRILLS['push(f)-drive(f)'][2][0][0].slice());
    assert.equal(comboPush2[B.SPEED], 2.5);
    assert.equal(comboPush2[B.SPIN], 6.5);
    assert.equal(comboPush2[B.HEIGHT], -43);
});

test('an existing install migrates only untouched high-ball factory levels', () => {
    const old = {
        'push(b)': {
            1: [[[1547, 2915, 50, -5, 10, 1, 1]]],
            2: [[[1205, 3257, 50, -5, 20, 1, 1]]],
            3: [[[863, 3599, 50, -5, 30, 1, 1]]]
        },
        'loop(b)': {
            1: [[[1520, 3572, 50, -5, 10, 1, 1]]],                 // old high
            2: [[[400, 4283, 20, -5, 10, 1, 1, 2.5, 4, 'back']]],   // tuned low
            3: []
        },
        'cust_A_mine': { 1: [[[1547, 2915, 50, -5, 10, 1, 1]]] }
    };

    assert.equal(S.migrateLegacyFactoryDrills(old), true);
    assert.equal(old['push(b)'][1][0][0][B.HEIGHT], -43, 'old basic level replaced');
    assert.equal(old['push(b)'][1][0][0][B.SPEED], 2);
    assert.equal(old['push(b)'][3][0][0][B.HEIGHT], -43, 'old level 3 replaced too');
    assert.equal(old['loop(b)'][1][0][0][B.HEIGHT], 20);
    assert.equal(old['loop(b)'][2][0][0][B.HEIGHT], 20, 'a low level the user tuned is kept');
    assert.equal(old['cust_A_mine'][1][0][0][B.HEIGHT], 50, 'custom drills are never touched');
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

test('the serve presets use the negative two-bounce band', () => {
    // A serve is the one ball that is supposed to be launched down. The old
    // library stored "Short under serve" at +30 and "Long under serve" at +55,
    // so the sequence and variants modes fed rally balls from a preset with
    // "serve" in its name. Changing only the base height would not have fixed
    // that: buildPresetBalls() reads the depth axis.
    for (const id of ['preset_short_under', 'preset_long_under', 'preset_short_side', 'preset_long_side']) {
        const p = P.DEFAULT_PRESETS.find(x => x.id === id);
        assert.equal(p.type, 'back', `${id} is backspin`);
        for (const d of p.depths) {
            assert.ok(d.height < 0, `${id} ${d.label} is launched down (${d.height})`);
        }
        for (const b of P.buildPresetBalls(P.normalizePreset(p))) {
            assert.ok(b[B.HEIGHT] < 0, `${id} plays a two-bounce ball`);
        }
    }
});

test('standardDepths never puts a serve back above the table', () => {
    const negative = P.standardDepths(-35);
    assert.deepEqual(negative.map(d => d.height), [-35, -40, -45]);
    assert.deepEqual(negative.map(d => d.label), ['Short', 'Mid', 'Long']);
    // Positive heights keep the original 20-unit spacing.
    assert.deepEqual(P.standardDepths(50).map(d => d.height), [30, 50, 70]);
});

test('a star is the same ball, a little faster and with more spin', () => {
    const base = makeBall({ speed: 4, spin: 1.5, type: 'top', height: -35, drop: -5, bpm: 60, reps: 2 });

    assert.equal(applyStarLevel(base, 1).join('|'), base.join('|'), 'level 1 is untouched');

    const two = applyStarLevel(base, 2);
    const three = applyStarLevel(base, 3);
    assert.equal(two[B.SPEED], 4.5);
    assert.equal(two[B.SPIN], 2);
    assert.equal(freqToBpm(two[B.FREQ]), 66);
    assert.equal(three[B.SPEED], 5);
    assert.equal(three[B.SPIN], 2.5);
    assert.equal(freqToBpm(three[B.FREQ]), 72);

    // The shot is the same shot: no target or trajectory change.
    for (const b of [two, three]) {
        assert.equal(b[B.HEIGHT], base[B.HEIGHT]);
        assert.equal(b[B.DROP], base[B.DROP]);
        assert.equal(b[B.REPS], base[B.REPS]);
        assert.equal(b[B.TYPE], base[B.TYPE]);
    }

    // SPIN_LIMITS still wins at the top of the table.
    const fast = makeBall({ speed: 10, spin: 0, type: 'top' });
    assert.equal(applyStarLevel(fast, 3)[B.SPIN], 0);
});

test('robot position 2 is the calibrated origin', () => {
    const ball = makeBall({ speed: 4, spin: 1.5, type: 'back', height: -35, drop: -5, bpm: 60, reps: 1 });
    assert.equal(R.normalizePosition(2), 2);
    assert.equal(R.normalizePosition(99), 9);
    assert.equal(R.normalizePosition('junk'), R.DEFAULT_POSITION);
    assert.equal(R.applyRobotPosition(ball, 2).join('|'), ball.join('|'));
});

test('moving the robot sideways compensates the drop, not the drill', () => {
    const ball = makeBall({ speed: 4, spin: 1.5, type: 'top', height: 50, drop: 0, bpm: 60, reps: 1 });

    const left = R.applyRobotPosition(ball, 1);    // back left
    const right = R.applyRobotPosition(ball, 3);   // back right
    assert.equal(left[B.DROP], 4, 'standing left means aiming right');
    assert.equal(right[B.DROP], -4, 'standing right means aiming left');

    // Back row: only the lateral term applies.
    assert.equal(left[B.HEIGHT], ball[B.HEIGHT]);
    assert.equal(left[B.SPEED], ball[B.SPEED]);
});

test('moving the robot toward the net lowers and slows the same ball', () => {
    const ball = makeBall({ speed: 4, spin: 1.5, type: 'back', height: -35, drop: 0, bpm: 60, reps: 1 });
    const near = R.applyRobotPosition(ball, 8); // near net, centre

    assert.ok(near[B.HEIGHT] > ball[B.HEIGHT], 'less downward for a two-bounce serve');
    assert.equal(near[B.HEIGHT], -24.5);
    assert.equal(near[B.SPEED], 3);
    assert.equal(near[B.DROP], 0, 'centre stays centre');
    // The sign is preserved: it is still a two-bounce serve, never a lofted one.
    assert.ok(near[B.HEIGHT] < 0);
});

test('every robot square produces a legal ball', () => {
    for (let pos = 1; pos <= R.POSITION_COUNT; pos++) {
        const near = R.applyRobotPosition(
            makeBall({ speed: 9, spin: 1, type: 'top', height: -50, drop: 9, bpm: 90, reps: 1 }),
            pos
        );
        assert.ok(near[B.HEIGHT] >= -50 && near[B.HEIGHT] <= 100, `pos ${pos} height`);
        assert.ok(near[B.DROP] >= -10 && near[B.DROP] <= 10, `pos ${pos} drop`);
        assert.ok(near[B.SPEED] >= 0 && near[B.SPEED] <= 10, `pos ${pos} speed`);
        assert.ok(near[B.SPIN] <= maxSpinFor(near[B.SPEED]), `pos ${pos} spin`);
        assert.ok(near[B.TOP] >= 400 && near[B.BOT] >= 400, `pos ${pos} rpm`);
    }
});
