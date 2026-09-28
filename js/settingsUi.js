import { getPresets } from './presets.js';
import { appStats, saveAsDefault, resetToDefault, resetStats, factoryReset } from './state.js';
import { getTotals } from './stats.js';
import { setTheme } from './ui.js';
import { toggleBodyScroll } from './utils.js';
import { isStatsOpen, closeStatsView } from './statsUi.js';

/**
 * Settings is a full screen rather than a modal: it is the one place a user
 * goes to deliberately and then leaves, and a modal would hide the app behind
 * it for no benefit. The hamburger menu keeps only the drill actions.
 */

const THEMES = [
    { id: 'standard', name: 'Standard', swatch: '#ff6b4a' },
    { id: 'ocean',    name: 'Ocean',    swatch: '#0984e3' },
    { id: 'forest',   name: 'Forest',   swatch: '#00b894' },
    { id: 'night',    name: 'Dark',     swatch: '#2d3436' }
];

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let open = false;

export function isSettingsOpen() {
    return open;
}

export function openSettings() {
    open = true;
    // The menu is what led here; leaving it open behind the screen looks broken.
    document.getElementById('theme-menu')?.classList.remove('open');
    renderSettings();
    const view = document.getElementById('settings-view');
    view?.removeAttribute('hidden');
    view?.classList.add('active');
    document.querySelector('.container')?.classList.add('screen-hidden');
    toggleBodyScroll(true);
}

export function closeSettings() {
    if (!open) return;
    open = false;
    const view = document.getElementById('settings-view');
    view?.classList.remove('active');
    // openSettings() removed `hidden`; put it back. Without this the view has no
    // display rule of its own once `active` is gone, so it stays a full-screen
    // block at z-index 150 and keeps covering the drill list it just revealed.
    view?.setAttribute('hidden', '');
    document.querySelector('.container')?.classList.remove('screen-hidden');
    toggleBodyScroll(false);
}

function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'standard';
}

/** Render the whole screen. Cheap enough to redraw after any change. */
export function renderSettings() {
    const body = document.getElementById('settings-body');
    if (!body) return;

    const active = currentTheme();
    const presetCount = getPresets().length;
    const sessionCount = getTotals().sessions;

    const themeCards = THEMES.map(t => `
        <button class="theme-card ${t.id === active ? 'active' : ''}"
                data-theme-card="${t.id}"
                aria-pressed="${t.id === active}"
                onclick="window.handleSettingsTheme('${t.id}')">
            <span class="theme-swatch" style="background:${t.swatch}"></span>
            <span class="theme-name">${t.name}</span>
            <span class="theme-check" aria-hidden="true">&#10003;</span>
        </button>`).join('');

    body.innerHTML = `
        <section class="settings-section">
            <div class="settings-section-title">Appearance</div>
            <div class="theme-grid">${themeCards}</div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">Presets</div>
            <div class="settings-row" data-row="manage-presets">
                <div class="settings-row-main">
                    <div class="settings-row-title">Manage presets</div>
                    <div class="settings-row-desc">${presetCount} in your library</div>
                </div>
                <button class="settings-btn" onclick="window.openPresetSheet()">Open</button>
            </div>
            <div class="settings-row" data-row="export-presets-json">
                <div class="settings-row-main">
                    <div class="settings-row-title">Export presets</div>
                    <div class="settings-row-desc">JSON keeps everything. CSV is readable.</div>
                </div>
                <button class="settings-btn" onclick="window.exportPresetsJSON()">JSON</button>
            </div>
            <div class="settings-row" data-row="export-presets-csv">
                <div class="settings-row-main">
                    <div class="settings-row-title">Export presets</div>
                    <div class="settings-row-desc">Spreadsheet-friendly format.</div>
                </div>
                <button class="settings-btn" onclick="window.exportPresetsCSV()">CSV</button>
            </div>
            <div class="settings-row" data-row="import-presets">
                <div class="settings-row-main">
                    <div class="settings-row-title">Import presets</div>
                    <div class="settings-row-desc">JSON or CSV. Names that already exist are skipped.</div>
                </div>
                <button class="settings-btn" onclick="window.handlePresetImportPick()">Import</button>
            </div>
            <div class="settings-row" data-row="reset-presets">
                <div class="settings-row-main">
                    <div class="settings-row-title">Reset preset library</div>
                    <div class="settings-row-desc">Back to the 8 shipped presets.</div>
                </div>
                <button class="settings-btn" onclick="window.handleResetPresets()">Reset</button>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">Drills</div>
            <div class="settings-row" data-row="save-default">
                <div class="settings-row-main">
                    <div class="settings-row-title">Save as default</div>
                    <div class="settings-row-desc">Restores the current drills on a factory reset.</div>
                </div>
                <button class="settings-btn" onclick="window.saveAsDefault()">Save</button>
            </div>
            <div class="settings-row" data-row="restore-default">
                <div class="settings-row-main">
                    <div class="settings-row-title">Restore defaults</div>
                    <div class="settings-row-desc">Back to the shipped drills, keeping your custom ones.</div>
                </div>
                <button class="settings-btn" onclick="window.resetToDefault()">Restore</button>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">Statistics</div>
            <div class="settings-row" data-row="open-stats">
                <div class="settings-row-main">
                    <div class="settings-row-title">Training history</div>
                    <div class="settings-row-desc">${sessionCount} session${sessionCount === 1 ? '' : 's'} recorded.</div>
                </div>
                <button class="settings-btn" onclick="window.openStatsFromSettings()">Open</button>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">Data</div>
            <div class="settings-row" data-row="reset-stats">
                <div class="settings-row-main">
                    <div class="settings-row-title">Reset statistics</div>
                    <div class="settings-row-desc danger-text">${appStats.balls} balls &middot; ${appStats.drills} drills &middot; clears the history too.</div>
                </div>
                <button class="settings-btn" onclick="window.resetStats()">Reset</button>
            </div>
            <div class="settings-row" data-row="factory-reset">
                <div class="settings-row-main">
                    <div class="settings-row-title">Factory reset</div>
                    <div class="settings-row-desc danger-text">Erases everything, including presets.</div>
                </div>
                <button class="settings-btn danger" onclick="window.factoryReset()">Erase</button>
            </div>
        </section>

        <div class="settings-foot">Nova Drill Control &middot; Version 2.4a</div>`;
}

/**
 * Picking a theme must not bounce the user out of Settings - the whole point
 * of moving themes here is to compare all four side by side.
 */
export function handleSettingsTheme(id) {
    setTheme(id, { closeMenu: false });
    renderSettings();
}

export function handlePresetImportPick() {
    document.getElementById('preset-file-input')?.click();
}

// Escape closes the topmost full screen, matching every other overlay in the
// app. This is the only Escape handler in the stack: Statistics sits above
// Settings, and two listeners would both fire on one keypress. It cannot live
// in statsUi.js either, because Settings imports that module - its dependency
// is evaluated first, so a listener there would close Statistics before this
// one got to look, and one Escape would close both.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isStatsOpen()) { closeStatsView(); return; }
    if (open) closeSettings();
});

// The preset count and the statistics line both go stale while this screen is
// open, so redraw whenever the data behind them changes.
document.addEventListener('presets-updated', () => { if (open) renderSettings(); });
document.addEventListener('stats-updated', () => { if (open) renderSettings(); });

window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.handleSettingsTheme = handleSettingsTheme;
window.handlePresetImportPick = handlePresetImportPick;
