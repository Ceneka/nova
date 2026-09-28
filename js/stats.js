/**
 * The training history.
 *
 * `nova_stats` has always been two lifetime counters and nothing else, so there
 * was no history to look at and no way to undo a bad number. This module adds a
 * log of *sessions*.
 *
 * A session is one robot connection: from the moment the handshake completes to
 * the moment the link drops. Every drill started during that sitting is folded
 * into the same entry, so the history reads as "Tuesday evening, 14 drills"
 * rather than 14 near-identical rows.
 *
 * Two storage keys:
 *   nova_sessions       finished sessions, oldest first
 *   nova_active_session the one in progress, written as it happens
 *
 * The in-progress session is persisted rather than held in memory so a reload,
 * a crash or a phone locking mid-session does not silently lose the training
 * that actually happened. Anything left open when the app next starts is sealed
 * on load.
 *
 * Nothing here throws. Stats are the least important data the app holds, so a
 * full or hostile localStorage costs you the history and nothing else - it must
 * never break a drill run.
 */

const SESSIONS_KEY = 'nova_sessions';
const ACTIVE_KEY = 'nova_active_session';

/**
 * How many sessions to keep. A session with ~10 drills is roughly 200 bytes of
 * JSON, so the cap is around 100 KB - a rounding error against the ~5 MB
 * localStorage budget, which has to stay free for drills and presets.
 */
export const MAX_SESSIONS = 500;

let sessions = [];
let active = null;

/**
 * Session ids only have to be unique, but they are derived from the clock for
 * readability. Date.now() alone is not unique: disconnecting and reconnecting
 * inside the same millisecond produces two sessions with the same id, and
 * deleting either one then deletes both. Nudging the id forward keeps it
 * readable, ordered, and unique.
 */
let lastId = 0;

function nextId(now) {
    lastId = Math.max(now, lastId + 1);
    return lastId;
}

// --- storage plumbing ---

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        // Junk in the key, or JSON the app cannot parse. Either way the
        // history is not worth failing startup over.
        return fallback;
    }
}

/**
 * localStorage is user-writable and survives across app versions, so every
 * entry is treated as hostile input: a half-written or hand-edited record is
 * dropped, never trusted.
 */
function normalize(s) {
    if (!s || typeof s !== 'object' || !Number.isFinite(s.startedAt)) return null;
    const byDrill = (s.byDrill && typeof s.byDrill === 'object' && !Array.isArray(s.byDrill)) ? s.byDrill : {};
    return {
        id: Number.isFinite(s.id) ? s.id : s.startedAt,
        startedAt: s.startedAt,
        // null means "still open". Left null on a finished session by an older
        // build, it is repaired when the session is sealed.
        endedAt: Number.isFinite(s.endedAt) ? s.endedAt : null,
        lastActivity: Number.isFinite(s.lastActivity) ? s.lastActivity : s.startedAt,
        drills: Math.max(0, Number(s.drills) || 0),
        balls: Math.max(0, Number(s.balls) || 0),
        byDrill
    };
}

function persistSessions() {
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
        return true;
    } catch (e) {
        // Most likely QuotaExceededError. Give up the oldest sessions until it
        // fits rather than dropping the history entirely.
        while (sessions.length > 1) {
            sessions.shift();
            try {
                localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
                return true;
            } catch { /* still too big: keep shedding */ }
        }
        return false;
    }
}

function persistActive() {
    if (!active) {
        try { localStorage.removeItem(ACTIVE_KEY); } catch { /* nothing to do */ }
        return;
    }
    try {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
    } catch {
        // The open session is the only thing in the key; if it will not fit,
        // drop it and carry on. The next drill start recreates it.
        active = null;
        try { localStorage.removeItem(ACTIVE_KEY); } catch { /* nothing to do */ }
    }
}

function trim() {
    if (sessions.length > MAX_SESSIONS) {
        sessions = sessions.slice(sessions.length - MAX_SESSIONS);
    }
}

/** Load the history, and seal anything a previous page left open. */
export function initStats() {
    const raw = readJSON(SESSIONS_KEY, []);
    sessions = (Array.isArray(raw) ? raw : []).map(normalize).filter(Boolean);
    sessions.sort((a, b) => a.startedAt - b.startedAt);
    // Resume the id sequence above anything already stored, so a new session
    // can never be handed an id a restored one is already using.
    for (const s of sessions) lastId = Math.max(lastId, s.id);

    active = normalize(readJSON(ACTIVE_KEY, null));
    if (active) sealActive();

    trim();
    persistSessions();
}

