/**
 * Where the robot stands on its half of the table, and what that does to a
 * ball.
 *
 * The nine-square grid is the original Pongbot app's idea, and it is numbered
 * like a phone keypad seen from the PLAYER's end of the table:
 *
 *      7  8  9      near the net
 *      4  5  6      middle
 *      1  2  3      back edge (the robot's standard position)
 *
 * So 2 is the standard back-centre spot, 3 is back-right and 7 is near-net
 * left. Left and right are the player's left and right, which is the same
 * convention the `drop` axis uses (negative is the receiver's backhand).
 *
 * ## Why a position is not just a label
 *
 * The robot has no position sensor and the packet (packBall in bluetooth.js)
 * carries no board coordinates: the app sends a head angle, a lateral angle,
 * wheel speeds and a frequency. Moving the robot changes where those numbers
 * land the ball, so a drill calibrated at position 2 does not mean the same
 * thing at position 8. This module compensates for that before the packet is
 * built, so switching the grid changes how an existing drill plays without
 * rewriting the drill.
 *
 * The lateral term is geometry: if the robot is standing a column to the
 * player's left, every ball lands a column to the left, so aiming the same
 * drill back at its original target means adding the opposite drop.
 *
 * The depth term is a first-pass approximation, not a measured projectile
 * model. Standing closer to the net means the same launch angle and wheel
 * speed carry the ball further, so the compensation lowers the angle (scaling
 * its magnitude, which preserves the sign of a two-bounce serve) and trims the
 * speed. The exact numbers need a real table: they live in ROW_PROFILE so a
 * calibration pass changes one table rather than three call sites.
 *
 * The ball's stored numbers are never edited. `applyRobotPosition()` returns a
 * copy, used by the runner and the editor's Test button, so the same drill can
 * be played from every square in the grid.
 *
 * Node-safe: localStorage is touched only inside the accessors, and only
 * inside a try/catch.
 */

import { B, LIMITS, freqToBpm, makeBall, normalizeBall } from './ball.js';
import { clamp } from './utils.js';

export const STORAGE_KEY = 'nova_robot_position';

/** Back-centre: the manual's "standard position", and the calibrated origin. */
export const DEFAULT_POSITION = 2;

export const POSITION_COUNT = 9;

/**
 * Lateral offset of each column, in drop units, from the PLAYER's view.
 * Negative is the player's left. The grid is 3 columns wide, so the centre
 * column is always the calibrated origin.
 */
const COLUMN_DROP = [-4, 0, 4];

/**
 * Longitudinal compensation, indexed by row: 0 = back, 1 = middle, 2 = near
 * net. `heightScale` multiplies the ball's height (keeping its sign, because a
 * negative height is a two-bounce serve and must stay one), and `speedDelta`
 * is added to the editor-facing 0-10 speed.
 *
 * These are the numbers to re-tune after testing on a real table. They are
 * deliberately gentle: an unverified model that overshoots is worse than one
 * that nudges.
 */
const ROW_PROFILE = [
    { heightScale: 1.0, speedDelta: 0 },
    { heightScale: 0.85, speedDelta: -0.5 },
    { heightScale: 0.7, speedDelta: -1.0 }
];

/** Coerce anything into a real grid square. */
export function normalizePosition(value) {
    // `Number(null)` is 0, which would make "never chosen" read as square 1.
    // An absent value means the standard position, not the back-left corner.
    if (value === null || value === undefined || value === '') return DEFAULT_POSITION;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? clamp(n, 1, POSITION_COUNT) : DEFAULT_POSITION;
}

/** 0 (back) .. 2 (near net). */
export function positionRow(value) {
    return Math.floor((normalizePosition(value) - 1) / 3);
}

/** 0 (player's left) .. 2 (player's right). */
export function positionCol(value) {
    return (normalizePosition(value) - 1) % 3;
}

export function getRobotPosition() {
    try {
        if (typeof localStorage === 'undefined' || !localStorage) return DEFAULT_POSITION;
        return normalizePosition(localStorage.getItem(STORAGE_KEY));
    } catch {
        return DEFAULT_POSITION;
    }
}

export function setRobotPosition(value) {
    const n = normalizePosition(value);
    try {
        if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.setItem(STORAGE_KEY, String(n));
        }
    } catch {
        /* a full store costs the remembered square, not the session */
    }
    return n;
}

/** The raw compensation for a square, exposed so the UI can describe it. */
export function positionAdjustment(value) {
    const row = positionRow(value);
    const col = positionCol(value);
    return {
        drop: -COLUMN_DROP[col],
        heightScale: ROW_PROFILE[row].heightScale,
        speedDelta: ROW_PROFILE[row].speedDelta
    };
}

/**
 * A compensated copy of a ball. Position 2 is the calibrated origin and is
 * returned as a plain clone, so the common case is byte-for-byte the ball
 * that was stored - including a legacy raw-RPM array.
 */
export function applyRobotPosition(ball, position = DEFAULT_POSITION) {
    if (!Array.isArray(ball)) return ball;
    if (ball.length < 2) return ball.slice();
    const n = normalizePosition(position);
    if (n === DEFAULT_POSITION) return ball.slice();

    const copy = normalizeBall(ball.slice());
    const { drop, heightScale, speedDelta } = positionAdjustment(n);

    return makeBall({
        speed: clamp(copy[B.SPEED] + speedDelta, ...LIMITS.speed),
        spin: copy[B.SPIN],
        type: copy[B.TYPE],
        height: clamp(copy[B.HEIGHT] * heightScale, ...LIMITS.height),
        drop: clamp(copy[B.DROP] + drop, ...LIMITS.drop),
        bpm: freqToBpm(copy[B.FREQ]),
        reps: copy[B.REPS],
        scatter: copy[B.SCATTER] ?? 0,
        active: copy[B.ACTIVE]
    });
}
