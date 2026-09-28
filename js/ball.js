import { RPM_MIN, RPM_MAX, SPIN_LIMITS } from './constants.js';
import { clamp } from './utils.js';

/**
 * A "ball" is a plain array so it can be JSON-serialised straight into
 * localStorage and into the CSV export. The layout is load-bearing: the
 * Bluetooth packet builder (packBall), the CSV exporter and the editor all
 * read the same indexes.
 *
 *   [0]  top motor RPM
 *   [1]  bottom motor RPM
 *   [2]  height     -50 (down) .. 100 (up)
 *   [3]  drop       -10 (right) .. 10 (left)   <- lateral placement
 *   [4]  frequency  0 (30 bpm) .. 100 (90 bpm)
 *   [5]  repetitions
 *   [6]  active     1 = played, 0 = skipped by the runner
 *   [7]  speed      0 .. 10   (editor-facing, mirrored from the RPMs)
 *   [8]  spin       0 .. 10   (editor-facing)
 *   [9]  type       'top' | 'back' (editor-facing)
 *   [10] scatter    0 .. 10, +/- on the drop point (single-variant steps only)
 *
 * Indexes 7-9 are only present on balls created or edited in this version; the
 * factory drills still store raw RPMs and get reverse-calculated on first read.
 */
export const B = {
    TOP: 0, BOT: 1, HEIGHT: 2, DROP: 3, FREQ: 4, REPS: 5, ACTIVE: 6,
    SPEED: 7, SPIN: 8, TYPE: 9, SCATTER: 10
};

export const LIMITS = {
    speed: [0, 10],
    spin: [0, 10],
    height: [-50, 100],
    drop: [-10, 10],
    bpm: [30, 90],
    reps: [1, 200],
    scatter: [0, 10]
};

export function calculateRPMs(speed, spin, type) {
    const baseSpeed = 970 + (630.5 * speed);
    const spinFactor = 342 * spin;
    let top, bot;
    if (type === 'back') { top = baseSpeed - spinFactor; bot = baseSpeed + spinFactor; }
    else { top = baseSpeed + spinFactor; bot = baseSpeed - spinFactor; }
    return {
        top: Math.round(clamp(top, RPM_MIN, RPM_MAX)),
        bot: Math.round(clamp(bot, RPM_MIN, RPM_MAX))
    };
}

/** Rebuild the editor-facing speed/spin/type from stored motor RPMs. */
export function reverseCalculate(top, bot) {
    const type = top >= bot ? 'top' : 'back';
    const baseSpeed = (top + bot) / 2;
    const speedRaw = (baseSpeed - 970) / 630.5;
    const spinRaw = (Math.abs(top - bot) / 2) / 342;
    return {
        speed: Math.round(speedRaw * 2) / 2,
        spin: Math.round(spinRaw * 2) / 2,
        type: type
    };
}

/** Highest spin the table accepts at a given speed. */
export function maxSpinFor(speed) {
    return SPIN_LIMITS[speed.toString()] ?? 10;
}

/** Clamp a speed/spin pair to what the table can actually produce. */
export function normalizeSpin(speed, spin) {
    return clamp(spin, 0, maxSpinFor(speed));
}

export function bpmToFreq(bpm) {
    return clamp((bpm - 30) / 0.6, 0, 100);
}

export function freqToBpm(freq) {
    return Math.round(30 + (clamp(freq, 0, 100) * 0.6));
}

/** Scatter can never push the drop point past the table edge. */
export function maxScatterFor(drop) {
    return clamp(10 - Math.abs(clamp(drop, -10, 10)), 0, 10);
}

export const cloneBall = (ball) => ball.slice();

/**
 * Build a full ball array from editor-facing values, keeping the RPMs,
 * the speed/spin limits and the drop/scatter constraint in sync.
 */
export function makeBall(cfg = {}) {
    const speed = clamp(cfg.speed ?? 5, ...LIMITS.speed);
    const spin = normalizeSpin(speed, cfg.spin ?? 0);
    const type = cfg.type === 'back' ? 'back' : 'top';
    const height = clamp(cfg.height ?? 50, ...LIMITS.height);
    const drop = clamp(cfg.drop ?? 0, ...LIMITS.drop);
    const rpm = calculateRPMs(speed, spin, type);

    return [
        rpm.top,
        rpm.bot,
        height,
        drop,
        bpmToFreq(cfg.bpm ?? 60),
        clamp(cfg.reps ?? 1, ...LIMITS.reps),
        cfg.active === 0 ? 0 : 1,
        speed,
        spin,
        type,
        clamp(cfg.scatter ?? 0, 0, maxScatterFor(drop))
    ];
}

/**
 * Re-derive the motor RPMs / limits of a stored ball in place, the same way
 * saveDrillChanges does before persisting a drill.
 */
export function normalizeBall(ball) {
    if (ball[B.SPEED] === undefined) {
        const rev = reverseCalculate(ball[B.TOP], ball[B.BOT]);
        ball[B.SPEED] = clamp(rev.speed, 0, 10);
        ball[B.SPIN] = clamp(rev.spin, 0, 10);
        ball[B.TYPE] = rev.type;
    }

    ball[B.SPEED] = clamp(ball[B.SPEED], ...LIMITS.speed);
    ball[B.SPIN] = normalizeSpin(ball[B.SPEED], ball[B.SPIN]);
    ball[B.TYPE] = ball[B.TYPE] === 'back' ? 'back' : 'top';

    const rpm = calculateRPMs(ball[B.SPEED], ball[B.SPIN], ball[B.TYPE]);
    ball[B.TOP] = rpm.top;
    ball[B.BOT] = rpm.bot;

    ball[B.HEIGHT] = clamp(ball[B.HEIGHT], ...LIMITS.height);
    ball[B.DROP] = clamp(ball[B.DROP], ...LIMITS.drop);
    ball[B.FREQ] = clamp(ball[B.FREQ], 0, 100);
    ball[B.REPS] = clamp(ball[B.REPS], ...LIMITS.reps);
    // A missing flag means "play this ball" - see runner.js and the editor,
    // which both fall back to 1 rather than 0.
    ball[B.ACTIVE] = ball[B.ACTIVE] === undefined || ball[B.ACTIVE] === 1 ? 1 : 0;
    ball[B.SCATTER] = clamp(ball[B.SCATTER] ?? 0, 0, maxScatterFor(ball[B.DROP]));

    return ball;
}

/** True when a step holds more than one variant (runner picks at random). */
export function isMultiVariant(step) {
    return Array.isArray(step) && step.length > 1;
}

/** One-line human summary, used in the preset picker and tooltips. */
export function describeBall(ball) {
    const speed = ball[B.SPEED];
    const spin = ball[B.SPIN];
    const type = ball[B.TYPE];
    const bpm = freqToBpm(ball[B.FREQ]);
    if (speed === undefined) {
        const rev = reverseCalculate(ball[B.TOP], ball[B.BOT]);
        return `Speed ${rev.speed} · Spin ${rev.spin} · ${rev.type.toUpperCase()} · ${bpm} bpm`;
    }
    return `Speed ${speed} · Spin ${spin} · ${type.toUpperCase()} · ${bpm} bpm`;
}
