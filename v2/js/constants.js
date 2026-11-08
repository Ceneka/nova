export const SERVICE_UUID = 0xfeff;
export const UUID_S = "02f00000-0000-0000-0000-00000000fe00";
export const UUID_N = "02f00000-0000-0000-0000-00000000ff02";
export const UUID_W = "02f00000-0000-0000-0000-00000000ff01";
export const SALT = "Mjgx1jAwXDBaMFcxCz3JBgNVBAYT4kJF7Rkw";
export const MSG_DONE = "00020300050100";

export const CATEGORIES = {
    basic: ["push(b)", "push(f)", "drive(b)", "drive(f)", "loop(b)", "loop(f)"],
    combined: ["loop(b)-drive(b)", "loop(f)-drive(f)", "drive(f)-drive(b)", "push(f)-drive(f)", "push(b)-loop(b)", "loop(f)-drive(b)", "push(f)-loop(b)", "drive(f)-drive(f)", "push(b)-loop(f)", "push(f)-loop(f)", "loop(f)-loop(f)", "loop(b)-drive(f)"],
    complex: ["push(b)-loop(f)-drive(b)", "push(f)-loop(b)-drive(f)", "loop(f)-drive(f)-drive(b)", "loop(b)-drive(f)-drive(b)", "drive(f)-drive(f)-drive(f)", "push(f)-loop(f)-drive(f)", "push(b)-loop(b)-drive(b)", "push(f)-loop(b)-drive(b)", "loop(f)-drive(b)-drive(f)", "loop(b)-drive(b)-drive(f)", "push(b)-loop(f)-drive(f)", "push(b)-loop(b)-drive(f)", "drive(b)-drive(f)-drive(f)", "random-drive", "23-random-drive", "all-random"],
    "custom-a": [], "custom-b": [], "custom-c": [] 
};

// Physics Constants
export const RPM_MIN = 400;
export const RPM_MAX = 7500;

// Constraints: Speed (Key) -> Max Spin (Value)
export const SPIN_LIMITS = {
    "0": 2, "0.5": 3, 
    "1": 4, "1.5": 5, 
    "2": 6, "2.5": 7, 
    "3": 8, "3.5": 9, 
    "4": 10, "4.5": 10, 
    "5": 9, "5.5": 8, 
    "6": 8, "6.5": 7, 
    "7": 6, "7.5": 5, 
    "8": 4, "8.5": 3, 
    "9": 2, "9.5": 1, 
    "10": 0
};

/**
 * A step whose ball carries its editor fields (speed / spin / type) as well as
 * the raw motor RPMs.
 *
 * Every factory ball is stored this way now. The push needs it: at speed 2 the
 * table allows spin 6, but the backspin top wheel clamps at RPM_MIN, so
 * reverse-calculating [400, 4283] would show 5.5 instead of the 6 the drill
 * was built with. Indexes 7-9 are the ball array's optional editor fields -
 * see ball.js.
 */
const mkBallStep = (t, b, h, d, f, r, speed, spin, type) =>
    [[t, b, h, d, f, r, 1, speed, spin, type]];

/**
 * The factory library's ball recipes.
 *
 * These replace the old +50 / +55 / +60 rally balls, which were reported as
 * not working directly: every one of them floated high. The six Level-1
 * balls below are the validated reference (short two-bounce push, low drives
 * and loops). Levels 2 and 3 are the same shot with a little more speed, spin
 * and pace - never a higher arc. Combined, complex and random drills are
 * sequences of these same balls, so a drill cannot reintroduce a shot that
 * was not validated.
 */
