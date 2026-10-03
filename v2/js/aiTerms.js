/**
 * The assistant's ontology, and the bilingual vocabulary that drives it.
 *
 * ## Why this file exists on its own
 *
 * The ball array is a flat 11-slot array with three constraints an LLM gets
 * subtly wrong: `active === undefined` means ON, spin is capped by speed
 * through `SPIN_LIMITS`, and `abs(drop) + scatter <= 10`. So **the model never
 * writes ball numbers.** It writes an *intent* in the user's own words, and the
 * same two pure functions - `parseUtterance()` here, `compile()` in
 * `aiCompile.js` - turn that into the real array whether the intent came from
 * the deterministic tier or from the model tier. That makes invalid arrays
 * structurally impossible, and it makes the whole of Tier 0 testable in bare
 * Node with no network.
 *
 * ## The vocabulary is data, not a locale file
 *
 * These are the words a coach uses at a table, in two languages, and they are
 * *inputs* - whatever the user says, in whatever language they think in, even
 * when the app is set to the other one. They are not UI chrome, so they are
 * not in `js/locales/`: a dictionary value must be a string or `{one, other}`
 * (see `i18n.js`), and this is a table of many-to-many synonyms. The *chrome
 * around* the assistant is in the dictionaries; this is not.
 *
 * `aiClient.js` renders the same table into the system prompt, which is the
 * point of keeping it here: the deterministic tier and the model tier cannot
 * drift apart, because they are literally reading the same list.
 *
 * ## The `serve` / `push` collision
 *
 * "Saque" and "push" are the same word in this app - the factory key `push(b)`
 * is labelled "Saque(Rev.)" in Spanish. But in table tennis a serve and a rally
 * push are opposite ends of the table, and the difference (speed 4.5 vs 1.5,
 * height 30 vs 45) is the whole point of telling them apart. So one vocabulary
 * entry, two readings, and a fixed rule rather than a guess:
 *
 *     a depth word present  -> it is a SERVE      "saque corto", "push largo"
 *     no depth word         -> it is a PUSH      "push b", "push suave"
 *
 * `parseUtterance()` records which reading it took, so the assistant can say so
 * out loud instead of silently picking one.
 *
 * ## The `drop` sign
 *
 * `side` uses the app's own vocabulary - `bh` / `center` / `fh` - which
 * `axisLabel()` already renders as "Rev. / Centro / Der." in Spanish and
 * "BH / Center / FH" in English, and which `standardPlacements()` already
 * writes as the stored labels. The sign is fixed by `constants.js`:
 * backhand is a NEGATIVE drop, forehand POSITIVE. See the `## The drop sign`
 * block in `ball.js`; the wrong version of this comment was in three files at
 * once once already.
 *
 * ## Node safety
 *
 * No `document`, no `window`, no `localStorage`, nothing at module scope but
 * plain data and pure functions. `tests/ai.test.mjs` imports this under bare
 * Node, which is the only reason Tier 0 can be tested without a network.
 */

// --- the ontology -----------------------------------------------------------

/**
 * `serve` and `push` are the two readings of the same vocabulary entry - see
 * the header block. They are both roles because the compiler has a different
 * default speed, spin and height for each, and collapsing them would throw
 * away the one distinction the sentence is usually making.
 */
export const ROLES = ['serve', 'push', 'drive', 'loop', 'block'];
export const ROTATIONS = ['top', 'back', 'side', 'flat'];
export const SIDES = ['bh', 'center', 'fh'];
export const DEPTHS = ['short', 'mid', 'long'];

/** "All three sides" is how the user asks for the standard placement axis. */
export const ALL_SIDES = SIDES;
export const ALL_DEPTHS = DEPTHS;

/** `intensity` is 0..10 with 5 as neutral; the words below pick a point on it. */
export const INTENSITY = { low: 2.5, mid: 5, high: 7.5 };
export const NEUTRAL_INTENSITY = 5;

// --- what each role is supposed to be ---------------------------------------
//
// This is the one place the numbers behind the words live, and it is shared by
// the compiler (which builds the ball) and the matcher (which decides which
// preset stands in for it). They have to agree: a matcher scoring presets
// against a different idea of "a push" than the compiler builds would pick a
// preset and then compile something else.
//
// The serve short/long split is the point of it. A serve and a rally push are
// opposite ends of the table - speed 4.5 against 1.5, height 30 against 45 -
// and "saque"/"push" are the same word in this app, so this table is what
// keeps the two readings apart.

