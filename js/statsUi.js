import {
    getSessions, getTotals, getDrillRanking, getDailySeries,
    deleteSession, clearSessions, isSessionOpen, MAX_SESSIONS
} from './stats.js';
import { showToast, formatDuration } from './utils.js';
import { t, drillDisplayName } from './i18n.js';

/**
 * The statistics screen: a full screen above Settings, mirroring how Settings
 * itself sits above the drill list. Per AGENTS.md this is reached deliberately
 * rather than mid-session, which is why it hangs off a Settings row instead of
 * the hamburger menu.
 *
 * Everything here is derived from the stored session log on every render, so
 * deleting an entry immediately and visibly changes the totals, the chart and
 * the drill ranking - there is no second copy of the numbers to fall out of
 * step with the list.
 */

const CHART_DAYS = 14;
const LIST_LIMIT = 50; // the log holds 500; showing every row is not a screen

const ICON_TRASH = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6M14 11v6"></path>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
</svg>`;

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let open = false;

export function isStatsOpen() {
    return open;
}

export function openStatsView() {
    open = true;
    renderStats();
    const view = document.getElementById('stats-view');
    view?.removeAttribute('hidden');
    // Settings stays underneath, as the preset sheet stays over Settings.
    view?.classList.add('active');
    view?.scrollTo(0, 0);
}

export function closeStatsView() {
    if (!open) return;
    open = false;
    const view = document.getElementById('stats-view');
    view?.classList.remove('active');
    // Symmetric with openStatsView(): without putting `hidden` back the view
    // falls back to display:block and keeps covering the screen beneath it.
    view?.setAttribute('hidden', '');
}

const DAY_MS = 86400000;

/** "Today 18:40" / "Tue 3 Sep". */
function formatWhen(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (ts >= startOfToday) return t('stats.today', { time });
    if (ts >= startOfToday - DAY_MS) return t('stats.yesterday', { time });
    return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

function renderChart(series) {
    const max = Math.max(1, ...series.map(d => d.drills));
    const bars = series.map((d) => {
        // A day with no training still gets a stub, so a gap in the record
        // reads as a gap rather than as a rendering failure.
        const h = d.drills > 0 ? Math.max(6, Math.round((d.drills / max) * 100)) : 2;
        const day = new Date(d.dayStart);
        const date = day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        const label = t('stats.chartLabel', { date, n: d.drills });
        return `<div class="chart-col" title="${esc(label)}" aria-label="${esc(label)}">
                    <div class="chart-bar${d.drills ? '' : ' empty'}" style="height:${h}%"></div>
                </div>`;
    }).join('');
    // The day numbers, every other one so they do not collide on a phone.
    const labels = series.map((d, i) => {
        const day = new Date(d.dayStart).getDate();
        const show = i === series.length - 1 || i % 2 === 0;
        return `<span class="chart-label">${show ? day : ''}</span>`;
    }).join('');

    return `<div class="chart">${bars}</div><div class="chart-labels">${labels}</div>`;
}

function renderRanking(ranking) {
    if (!ranking.length) return '';
    const max = Math.max(...ranking.map(r => r.count));
    const rows = ranking.map((r, i) => `
        <div class="rank-row">
            <span class="rank-pos">${i + 1}</span>
            <span class="rank-name" title="${esc(r.key)}">${esc(drillDisplayName(r.key))}</span>
            <span class="rank-bar"><span style="width:${Math.max(6, Math.round((r.count / max) * 100))}%"></span></span>
            <span class="rank-count">${r.count}</span>
        </div>`).join('');
    return `<section class="stats-section">
                <div class="settings-section-title">${t('stats.mostPlayed')}</div>
                <div class="rank-list">${rows}</div>
            </section>`;
}

function renderSessions(sessions) {
    if (!sessions.length) {
        return `<div class="stats-empty">
                    ${t('stats.emptySessions')}
                </div>`;
    }
    // Newest first, capped: the log can hold 500 entries and a list of 500
    // rows is a scroll trap rather than a history.
    const rows = sessions.slice().reverse().slice(0, LIST_LIMIT).map(s => {
        const end = s.endedAt ?? s.lastActivity;
        const dur = end > s.startedAt ? end - s.startedAt : 0;
        return `<div class="session-row" data-session="${s.id}">
                    <div class="session-main">
                        <div class="session-when">${esc(formatWhen(s.startedAt))}</div>
                        <div class="session-meta">
                            <span>${t('unit.countDrills', { n: s.drills })}</span>
                            <span class="dot">&middot;</span>
                            <span>${t('unit.countBalls', { n: s.balls })}</span>
                            <span class="dot">&middot;</span>
                            <span>${esc(formatDuration(dur))}</span>
                        </div>
                    </div>
                    <button class="session-del" data-del="${s.id}"
                            aria-label="${esc(t('a11y.deleteSessionFrom', { when: formatWhen(s.startedAt) }))}"
                            title="${t('a11y.deleteSessionTitle')}">${ICON_TRASH}</button>
                </div>`;
    }).join('');
    return rows;
}

export function renderStats() {
    const body = document.getElementById('stats-body');
    if (!body) return;

    const sessions = getSessions();
    const totals = getTotals();

    if (!totals.sessions) {
        body.innerHTML = `
            <div class="stats-empty">
                ${t('stats.empty')}
            </div>`;
        return;
    }

    const series = getDailySeries(CHART_DAYS);
    const active = isSessionOpen();
    const tiles = [
        { label: t('unit.sessions'), value: totals.sessions },
        { label: t('unit.drills'), value: totals.drills },
        { label: t('unit.balls'), value: totals.balls },
        { label: t('unit.time'), value: formatDuration(totals.durationMs) }
    // The callback parameter must not be called `t`: that is the translation
    // function imported above, and shadowing it here would break the moment
    // anyone added a t() call inside this map.
    ].map(tile => `<div class="stat-tile">
                    <div class="stat-value">${tile.value}</div>
                    <div class="stat-label">${tile.label}</div>
                </div>`).join('');

    body.innerHTML = `
        ${active ? `<div class="stats-live">${t('stats.live')}</div>` : ''}

        <div class="stat-tiles">${tiles}</div>

        <section class="stats-section">
            <div class="settings-section-title">${t('stats.lastDays', { n: CHART_DAYS })}</div>
            ${renderChart(series)}
        </section>

        ${renderRanking(getDrillRanking())}

        <section class="stats-section">
            <div class="settings-section-title">${t('unit.sessions')}</div>
            <div class="session-list">${renderSessions(sessions)}</div>
            <button class="stats-clear" onclick="window.deleteAllSessions()">${t('stats.deleteAll')}</button>
            <div class="stats-foot-note">${t('stats.keepingLast', { n: MAX_SESSIONS })}</div>
        </section>`;
}

// --- handlers ---

export function deleteStatsSession(id) {
    const sid = Number(id);
    if (deleteSession(sid)) {
        showToast(t('toast.sessionDeleted'));
    } else {
        showToast(t('toast.sessionNotFound'));
    }
    renderStats();
}

export function deleteAllSessions() {
    if (!confirm(t('confirm.deleteAllSessions'))) return;
    clearSessions();
    showToast(t('toast.historyDeleted'));
    renderStats();
}

export function openStatsFromSettings() {
    // Settings is deliberately left open underneath, exactly as the preset
    // sheet is opened over it.
    openStatsView();
}

// Escape is handled in one place, in settingsUi.js: it owns the stack of
// full screens and closes the topmost one. A listener here would run *before*
// Settings' own, because Settings imports this module and a module's
// dependencies are evaluated first - so by the time Settings checked whether
// Statistics was open, this handler would already have closed it and Settings
// would close too. One Escape, one screen closed.

// The log grows while the screen is open (a session is live), so redraw on
// every change. settingsUi.js listens for the same event and is a no-op here.
document.addEventListener('stats-updated', () => { if (open) renderStats(); });

// One delegated handler for every delete button, so re-rendering the list does
// not mean re-binding one listener per row.
document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-del]');
    if (!btn) return;
    deleteStatsSession(btn.dataset.del);
});

window.openStatsView = openStatsView;
window.closeStatsView = closeStatsView;
window.openStatsFromSettings = openStatsFromSettings;
window.deleteStatsSession = deleteStatsSession;
window.deleteAllSessions = deleteAllSessions;
window.renderStats = renderStats;
