import { B, LIMITS, makeBall, freqToBpm, maxSpinFor, maxScatterFor } from './ball.js';
import { t } from './i18n.js';
import { clamp } from './utils.js';

const STORAGE_KEY = 'nova_ball_presets';

/** A drill sequence is documented as holding 20 balls; keep inserts inside that. */
export const MAX_STEPS_PER_DRILL = 20;

/**
 * A preset is a named ball recipe plus up to two variation axes:
 *
 *   placements -> lateral position, writes the drop  (-10 backhand .. 10 forehand)
 *   depths     -> how deep it lands, writes the height (-50 .. 100)
 *
 * Both axes are optional. With an axis empty the preset's own drop/height is
 * used, so a preset always expands to at least one ball.
 *
 * Placement labels are named from the RECEIVER's point of view for a
 * right-handed receiver, matching the app's own factory convention (see
 * constants.js: push(b) uses drop -5, push(f) uses drop +5) - so backhand is
 * a negative drop and forehand positive.
 */
/**
 * Three placements spaced 5 apart, anchored so the ball the user started from
 * is kept in the set (a ball dropped at +3 yields -2 / +3 / +8).
 */
export function standardPlacements(baseDrop = 0) {
    const step = 5;
    const center = clamp(baseDrop, -10 + step, 10 - step);
    return [
        { label: 'BH', drop: center - step },
        { label: 'Center', drop: center },
        { label: 'FH', drop: center + step }
    ];
}

/** Same idea on the height axis: three depths spaced 20 apart. */
export function standardDepths(baseHeight = 50) {
    const step = 20;
    const center = clamp(baseHeight, -50 + step, 100 - step);
    return [
        { label: 'Short', height: center - step },
        { label: 'Mid', height: center },
        { label: 'Long', height: center + step }
    ];
}

const mk = (id, name, speed, spin, type, height, drop, bpm, reps = 1, scatter = 0) => ({
    id, name, builtIn: true,
    speed, spin, type, height, drop, bpm, reps, scatter,
    placements: standardPlacements(drop),
    depths: standardDepths(height)
});

/** Shipped starter library. Anything here can be edited, renamed or deleted. */
export const DEFAULT_PRESETS = [
    mk('preset_short_under', 'Short under serve', 4, 1.5, 'top', 30, 0, 60),
    mk('preset_long_under', 'Long under serve', 5, 1, 'top', 55, 0, 60),
    mk('preset_short_side', 'Short sidespin serve', 5, 3, 'back', 25, 0, 66),
    mk('preset_long_side', 'Long sidespin serve', 6, 3.5, 'back', 55, 0, 60),
    mk('preset_heavy_push', 'Heavy backspin push', 1.5, 4, 'back', 45, -5, 45),
    mk('preset_safe_push', 'Safe push', 1.5, 1, 'top', 40, -5, 40),
    mk('preset_fast_drive', 'Fast drive', 5, 3, 'top', 55, -5, 72),
    // 'top', not 'back'. The name has always said Topspin and a loop IS a
    // topspin ball; stored as backspin it both played the wrong rotation and
    // made the matcher treat it as a backspin preset, so a backspin serve
    // matched it over the sidespin serve the sentence actually meant.
    mk('preset_loop', 'Topspin loop', 4, 3.5, 'top', 60, -5, 60)
];

// --- STORE -----------------------------------------------------------------

let presets = null;

export const clonePreset = (p) => ({
    id: p.id,
    name: p.name,
    builtIn: !!p.builtIn,
    speed: p.speed,
    spin: p.spin,
    type: p.type,
    height: p.height,
    drop: p.drop,
    bpm: p.bpm,
    reps: p.reps,
    scatter: p.scatter,
    placements: (p.placements || []).map(pl => ({ label: pl.label, drop: pl.drop })),
    depths: (p.depths || []).map(d => ({ label: d.label, height: d.height }))
});

/** Parse a number, falling back only when the value is genuinely missing. */
const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