/** Move the in-progress session into the log, if there is one. */
function sealActive() {
    if (!active) return;
    const finished = {
        ...active,
        // A session still open when the app next runs never got a clean
        // disconnect. End it at the last thing it actually did, not at load
        // time - otherwise a tab left shut overnight reads as an all-nighter.
        endedAt: active.endedAt ?? active.lastActivity
    };
    sessions.push(finished);
    active = null;
    trim();
    persistSessions();
    persistActive();
}

// --- the session lifecycle ---

export function beginSession() {
    const now = Date.now();
    active = { id: nextId(now), startedAt: now, endedAt: null, lastActivity: now, drills: 0, balls: 0, byDrill: {} };
    persistActive();
}

export function endSession() {
    sealActive();
}

export function isSessionOpen() {
    return active !== null;
}

/**
 * One drill started. `drillKey` is the same key the drill list uses
 * ("push(b)"), which is what the per-drill ranking groups on.
 */
export function noteSessionDrill(drillKey) {
    if (!active || !drillKey) return;
    active.drills += 1;
    const key = String(drillKey);
    active.byDrill[key] = (active.byDrill[key] || 0) + 1;
    touch();
}

export function noteSessionBalls(count) {
    if (!active) return;
    const n = Number(count) || 0;
    if (n <= 0) return;
    active.balls += n;
    touch();
}

function touch() {
    active.lastActivity = Date.now();
    persistActive();
    document.dispatchEvent(new CustomEvent('stats-updated'));
}

// --- editing the history ---

export function deleteSession(id) {
    const before = sessions.length;
    sessions = sessions.filter(s => s.id !== id);
    if (sessions.length === before) return false;
    persistSessions();
    document.dispatchEvent(new CustomEvent('stats-updated'));
    return true;
}

export function clearSessions() {
    sessions = [];
    persistSessions();
    document.dispatchEvent(new CustomEvent('stats-updated'));
}

// --- selectors, all derived so the totals cannot disagree with the list ---

/** Finished sessions, oldest first. */
export function getSessions() {
    return sessions.slice();
}

export function getTotals() {
    let drills = 0, balls = 0, durationMs = 0;
    for (const s of sessions) {
        drills += s.drills;
        balls += s.balls;
        // A session that never ended cleanly is counted up to its last
        // activity, matching how its duration is displayed.
        const end = s.endedAt ?? s.lastActivity;
        if (end > s.startedAt) durationMs += end - s.startedAt;
    }
    return {
        sessions: sessions.length,
        drills,
        balls,
        durationMs,
        firstAt: sessions.length ? sessions[0].startedAt : null,
        lastAt: sessions.length ? sessions[sessions.length - 1].endedAt : null
    };
}

/**
 * Most-played drills across the whole history, derived by summing every
 * session. Deleting a session therefore updates the ranking with no second copy
 * of the data to keep in step.
 */
export function getDrillRanking(limit = 8) {
    const counts = new Map();
    for (const s of sessions) {
        for (const [key, n] of Object.entries(s.byDrill)) {
            counts.set(key, (counts.get(key) || 0) + (Number(n) || 0));
        }
    }
    return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .slice(0, limit);
}

/** Local midnight for a timestamp - the app reports times in local time. */
function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * One bucket per day for the last `days` days, oldest first, ending today.
 * Days with no training are present with zeroes: gaps are information, and a
 * sparse chart hides the streak you were trying to notice.
 */
export function getDailySeries(days = 14) {
    const today = startOfDay(Date.now());
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
        const dayStart = today - i * 86400000;
        buckets.push({ dayStart, drills: 0, balls: 0, sessions: 0 });
    }
    const first = buckets.length ? buckets[0].dayStart : 0;
    for (const s of sessions) {
        // Compare on the local day, not raw ms, or every session lands in the
        // wrong bucket across a DST boundary.
        if (s.startedAt < first) continue;
        const b = buckets[dailyIndex(s.startedAt, first, buckets.length)];
        if (!b) continue;
        b.drills += s.drills;
        b.balls += s.balls;
        b.sessions += 1;
    }
    return buckets;
}

function dailyIndex(ts, first, count) {
    // Buckets are consecutive local midnights; recomputing the offset from
    // start-of-day keeps this correct across a 23- or 25-hour DST day.
    const diff = startOfDay(ts) - first;
    if (diff < 0) return -1;
    const perDay = 86400000;
    const idx = Math.round(diff / perDay);
    return idx < count ? idx : -1;
}