export const ROLE_DEFAULTS = {
    serve: { speed: 4.5, spin: 2.5, type: 'back', height: -35, drop: null, bpm: 60 },
    // A long serve is a different ball, not a tweak of the short one.
    serveLong: { speed: 5.5, spin: 3, type: 'back', height: -50, drop: null, bpm: 60 },
    push: { speed: 1.5, spin: 4, type: 'back', height: 45, drop: -5, bpm: 45 },
    drive: { speed: 5, spin: 3, type: 'top', height: 55, drop: -5, bpm: 72 },
    loop: { speed: 4, spin: 3.5, type: 'back', height: 60, drop: -5, bpm: 60 },
    block: { speed: 2, spin: 1, type: 'top', height: 70, drop: 0, bpm: 80 }
};

/**
 * A serve is the one role whose height genuinely varies with the depth word.
 *
 * **Height is the ROBOT'S HEAD HEIGHT, not a direction of travel.** 0 is a
 * horizontal ball off the head: it would need real speed and topspin to dip
 * over the net, and a backspin cut would never reach the far half at all. So a
 * serve height is where the head launches from, and these are negative because
 * a serve is launched from below the table line - the ball bounces on the
 * robot's side, clears the net and bounces on the far side.
 *
 * The values are the robot's, given by the user who owns it:
 *   -35 short, -40 mid, -45 long.
 * A long serve is the hardest of the three: -45 can be done but it is a
 * harder ball to place. `10` is very high; `0` is flat.
 *
 * The ball array's own limit is -50 .. 100, so a long serve is not at the
 * floor - it is 5 above it.
 */
export const SERVE_HEIGHTS = { short: -35, mid: -40, long: -45 };

/**
 * Lateral placement, from the receiver's point of view for a right-handed
 * receiver: backhand is a NEGATIVE drop, forehand POSITIVE. Fixed by
 * `constants.js` - `push(b)` is drop -5 and `push(f)` is drop +5 - and asserted
 * against that data in tests/ai.test.mjs, because the wrong version of this
 * comment was in three files at once once already.
 */
export const SIDE_DROP = { bh: -5, center: 0, fh: 5 };

/** Nominal depth for the roles that do not carry their own. A proxy, not a height. */
export const DEPTH_HEIGHT = { short: 30, mid: 50, long: 70 };

/** How far "fuerte" / "suave" may move the speed, in either direction. */
export const INTENSITY_RANGE = 2;

/** The explicit "con dispersion" ask. Small on purpose. */
export const SCATTER_UNITS = 2;

/** The role defaults for an intent, picking the long-serve variant if asked. */
export function baseFor(intent) {
    if (!intent || !intent.role) return ROLE_DEFAULTS.serve;
    if (intent.role === 'serve') {
        return intent.depth === 'long' ? ROLE_DEFAULTS.serveLong : ROLE_DEFAULTS.serve;
    }
    return ROLE_DEFAULTS[intent.role] || ROLE_DEFAULTS.serve;
}

/**
 * The ball this intent is asking for, as three numbers the matcher can compare
 * a preset against. `null` means "the sentence said nothing about this", which
 * is not the same as "said 5", which is neutral.
 */
export function expectationFor(intent) {
    if (!intent || !intent.role) return { speed: null, height: null, drop: null };
    const base = baseFor(intent);
    const intensity = Number.isFinite(intent.intensity) ? intent.intensity : NEUTRAL_INTENSITY;

    return {
        speed: base.speed + (intensity - NEUTRAL_INTENSITY) / 5 * INTENSITY_RANGE,
        // Only a serve carries a height per depth; for everything else the
        // generic nominal is the better guess, and the matched preset's own
        // height wins over both.
        height: !intent.depth ? base.height
            : intent.role === 'serve' ? (SERVE_HEIGHTS[intent.depth] ?? base.height)
            : (DEPTH_HEIGHT[intent.depth] ?? base.height),
        drop: intent.side ? (SIDE_DROP[intent.side] ?? 0) : base.drop
    };
}

// --- the vocabulary ---------------------------------------------------------
//
// Every phrase is stored already folded (lowercase, no accents), because that
// is the form `parseUtterance()` matches against. `fold()` is the only place
// that knows it. `label` is what the assistant says back, per language, and is
// the only place the readouts get their words.
//
// `also` fills a second slot from the same phrase. "al medio" is one idea in
// the user's head - the middle - and this app has two axes, so it sets the
// centre of the drop axis and the middle of the depth axis at once.