export function normalizePreset(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') return null;

    const speed = clamp(num(raw.speed, 5), ...LIMITS.speed);
    const drop = clamp(num(raw.drop, 0), ...LIMITS.drop);
    const height = clamp(num(raw.height, 50), ...LIMITS.height);

    const placements = (Array.isArray(raw.placements) ? raw.placements : [])
        .filter(pl => pl && typeof pl === 'object')
        .map(pl => ({
            label: String(pl.label ?? '').slice(0, 12) || 'Spot',
            drop: clamp(num(pl.drop, 0), ...LIMITS.drop)
        }));

    const depths = (Array.isArray(raw.depths) ? raw.depths : [])
        .filter(d => d && typeof d === 'object')
        .map(d => ({
            label: String(d.label ?? '').slice(0, 12) || 'Depth',
            height: clamp(num(d.height, 50), ...LIMITS.height)
        }));

    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
        name: String(raw.name).slice(0, 30),
        builtIn: !!raw.builtIn,
        speed,
        spin: clamp(num(raw.spin, 0), 0, maxSpinFor(speed)),
        type: raw.type === 'back' ? 'back' : 'top',
        height,
        drop,
        bpm: clamp(num(raw.bpm, 60), ...LIMITS.bpm),
        reps: clamp(num(raw.reps, 1), ...LIMITS.reps),
        scatter: clamp(num(raw.scatter, 0), 0, maxScatterFor(drop)),
        placements,
        depths
    };
}

export function generateId() {
    return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getPresets() {
    if (!presets) presets = DEFAULT_PRESETS.map(clonePreset);
    return presets;
}

export function getPresetById(id) {
    return getPresets().find(p => p.id === id) || null;
}

export function savePresetsToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getPresets()));
    } catch (e) {
        console.error('Could not persist presets', e);
    }
}

/** Call once from initData(). A corrupt or absent store falls back to defaults. */
export function loadPresets() {
    let parsed = null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) parsed = JSON.parse(raw);
    } catch (e) {
        console.error('Could not read presets', e);
    }

    if (!Array.isArray(parsed)) {
        presets = DEFAULT_PRESETS.map(clonePreset);
        savePresetsToStorage();
        return;
    }

    const clean = parsed.map(normalizePreset).filter(Boolean);
    presets = clean.length ? clean : DEFAULT_PRESETS.map(clonePreset);
    savePresetsToStorage();
}

/** Replaces the library outright. An empty list is honoured as "no presets". */
export function setPresets(list) {
    presets = (Array.isArray(list) ? list : []).map(normalizePreset).filter(Boolean);
    savePresetsToStorage();
    return presets;
}

export function addPreset(preset) {
    const clean = normalizePreset(preset);
    if (!clean) return null;
    clean.id = generateId();
    clean.builtIn = false;
    getPresets().push(clean);
    savePresetsToStorage();
    return clean;
}

export function updatePreset(id, patch) {
    const list = getPresets();
    const idx = list.findIndex(p => p.id === id);
    if (idx === -1) return null;
    const merged = normalizePreset({ ...list[idx], ...patch, id });
    if (!merged) return null;
    list[idx] = merged;
    savePresetsToStorage();
    return merged;
}