const BALLS = {
    pushB: {
        1: mkBallStep(400, 4283, -43, -5, 10, 1, 2, 6, 'back'),
        2: mkBallStep(400, 4769, -43, -5, 20, 1, 2.5, 6.5, 'back'),
        3: mkBallStep(468, 5256, -43, -5, 30, 1, 3, 7, 'back'),
    },
    pushF: {
        1: mkBallStep(400, 4283, -43, 5, 10, 1, 2, 6, 'back'),
        2: mkBallStep(400, 4769, -43, 5, 20, 1, 2.5, 6.5, 'back'),
        3: mkBallStep(468, 5256, -43, 5, 30, 1, 3, 7, 'back'),
    },
    driveB: {
        1: mkBallStep(3546, 2178, 30, -4, 73.33333333333334, 1, 3, 2, 'top'),
        2: mkBallStep(4032, 2322, 30, -4, 83.33333333333334, 1, 3.5, 2.5, 'top'),
        3: mkBallStep(4518, 2466, 30, -4, 93.33333333333334, 1, 4, 3, 'top'),
    },
    driveF: {
        1: mkBallStep(3204, 2520, 30, 5, 56.66666666666667, 1, 3, 1, 'top'),
        2: mkBallStep(3690, 2664, 30, 5, 66.66666666666667, 1, 3.5, 1.5, 'top'),
        3: mkBallStep(4176, 2808, 30, 5, 76.66666666666667, 1, 4, 2, 'top'),
    },
    loopB: {
        1: mkBallStep(1178, 3914, 20, -5, 10, 1, 2.5, 4, 'back'),
        2: mkBallStep(1323, 4401, 20, -5, 20, 1, 3, 4.5, 'back'),
        3: mkBallStep(1467, 4887, 20, -5, 30, 1, 3.5, 5, 'back'),
    },
    loopF: {
        1: mkBallStep(836, 4256, 20, 5, 10, 1, 2.5, 5, 'back'),
        2: mkBallStep(981, 4743, 20, 5, 20, 1, 3, 5.5, 'back'),
        3: mkBallStep(1125, 5229, 20, 5, 30, 1, 3.5, 6, 'back'),
    }
};

/** A one-ball drill: the same shot at each of the three levels. */
const one = (id) => ({ 1: [BALLS[id][1]], 2: [BALLS[id][2]], 3: [BALLS[id][3]] });

/** A sequence drill: one step per ball, each at the selected level. */
const seq = (ids, random = false) => ({
    1: ids.map(id => BALLS[id][1]),
    2: ids.map(id => BALLS[id][2]),
    3: ids.map(id => BALLS[id][3]),
    ...(random ? { random: true } : {})
});

export const DEFAULT_DRILLS = {
    // --- BASIC ---
    "push(b)": one('pushB'),
    "push(f)": one('pushF'),
    "drive(b)": one('driveB'),
    "drive(f)": one('driveF'),
    "loop(f)": one('loopF'),
    "loop(b)": one('loopB'),

    // --- COMBINED ---
    "loop(b)-drive(b)": seq(['loopB', 'driveB']),
    "loop(f)-drive(f)": seq(['loopF', 'driveF']),
    "drive(f)-drive(b)": seq(['driveF', 'driveB']),
    "push(f)-drive(f)": seq(['pushF', 'driveF']),
    "push(b)-loop(b)": seq(['pushB', 'loopB']),
    "loop(f)-drive(b)": seq(['loopF', 'driveB']),
    "push(f)-loop(b)": seq(['pushF', 'loopB']),
    "drive(f)-drive(f)": seq(['driveF', 'driveF']),
    "push(b)-loop(f)": seq(['pushB', 'loopF']),
    "push(f)-loop(f)": seq(['pushF', 'loopF']),
    "loop(f)-loop(f)": seq(['loopF', 'loopF']),
    "loop(b)-drive(f)": seq(['loopB', 'driveF']),

    // --- COMPLEX ---
    "push(b)-loop(f)-drive(b)": seq(['pushB', 'loopF', 'driveB']),
    "push(f)-loop(b)-drive(f)": seq(['pushF', 'loopB', 'driveF']),
    "loop(f)-drive(f)-drive(b)": seq(['loopF', 'driveF', 'driveB']),
    "loop(b)-drive(f)-drive(b)": seq(['loopB', 'driveF', 'driveB']),
    "drive(f)-drive(f)-drive(f)": seq(['driveF', 'driveF', 'driveF']),
    "push(f)-loop(f)-drive(f)": seq(['pushF', 'loopF', 'driveF']),
    "push(b)-loop(b)-drive(b)": seq(['pushB', 'loopB', 'driveB']),
    "push(f)-loop(b)-drive(b)": seq(['pushF', 'loopB', 'driveB']),
    "loop(f)-drive(b)-drive(f)": seq(['loopF', 'driveB', 'driveF']),
    "loop(b)-drive(b)-drive(f)": seq(['loopB', 'driveB', 'driveF']),
    "push(b)-loop(f)-drive(f)": seq(['pushB', 'loopF', 'driveF']),
    "push(b)-loop(b)-drive(f)": seq(['pushB', 'loopB', 'driveF']),
    "drive(b)-drive(f)-drive(f)": seq(['driveB', 'driveF', 'driveF']),

    // --- RANDOM ---
    "random-drive": seq(['driveF', 'driveB'], true),
    "23-random-drive": seq(['driveF', 'driveB', 'driveF'], true),
    "all-random": seq(['pushF', 'pushB', 'driveF', 'driveB'], true)
};