const VOCAB = {
    // A stroke. `serve` and `push` are disambiguated by the depth rule above.
    role: {
        serve: {
            es: ['saque', 'saques', 'sacar', 'saca', 'saquear', 'sirva', 'sirve', 'servir', 'serve', 'sirviendo'],
            en: ['serve', 'serves', 'serving'],
            label: { es: 'saque', en: 'serve' }
        },
        push: {
            es: ['push', 'pushea', 'pushear', 'empuje', 'empuja', 'empujado'],
            en: ['push', 'pushes'],
            label: { es: 'push', en: 'push' }
        },
        drive: {
            es: ['drive', 'golpe', 'golpear', 'driveo', 'golpeo'],
            en: ['drive', 'drives', 'hit'],
            label: { es: 'drive', en: 'drive' }
        },
        loop: {
            es: ['loop', 'loops', 'liftado', 'liftada', 'alzado'],
            en: ['loop', 'loops', 'lift'],
            label: { es: 'loop', en: 'loop' }
        },
        block: {
            es: ['bloqueo', 'bloquear', 'bloque', 'tapado', 'bloqueo activo'],
            en: ['block', 'blocks', 'blockball'],
            label: { es: 'bloqueo', en: 'block' }
        }
    },

    // How the ball is spinning. Decides `type` in the compiled array.
    rotation: {
        top: {
            es: ['top', 'topspin', 'top spin', 'liftada', 'levantada'],
            en: ['top', 'topspin', 'tops'],
            label: { es: 'top', en: 'topspin' }
        },
        back: {
            es: ['cortado', 'corte', 'backspin', 'back spin', 'cortada'],
            en: ['back', 'backspin', 'cut', 'chop'],
            label: { es: 'cortado', en: 'backspin' }
        },
        side: {
            es: ['lateral', 'cruzado', 'cruzada', 'sidespin', 'side spin', 'tornado'],
            en: ['side', 'sidespin', 'cross', 'sidespun'],
            label: { es: 'lateral', en: 'sidespin' }
        },
        flat: {
            es: ['plano', 'plana', 'liso', 'recto'],
            en: ['flat', 'plain', 'flatspin'],
            label: { es: 'plano', en: 'flat' }
        }
    },

    // Lateral placement. The `drop` axis, from the receiver's point of view:
    // backhand is negative, forehand positive (see ball.js).
    side: {
        bh: {
            es: ['al reves', 'reves', 'la izquierda', 'izquierda', 'bh', 'de reves', 'por izquierda'],
            en: ['backhand', 'bh', 'left', 'left hand'],
            label: { es: 'al reves', en: 'backhand' }
        },
        center: {
            es: ['al medio', 'medio', 'al centro', 'centro', 'center', 'centre', 'middle', 'central'],
            en: ['center', 'centre', 'middle', 'centre court'],
            // "the middle" is one idea and two axes. The centre of the drop
            // axis is 0; the middle of the depth axis is a mid-length ball.
            also: { depth: 'mid' },
            label: { es: 'al medio', en: 'the middle' }
        },
        fh: {
            es: ['a la derecha', 'derecha', 'forehand', 'fh', 'de derecha', 'por derecha', 'la derecha'],
            en: ['forehand', 'fh', 'right', 'right hand'],
            label: { es: 'a la derecha', en: 'forehand' }
        }
    },

    // How deep it lands. A proxy, not a height: see aiCompile.js.
    depth: {
        short: {
            es: ['corto', 'corta', 'cortito', 'corta corta'],
            en: ['short', 'shortish'],
            label: { es: 'corto', en: 'short' }
        },
        // The bare "medio" is the centre *side*, not a depth, so it belongs to
        // that entry above. What is left for a mid-length ball are the
        // phrasings that say "length" rather than "place" - see
        // MID_DEPTH_PHRASES below.
        mid: {
            es: ['a media distancia', 'longitud media', 'media distancia'],
            en: ['mid-length', 'medium length', 'half length'],
            label: { es: 'medio', en: 'mid' }
        },
        long: {
            es: ['largo', 'larga', 'largo largo', 'profundo'],
            en: ['long', 'deep'],
            label: { es: 'largo', en: 'long' }
        }
    },

    // "fuerte" is a speed bump. It never adds scatter - that stays an explicit
    // "con dispersion", so a drill can never surprise you mid-rally.
    intensity: {
        low: {
            es: ['suave', 'lento', 'lenta', 'tranquilo', 'facil', 'suavito', 'cortito y suave'],
            en: ['soft', 'slow', 'gentle', 'easy', 'light'],
            value: INTENSITY.low,
            label: { es: 'suave', en: 'soft' }
        },
        high: {
            es: ['fuerte', 'duro', 'dura', 'potente', 'rapido', 'rapida', 'a tope', 'con fuerza', 'violento'],
            en: ['strong', 'hard', 'fast', 'heavy', 'powerful', 'full'],
            value: INTENSITY.high,
            label: { es: 'fuerte', en: 'strong' }
        }
    }
};

/** Extra switches that are not part of the intent shape. */
const FLAGS = {
    // The one word that may add scatter. Explicit, never inferred.
    scatter: {
        es: ['dispersion', 'con dispersion', 'disperso', 'al azar', 'aleatorio', 'variado', 'random'],
        en: ['scatter', 'random', 'randomised', 'randomized', 'spray']
    },
    // How a multi-axis preset is expanded - the same three modes the editor's
    // preset buttons use (editor.js `insertPresetIntoDrill`).
    variants: {
        es: ['variantes', 'variado', 'aleatorio'],
        en: ['variants', 'random pick']
    },
    sequence: {
        es: ['secuencia', 'seguido', 'en orden'],
        en: ['sequence', 'in order']
    },
    // "preset Safe push" - the rest of the clause is a name from the library.
    preset: {
        es: ['preset', 'preajuste', 'preajustes'],
        en: ['preset', 'presets']
    }
};