export function deletePreset(id) {
    const list = getPresets();
    const idx = list.findIndex(p => p.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    savePresetsToStorage();
    return true;
}

export function resetPresetsToDefaults() {
    presets = DEFAULT_PRESETS.map(clonePreset);
    savePresetsToStorage();
    return presets;
}

// --- PRESET -> BALLS --------------------------------------------------------

/**
 * Expand a preset into its full cross-product of placements x depths.
 * Placements are the inner loop so the result reads BH, Center, FH per depth,
 * which is the order a human would feed them.
 */
export function buildPresetBalls(preset) {
    const placements = preset.placements?.length
        ? preset.placements
        : [{ label: '', drop: preset.drop }];

    const depths = preset.depths?.length
        ? preset.depths
        : [{ label: '', height: preset.height }];

    const balls = [];
    for (const depth of depths) {
        for (const placement of placements) {
            balls.push(makeBall({
                speed: preset.speed,
                spin: preset.spin,
                type: preset.type,
                height: depth.height,
                drop: placement.drop,
                bpm: preset.bpm,
                reps: preset.reps,
                scatter: 0,
                active: 1
            }));
        }
    }
    return balls;
}

/** How many balls a full expansion produces. */
export function presetBallCount(preset) {
    const p = preset.placements?.length || 1;
    const d = preset.depths?.length || 1;
    return p * d;
}

/** One step whose variants the runner picks from at random. */
export function buildVariantStep(preset) {
    return buildPresetBalls(preset);
}

/** One step per ball, in order - a fixed BH / Center / FH pattern. */
export function buildSequenceSteps(preset) {
    return buildPresetBalls(preset).map(ball => [ball]);
}

/** The single ball a preset represents when no variation is wanted. */
export function buildSingleBall(preset) {
    return makeBall({
        speed: preset.speed,
        spin: preset.spin,
        type: preset.type,
        height: preset.height,
        drop: preset.drop,
        bpm: preset.bpm,
        reps: preset.reps,
        scatter: preset.scatter,
        active: 1
    });
}

/** Build a preset out of a ball currently sitting in the drill editor. */
export function presetFromBall(ball, name) {
    const speed = ball[B.SPEED] ?? 5;
    const spin = ball[B.SPIN] ?? 0;
    return normalizePreset({
        id: generateId(),
        name: name || 'Custom ball',
        builtIn: false,
        speed,
        spin,
        type: ball[B.TYPE] ?? 'top',
        height: ball[B.HEIGHT],
        drop: ball[B.DROP],
        bpm: freqToBpm(ball[B.FREQ]),
        reps: ball[B.REPS],
        scatter: ball[B.SCATTER] ?? 0,
        placements: [],
        depths: []
    });
}

/** "Speed 4 · Spin 1.5 · TOP · 60 bpm" - the card subtitle. */
export function describePreset(preset) {
    return t('preset.describe', {
        speed: preset.speed,
        spin: preset.spin,
        type: preset.type.toUpperCase(),
        bpm: preset.bpm
    });
}

// --- IMPORT / EXPORT --------------------------------------------------------
// Kept deliberately separate from the drill CSV in state.js, whose format is
// shared with other apps and must not change.

const CSV_HEADER = 'Name;Id;Speed;Spin;Type;BPM;Reps;Scatter;Height;Drop;Axis;Label;Value';

export function serializePresetsToJSON() {
    return JSON.stringify(getPresets().map(clonePreset), null, 2);
}

export function parsePresetsJSON(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (Array.isArray(data.presets) ? data.presets : null);
    if (!list) throw new Error('Not a preset file');
    return list.map(normalizePreset).filter(Boolean);
}

/**
 * Flat, human-readable CSV: one row per axis entry, grouped by Id.
 *   ...;Axis=PLACEMENT;Label=BH;Value=-5
 */
export function serializePresetsToCSV() {
    const esc = (v) => {
        const s = String(v ?? '');
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [CSV_HEADER];

    for (const p of getPresets()) {
        const base = [p.name, p.id, p.speed, p.spin, p.type, p.bpm, p.reps, p.scatter, p.height, p.drop];
        lines.push([...base, 'BASE', '', ''].map(esc).join(';'));
        for (const pl of p.placements) lines.push([...base, 'PLACEMENT', pl.label, pl.drop].map(esc).join(';'));
        for (const d of p.depths) lines.push([...base, 'DEPTH', d.label, d.height].map(esc).join(';'));
    }

    return lines.join('\n') + '\n';
}

export function parsePresetsCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new Error('Empty file');

    const split = (line) => {
        const out = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') inQuotes = false;
                else cur += ch;
            } else if (ch === '"') inQuotes = true;
            else if (ch === ';') { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out.map(s => s.trim());
    };

    if (split(lines[0]).slice(1, 2).join('').toLowerCase() !== 'id') {
        throw new Error('Unrecognised CSV header');
    }

    const byId = new Map();
    for (const line of lines.slice(1)) {
        const c = split(line);
        if (c.length < 11) continue;

        let p = byId.get(c[1]);
        if (!p) {
            p = {
                id: c[1], name: c[0], speed: c[2], spin: c[3], type: c[4],
                bpm: c[5], reps: c[6], scatter: c[7], height: c[8], drop: c[9],
                placements: [], depths: []
            };
            byId.set(c[1], p);
        }

        const axis = (c[10] || '').toUpperCase();
        const value = Number(c[12]);
        if (axis === 'PLACEMENT') p.placements.push({ label: c[11] || 'Spot', drop: Number.isFinite(value) ? value : 0 });
        else if (axis === 'DEPTH') p.depths.push({ label: c[11] || 'Depth', height: Number.isFinite(value) ? value : 0 });
    }

    return [...byId.values()].map(normalizePreset).filter(Boolean);
}

/** Sniff the format so one file input can take both. */
export function parsePresetsAuto(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parsePresetsJSON(trimmed);
    return parsePresetsCSV(trimmed);
}

/**
 * Merge an imported library into the current one.
 * Returns { added, updated } - built-ins are refreshed, user presets with a
 * clashing name are skipped so an import can never silently destroy work.
 */
export function mergePresets(incoming) {
    const list = getPresets();
    let added = 0, updated = 0;

    for (const raw of incoming) {
        const preset = normalizePreset(raw);
        if (!preset) continue;

        const byId = list.findIndex(p => p.id === preset.id);
        if (byId !== -1) {
            list[byId] = { ...preset, builtIn: list[byId].builtIn };
            updated++;
            continue;
        }

        const nameTaken = list.findIndex(p => p.name.toLowerCase() === preset.name.toLowerCase());
        if (nameTaken !== -1) continue;

        list.push(preset);
        added++;
    }

    savePresetsToStorage();
    return { added, updated };
}