/**
 * Words that open a shot on their own. A clause with no role token whose head
 * is one of these IS that shot: "un top al medio fuerte" is a loop, not a
 * serve with a top-spin modifier. Only the ones that genuinely name a shot go
 * here - "cortado" is not one, because "saque corto a la derecha, cortado" uses
 * it as a modifier on the serve just named.
 */
const HEAD_SHOT = {
    top: 'loop', loop: 'loop', lifted: 'loop', lift: 'loop',
    drive: 'drive', smash: 'drive',
    block: 'block'
};

/**
 * Reps: "3Push b", "3 veces", "x3", "tres push", "3 reps". The suffix list is
 * the "no depth word" test for a bare push as well, so it is checked against
 * what the clause says rather than pulled out of it.
 */
const REP_SUFFIX = 'veces|times|reps|repeticiones|repetitions|x';

const NUMBER_WORDS = {
    uno: 1, una: 1, one: 1,
    dos: 2, two: 2,
    tres: 3, three: 3,
    cuatro: 4, four: 4,
    cinco: 5, five: 5,
    seis: 6, six: 6,
    siete: 7, seven: 7,
    ocho: 8, eight: 8,
    nueve: 9, nine: 9,
    diez: 10, ten: 10
};

/**
 * "the middle" is caught by the `side` entry above, so the bare depth word
 * `mid` has almost nothing left to match. These are the phrasings that do mean
 * a mid-length ball, and they are deliberately disjoint from the side entry so
 * one phrase cannot fill both slots by accident.
 */
const MID_DEPTH_PHRASES = ['mid', 'intermedio'];

// --- folding ----------------------------------------------------------------

/** Lowercase and strip accents. The only place the two forms are reconciled. */
export function fold(s) {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');   // the accents NFKD split off
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Fold the input, keeping a map back to the original.
 *
 * The vocabulary is stored folded, so the input has to be folded too or every
 * Spanish word that carries an accent - "reves" vs "revés", which is the
 * single most common word in the whole table - fails to match and the parser
 * looks broken in exactly the language half the users speak. The map exists so
 * the free text carried into an intent's `note` is the user's own accented
 * text and not the folded version of it.
 */
function foldWithMap(text) {
    const src = String(text ?? '');
    let out = '';
    const map = [];          // folded index -> original index
    for (let i = 0; i < src.length;) {
        // A base character plus any combining marks that belong to it, so the
        // fold removes the mark and the base survives.
        let j = i + 1;
        while (j < src.length && /[̀-ͯ]/.test(src[j])) j++;
        const folded = fold(src.slice(i, j));
        for (let k = 0; k < folded.length; k++) map.push(i);
        out += folded;
        i = j;
    }
    map.push(src.length);
    return { text: out, map };
}

/** The original substring behind a range of the folded text. */
function originalSlice(src, map, start, end) {
    if (!map.length) return '';
    const a = map[Math.min(Math.max(start, 0), map.length - 1)];
    const b = map[Math.min(Math.max(end, 0), map.length - 1)];
    return a === undefined || b === undefined ? '' : src.slice(a, b);
}

// --- the matcher ------------------------------------------------------------
//
// One regex over every phrase, longest first, so "al medio" is never eaten by
// the bare "medio" that follows it. The negative lookarounds are letter/number
// aware, which is why "corto" does not match inside "cortado" and "top" does not
// match inside "topspin" - Unicode property escapes, so accented and non-Latin
// letters behave too.

const PHRASES = [];

for (const [slot, table] of Object.entries(VOCAB)) {
    for (const [value, def] of Object.entries(table)) {
        for (const lang of ['es', 'en']) {
            for (const raw of def[lang]) {
                PHRASES.push({
                    phrase: fold(raw),
                    slot,
                    value,
                    also: def.also || null,
                    intensity: def.value,
                    label: def.label?.[lang] || raw
                });
            }
        }
    }
}

for (const [value, table] of Object.entries(FLAGS)) {
    for (const lang of ['es', 'en']) {
        for (const raw of table[lang]) PHRASES.push({ phrase: fold(raw), slot: 'flag', value });
    }
}

for (const raw of MID_DEPTH_PHRASES) {
    PHRASES.push({ phrase: fold(raw), slot: 'depth', value: 'mid', label: raw });
}

// Longest first is what makes multi-word entries win over their own substrings.
PHRASES.sort((a, b) => b.phrase.length - a.phrase.length);

const PHRASE_RE = new RegExp(
    '(?<![\\p{L}\\p{N}])(' + PHRASES.map(p => escapeRe(p.phrase)).join('|') + ')(?![\\p{L}\\p{N}])',
    'giu'
);

/**
 * Which slot a phrase prefers when it could fill more than one. "loop" is both
 * a role and a rotation; a sentence that says "loop" means the shot.
 */
const SLOT_PRIORITY = ['role', 'rotation', 'side', 'depth', 'intensity', 'flag'];

/**
 * Every vocabulary hit in `text`, in order, with the slots it could fill.
 * `raw` is the user's own accented text, not the folded form that matched.
 */
function scan(text) {
    const src = String(text ?? '');
    const { text: folded, map } = foldWithMap(src);
    const hits = [];
    for (const m of folded.matchAll(PHRASE_RE)) {
        const phrase = fold(m[0]);
        const entries = PHRASES.filter(p => p.phrase === phrase);
        if (entries.length) {
            hits.push({
                raw: originalSlice(src, map, m.index, m.index + m[0].length) || m[0],
                index: m.index,
                // The length of the match IN THE FOLDED TEXT, which is the text
                // `index` is an index into. Coverage cannot be measured without
                // it, and measuring it is the point - see `leftoverWords`.
                len: m[0].length,
                entries
            });
        }
    }
    return hits;
}

// --- counts -----------------------------------------------------------------

/**
 * A leading count is reps: "3Push b" is three repetitions of one step. A count
 * followed by `bpm` is a tempo, not a repetition, so it is read separately.
 *
 * The suffix is optional and there is deliberately no `\b` after the digits:
 * "3Push" has no word boundary between the 3 and the P, and a boundary there
 * is the difference between parsing the example and not parsing it.
 */
function readCount(text) {
    const m = new RegExp(`^\\s*(\\d{1,3})\\s*(?:${REP_SUFFIX})?\\s*`, 'i').exec(fold(text));
    if (m) return { count: Number(m[1]), rest: text.slice(m[0].length), explicit: true };

    const w = /^\s*(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(fold(text));
    if (w) return { count: NUMBER_WORDS[w[1]], rest: text.slice(w[0].length), explicit: true };

    // A count can also FOLLOW the shot: "x3", "3 veces", "3 reps".
    const tail = new RegExp(`(?:^|\\s)(?:x\\s*|)(\\d{1,3})\\s*(?:${REP_SUFFIX})?\\s*$`).exec(fold(text));
    if (tail && tail[1]) {
        return { count: Number(tail[1]), rest: text.slice(0, tail.index), explicit: true };
    }

    return { count: 0, rest: text, explicit: false };
}

function readBpm(text) {
    const m = /(\d{1,3})\s*(?:bpm|por minuto)/.exec(fold(text));
    if (!m) return null;
    const bpm = Number(m[1]);
    return bpm >= 20 && bpm <= 120 ? bpm : null;
}

// --- clause segmentation ----------------------------------------------------

/**
 * Where one shot stops and the next begins.
 *
 * A connector only splits when what follows it can stand on its own - a
 * connector before a bare modifier would turn one shot into two, so
 * "a la derecha y fuerte" stays a single step. That is the rule that makes the
 * example sentence come out as three shots rather than five.
 *
 * @returns {Array<{text: string, connector: string}>}
 */
export function splitClauses(text) {
    const HARD = /\s*(?:luego|despues|despu[eé]s|entonces|then|next|after|;|\||\.)\s*/gi;
    // Comma and "y"/"and" only count when the next segment names a shot.
    const SOFT = /[,]|\s+(?:y|e|and|then)\s+/gi;

    const hardSplit = [];
    let rest = String(text ?? '');
    let m;
    HARD.lastIndex = 0;
    while ((m = HARD.exec(rest)) !== null) {
        hardSplit.push(rest.slice(0, m.index));
        rest = rest.slice(m.index + m[0].length);
        HARD.lastIndex = 0;
    }
    hardSplit.push(rest);

    const out = [];
    for (const chunk of hardSplit) {
        if (!chunk.trim()) continue;
        // Within a hard chunk, look for a soft split whose tail names a shot.
        const pieces = [];
        let buf = chunk;
        let cut;
        SOFT.lastIndex = 0;
        while ((cut = SOFT.exec(buf)) !== null) {
            const tail = buf.slice(cut.index + cut[0].length);
            if (namesAShot(tail)) {
                pieces.push(buf.slice(0, cut.index));
                buf = tail;
                SOFT.lastIndex = 0;
            }
        }
        pieces.push(buf);
        for (const p of pieces) if (p.trim()) out.push({ text: p.trim(), connector: cut ? 'soft' : 'hard' });
    }
    return out;
}

/** Does this fragment contain a role word, or open with a head-shot word? */
function namesAShot(text) {
    const hits = scan(text);
    if (!hits.length) return false;
    if (hits[0].entries.some(e => e.slot === 'role')) return true;
    if (hits[0].entries.some(e => e.slot === 'rotation' && HEAD_SHOT[e.value])) return true;
    return false;
}

// --- the parser -------------------------------------------------------------

/**
 * A blank intent, with every field at the documented default.
 * `intensity` 5 is neutral: it is a *modifier* on the role's own speed, and the
 * compiler's table already encodes the per-role default.
 */
export function emptyIntent() {
    return {
        role: null,
        rotation: null,
        side: null,
        depth: null,
        intensity: NEUTRAL_INTENSITY,
        bpm: null,
        reps: null,
        variants: null,
        scatter: false,
        note: ''
    };
}

/**
 * Fill one clause from its vocabulary hits.
 *
 * `prevRole` is the role of the step before it, so "saque corto, luego largo"
 * reads as two serves rather than a serve and a stray adjective.
 */
function intentFromClause(clause, prevRole) {
    const intent = emptyIntent();
    const filled = new Set();
    const hits = scan(clause);

    // A phrase that could fill several slots goes to the one it most likely
    // means, and only if that slot is still empty.
    for (const hit of hits) {
        const ordered = [...hit.entries].sort(
            (a, b) => SLOT_PRIORITY.indexOf(a.slot) - SLOT_PRIORITY.indexOf(b.slot)
        );
        for (const e of ordered) {
            if (e.slot === 'flag') {
                if (e.value === 'scatter') intent.scatter = true;
                else if (e.value === 'variants') intent.variants = 'variants';
                else if (e.value === 'sequence') intent.variants = 'sequence';
                continue;
            }
            if (filled.has(e.slot)) continue;
            filled.add(e.slot);
            if (e.slot === 'intensity') intent.intensity = e.intensity ?? NEUTRAL_INTENSITY;
            else intent[e.slot] = e.value;
            if (e.also) for (const [slot, value] of Object.entries(e.also)) {
                if (filled.has(slot)) continue;
                filled.add(slot);
                intent[slot] = value;
            }
        }
    }

    // --- role resolution, in the order the header block documents ---
    if (intent.role) {
        // "saque"/"push" is one vocabulary entry with two readings. A depth
        // word is the tell: "saque corto" and "push largo" are serves, a bare
        // "push b" is the rally shot.
        if (intent.role === 'serve' || intent.role === 'push') {
            intent.role = intent.depth ? 'serve' : 'push';
        }
    } else {
        // No role word. A clause that OPENS with a shot name is that shot;
        // otherwise it is a modifier on whatever came before.
        const head = hits[0]?.entries.find(e => e.slot === 'rotation' && HEAD_SHOT[e.value]);
        intent.role = head
            ? HEAD_SHOT[head.value]
            : (prevRole || 'serve');
        if (head && !intent.rotation) intent.rotation = head.value;
    }

    // "push(b)" / "drive f" - the app's own single-letter side shorthand.
    if (!intent.side) intent.side = readParenSide(clause);

    return intent;
}

/** `push(b)`, `drive(f)`, `loop b`, `push a la derecha` - the trailing letter. */
function readParenSide(clause) {
    const m = /\(\s*([bf])\s*\)/i.exec(clause) || /\b(?:push|drive|loop|saque|golpe)\s+([bf])\b/i.exec(clause);
    if (!m) return null;
    return m[1].toLowerCase() === 'b' ? 'bh' : 'fh';
}

/** A whole utterance, with the "preset <name>" form resolved against a library. */
function readPresetRef(text, presets) {
    if (!presets || !presets.length) return null;
    const m = /\b(?:preset|preajuste)s?\b\s+(.+)$/i.exec(fold(text));
    if (!m) return null;
    // Compare on the folded name: the library holds whatever the user typed,
    // in whatever language, and the app never translates stored data.
    const wanted = fold(m[1]).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!wanted) return null;
    return presets.find(p => {
        const name = fold(p.name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        return name && (name === wanted || name.startsWith(wanted) || wanted.startsWith(name));
    }) || null;
}

/**
 * Tier 0: turn a sentence into intents, deterministically.
 *
 * This is the floor of the feature, not a degraded fallback. It needs no key,
 * no network and no model, which is the only reason an assistant is worth
 * having in an app whose identity is "works at a table with no signal". When a
 * key is configured, Tier 1 is used only for what this returns as unresolved.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {Array}  [opts.presets] resolve "preset <name>" against this library
 * @returns {{intents: Array, unresolved: boolean, unknown: string[]}|null}
 *          `null` when nothing at all was understood - the caller's cue to ask
 *          the model tier. Never throws: junk in gives `null` out.
 */
/**
 * Words that are grammar, not vocabulary.
 *
 * Only used to decide what counts against coverage. "genera un drill" leaves
 * three words behind that the user did not mean as shots and would not be
 * confused by losing, so they count as understood - treating them as missed
 * would report every ordinary sentence as a near-total failure and make the
 * number worthless. Everything NOT here that scan() did not consume is a real
 * gap, and "torpedos" is the one that mattered.
 */
const FILLER = new Set([
    'un', 'una', 'uno', 'unos', 'unas', 'el', 'la', 'lo', 'los', 'las', 'de', 'del',
    'y', 'e', 'o', 'u', 'a', 'al', 'en', 'para', 'por', 'con', 'sin', 'que', 'me',
    'mi', 'te', 'se', 'su', 'sus', 'le', 'les', 'muy', 'mas', 'pero', 'otra', 'otro',
    'genera', 'generame', 'haz', 'hazme', 'dame', 'quiero', 'necesito', 'pon',
    'agrega', 'anade', 'añade', 'sigue', 'continue', 'drill', 'drills',
    'ejercicio', 'ejercicios', 'ronda', 'serie', 'vez', 'veces', 'va', 'venga',
    'porfa', 'favor', 'gracias', 'nada', 'todo', 'solo', 'ahora', 'despues',
    'luego', 'entonces', 'finalmente', 'bien'
]);

/**
 * The words of `body` that scan() did not consume.
 *
 * This is the measurement `unknown` was never able to make. `unknown` collects
 * only from clauses that matched NOTHING, so a clause that is mostly noise but
 * contains one known word is recorded as fully understood - which is how
 * "dos torpedos largos a la izquierda" became a clean intent with "torpedos"
 * silently deleted and "dos" read as a repetition count.
 *
 * A word counts as consumed if ANY character of it was covered by a hit, so a
 * partial match like "cortadito" counts as understood rather than as a gap
 * plus a word.
 */
export function leftoverWords(body, hits) {
    const folded = fold(body);
    if (!folded) return [];
    const covered = new Set();
    for (const h of hits || []) {
        const end = h.index + (h.len ?? 0);
        for (let i = h.index; i < end; i++) covered.add(i);
    }
    const out = [];
    for (const m of folded.matchAll(/[a-z0-9]+/g)) {
        // A one-character token is shorthand hanging off a phrase we already
        // read - "push b", "drive f" - and counting it as a gap would report the
        // shortest and most idiomatic sentence in the vocabulary as a half-missed
        // one. It carries no meaning of its own.
        if (m[0].length < 2) continue;
        let touched = false;
        for (let i = m.index; i < m.index + m[0].length; i++) {
            if (covered.has(i)) { touched = true; break; }
        }
        if (!touched) out.push(m[0]);
    }
    return out;
}

/**
 * Percent of the utterance that reached an intent.
 *
 * Counted per INTENT, not per clause: a clause that matched nothing still
 * produced a stub intent carrying the user's own words, so it counts as heard
 * even though nothing was recognised in it. What does not count is a word
 * nobody read inside a clause that otherwise parsed - that is exactly the case
 * `unknown` could not see.
 */
function coverageOf(intents, dropped) {
    const heard = intents.reduce((n, i) => n + Math.max(1, String(i.note || '').trim().split(/\s+/).filter(Boolean).length), 0);
    const total = heard + dropped.length;
    if (!total) return 100;
    return Math.max(0, Math.min(100, Math.round((heard / total) * 100)));
}

export function parseUtterance(text, { presets = null } = {}) {
    if (typeof text !== 'string' || !text.trim()) return null;

    let clauses;
    try {
        clauses = splitClauses(text);
    } catch {
        return null;
    }
    if (!clauses.length) return null;

    const intents = [];
    const unknown = [];
    // Words dropped from clauses that DID produce an intent. See FILLER.
    const leftover = [];
    let prevRole = null;
    // How many clauses the vocabulary actually understood.
    let real = 0;

    for (const clause of clauses) {
        let body = clause.text;
        const preset = readPresetRef(body, presets);
        if (preset) {
            // "preset Safe push a la derecha" is that one preset, plus whatever
            // the rest of the clause said about it. The name is stripped so its
            // own words are not re-read as stroke words.
            body = body.replace(/^\s*\S+\s+/, '').replace(/.*?\b(?:preset|preajustes?)\b\s*/i, '') || body;
        }

        // A leading count is reps; a trailing "N bpm" is a tempo. Read the
        // count off the ORIGINAL clause so "3Push b" works whether the number
        // leads the shot or trails it as "push b x3".
        const bpm = readBpm(body);
        body = body.replace(/(\d{1,3})\s*(?:bpm|por minuto)/gi, ' ');
        const counted = readCount(body);
        body = counted.rest;

        const hits = scan(body);

        if (!hits.length) {
            // Nothing recognised. Keep the raw text so the model tier gets the
            // fragment, and so the assistant can say what it did not get.
            const words = fold(body).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
            unknown.push(...words);
            if (words.length) {
                const stub = { ...emptyIntent(), role: prevRole, note: clause.text.trim() };
                if (counted.count) stub.reps = counted.count;
                if (bpm !== null) stub.bpm = bpm;
                intents.push(stub);
            }
            continue;
        }

        const intent = intentFromClause(body, prevRole);
        if (counted.count) intent.reps = counted.count;
        if (bpm !== null) intent.bpm = bpm;
        if (preset) intent.presetId = preset.id;
        if (preset && !intent.note) intent.note = preset.name;

        // Measured, NOT acted on. This clause produced an intent, so Tier 0
        // counts as having understood it - that is what `unresolved` means and
        // changing it would send every ordinary sentence to the model. But the
        // words nobody read are recorded here, because a tier that drops them
        // silently is a tier that cannot be debugged.
        for (const w of leftoverWords(body, hits)) if (!FILLER.has(w)) leftover.push(w);

        prevRole = intent.role;
        real++;
        intents.push(intent);
    }

    // A sentence of nothing but unrecognised words is NOT a partial success.
    // `null` is the caller's cue to send it to the model tier, and a draft
    // built out of the word "thing" is worse than no draft at all.
    if (!real) return null;
    if (!intents.length) return null;

    // Anything left over is what Tier 1 exists for. A clause that matched
    // nothing at all counts as unresolved even if every other clause parsed
    // cleanly, because the draft is then missing a step the user asked for.
    const unresolved = unknown.length > 0;
    const dropped = [...new Set(leftover)];
    return {
        intents,
        unresolved,
        unknown: [...new Set(unknown)],
        // The words nobody read, for the trace and the console. Measured only -
        // `unresolved` above is unchanged and still governs whether Tier 1 is
        // entered, because that decision is a product choice and this is a fact.
        dropped,
        // How much of what was SAID the vocabulary actually read, as a whole
        // percent, counting filler as understood. 100 is a sentence made
        // entirely of known words. Anything much below that is a tier that is
        // going to answer from part of the request - which is worth seeing, and
        // is what the panel's trace now shows.
        coverage: coverageOf(intents, dropped)
    };
}

// --- readouts ---------------------------------------------------------------

/**
 * "cortado largo al reves" - the plain-language label for one step, built from
 * the same vocabulary table the parser matched on, so the words the user said
 * are the words they read back.
 *
 * @param {object} intent
 * @param {'es'|'en'} lang
 */
export function intentLabel(intent, lang = 'es') {
    const words = [];
    const forValue = (slot, value) => {
        for (const p of PHRASES) {
            if (p.slot === slot && p.value === value && p.label) return p.label[lang] || p.label.en;
        }
        return value;
    };

    if (intent.rotation) words.push(forValue('rotation', intent.rotation));
    if (intent.depth) words.push(forValue('depth', intent.depth));
    if (intent.side) words.push(forValue('side', intent.side));
    if (!words.length && intent.role) words.push(forValue('role', intent.role));
    if (!words.length) return '';
    return lang === 'en' ? words.join(' ') : words.join(' ');
}

/** The vocabulary, rendered for the model tier's system prompt. */
export function vocabularyForPrompt() {
    const group = (slot) => {
        const table = VOCAB[slot];
        return Object.entries(table).map(([value, def]) => {
            const words = [...new Set([...(def.es || []), ...(def.en || [])])].slice(0, 6);
            return `    ${value}: ${words.join(', ')}`;
        }).join('\n');
    };
    return [
        `role (what the ball is doing):\n${group('role')}`,
        `rotation (how it spins; decides the ball's type):\n${group('rotation')}`,
        `side (lateral target, from the RECEIVER's view; backhand = negative drop, forehand = positive):\n${group('side')}`,
        `depth (how deep it lands; a proxy for short/mid/long, not a height):\n${group('depth')}`,
        `intensity (a speed modifier, 0..10, 5 is neutral):\n${group('intensity')}`
    ].join('\n\n');
}

/** The side a label means, for `aiMatch` to find a preset axis entry. */
export function sideFromLabel(label) {
    const f = fold(label);
    if (/^(bh|backhand|reves|rev\b|left)/.test(f)) return 'bh';
    if (/^(fh|forehand|derecha|right)/.test(f)) return 'fh';
    if (/^(center|centre|centro|middle|medio)/.test(f)) return 'center';
    return null;
}

/** The depth a label means. */
export function depthFromLabel(label) {
    const f = fold(label);
    if (/^(short|corto)/.test(f)) return 'short';
    if (/^(long|largo)/.test(f)) return 'long';
    if (/^(mid|medio|medium|intermedio)/.test(f)) return 'mid';
    return null;
}
