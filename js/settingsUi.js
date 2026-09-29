import { getPresets } from './presets.js';
import { appStats, saveAsDefault, resetToDefault, resetStats, factoryReset } from './state.js';
import { getTotals } from './stats.js';
import { setTheme } from './ui.js';
import { toggleBodyScroll, showToast } from './utils.js';
import { isStatsOpen, closeStatsView } from './statsUi.js';
import { getInstallState, promptInstall, isOfflineReady } from './pwa.js';
import { t, getLang, setLang, LANGUAGES } from './i18n.js';

/**
 * Settings is a full screen rather than a modal: it is the one place a user
 * goes to deliberately and then leaves, and a modal would hide the app behind
 * it for no benefit. The hamburger menu keeps only the drill actions.
 *
 * Language lives here rather than in the menu, for the same reason themes do:
 * it is a setting, not something reached for mid-session.
 */

/** `id` is the stored value; `name` is translated at render time. */
const THEMES = [
    { id: 'standard', swatch: '#40e2a7' },
    { id: 'ocean',    swatch: '#45b8f0' },
    { id: 'forest',   swatch: '#8fd14f' },
    { id: 'night',    swatch: '#b98cf5' }
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

/**
 * The install row, in whichever of its four states the browser has put us in.
 *
 * The button only exists in the one state where it does something. A disabled
 * "Install" is a promise the app cannot keep, and a row that is just text
 * reads as a broken feature rather than as an answer.
 */
function installRowHtml() {
    const state = getInstallState();

    if (state === 'installed') {
        return `
            <div class="settings-row" data-row="install-app">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.installed')}</div>
                    <div class="settings-row-desc">${t('settings.installedDesc')}</div>
                </div>
            </div>`;
    }

    if (state === 'installable') {
        return `
            <div class="settings-row" data-row="install-app">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.installApp')}</div>
                    <div class="settings-row-desc">${t('settings.installableDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleInstallApp()">${t('action.install')}</button>
            </div>`;
    }

    const declined = state === 'declined';
    return `
        <div class="settings-row" data-row="install-app">
            <div class="settings-row-main">
                <div class="settings-row-title">${t('settings.installApp')}</div>
                <div class="settings-row-desc">${declined
                    ? t('settings.installDeclined')
                    : t('settings.installUnsupported')}</div>
            </div>
        </div>`;
}

/**
 * The language switcher: the same segmented control the reps/time mode switch
 * uses, so it inherits a control that is already sized and styled to pass the
 * tap-target and contrast checks. The labels are endonyms on purpose - see
 * LANGUAGES in i18n.js.
 */
function languageRowHtml() {
    const active = getLang();
    const options = LANGUAGES.map((l) => `
        <div class="mode-option ${l.code === active ? 'active' : ''}"
             onclick="window.handleSettingsLang('${l.code}')">${l.label}</div>`).join('');

    return `
        <div class="settings-row" data-row="language">
            <div class="settings-row-main">
                <div class="settings-row-title">${t('settings.language')}</div>
                <div class="settings-row-desc">${t('settings.languageDesc')}</div>
            </div>
            <div class="mode-switch" data-lang-switch>${options}</div>
        </div>`;
}

/**
 * The browser's own install dialog is the only way to install - there is no
 * API for it. The toast is there to confirm the outcome, because the dialog
 * looks identical whether it worked or not.
 */
export async function handleInstallApp() {
    if (getInstallState() !== 'installable') return;
    const accepted = await promptInstall();
    if (accepted) showToast(t('toast.installing'));
}

/** Render the whole screen. Cheap enough to redraw after any change. */
export function renderSettings() {
    const body = document.getElementById('settings-body');
    if (!body) return;

    const active = currentTheme();
    const presetCount = getPresets().length;
    const sessionCount = getTotals().sessions;

    const themeCards = THEMES.map(theme => `
        <button class="theme-card ${theme.id === active ? 'active' : ''}"
                data-theme-card="${theme.id}"
                aria-pressed="${theme.id === active}"
                onclick="window.handleSettingsTheme('${theme.id}')">
            <span class="theme-swatch" style="background:${theme.swatch}"></span>
            <span class="theme-name">${t(`theme.${theme.id}`)}</span>
            <span class="theme-check" aria-hidden="true">&#10003;</span>
        </button>`).join('');

    body.innerHTML = `
        <section class="settings-section">
            <div class="settings-section-title">${t('settings.appearance')}</div>
            <div class="theme-grid">${themeCards}</div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">${t('settings.language')}</div>
            ${languageRowHtml()}
        </section>

        <section class="settings-section">
            <div class="settings-section-title">${t('settings.presets')}</div>
            <div class="settings-row" data-row="manage-presets">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.managePresets')}</div>
                    <div class="settings-row-desc">${t('settings.presetsInLibrary', { n: presetCount })}</div>
                </div>
                <button class="settings-btn" onclick="window.openPresetSheet()">${t('action.open')}</button>
            </div>
            <div class="settings-row" data-row="export-presets-json">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.exportPresets')}</div>
                    <div class="settings-row-desc">${t('settings.exportPresetsJsonDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.exportPresetsJSON()">JSON</button>
            </div>
            <div class="settings-row" data-row="export-presets-csv">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.exportPresets')}</div>
                    <div class="settings-row-desc">${t('settings.exportPresetsCsvDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.exportPresetsCSV()">CSV</button>
            </div>
            <div class="settings-row" data-row="import-presets">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.importPresets')}</div>
                    <div class="settings-row-desc">${t('settings.importPresetsDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handlePresetImportPick()">${t('action.import')}</button>
            </div>
            <div class="settings-row" data-row="reset-presets">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.resetPresets')}</div>
                    <div class="settings-row-desc">${t('settings.resetPresetsDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleResetPresets()">${t('action.reset')}</button>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">${t('settings.drills')}</div>
            <div class="settings-row" data-row="save-default">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.saveAsDefault')}</div>
                    <div class="settings-row-desc">${t('settings.saveAsDefaultDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.saveAsDefault()">${t('action.save')}</button>
            </div>
            <div class="settings-row" data-row="restore-default">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.restoreDefaults')}</div>
                    <div class="settings-row-desc">${t('settings.restoreDefaultsDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.resetToDefault()">${t('action.restore')}</button>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">${t('settings.statistics')}</div>
            <div class="settings-row" data-row="open-stats">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.trainingHistory')}</div>
                    <div class="settings-row-desc">${t('settings.trainingHistoryDesc', { n: sessionCount })}</div>
                </div>
                <button class="settings-btn" onclick="window.openStatsFromSettings()">${t('action.open')}</button>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">${t('settings.app')}</div>
            ${installRowHtml()}
            <div class="settings-row" data-row="offline-ready">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.offlineUse')}</div>
                    <div class="settings-row-desc">${isOfflineReady()
                        ? t('settings.offlineReady')
                        : t('settings.offlinePreparing')}</div>
                </div>
            </div>
        </section>

        <section class="settings-section">
            <div class="settings-section-title">${t('settings.data')}</div>
            <div class="settings-row" data-row="reset-stats">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.resetStats')}</div>
                    <div class="settings-row-desc danger-text">${t('settings.resetStatsDesc', { balls: appStats.balls, drills: appStats.drills })}</div>
                </div>
                <button class="settings-btn" onclick="window.resetStats()">${t('action.reset')}</button>
            </div>
            <div class="settings-row" data-row="factory-reset">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settings.factoryReset')}</div>
                    <div class="settings-row-desc danger-text">${t('settings.factoryResetDesc')}</div>
                </div>
                <button class="settings-btn danger" onclick="window.factoryReset()">${t('action.erase')}</button>
            </div>
        </section>

        <div class="settings-foot">${t('settings.foot')}</div>`;
}

/**
 * Picking a theme must not bounce the user out of Settings - the whole point
 * of moving themes here is to compare all four side by side. Same for the
 * language: switch it and stay on the screen to see the result.
 */
export function handleSettingsTheme(id) {
    setTheme(id, { closeMenu: false });
    renderSettings();
}

export function handleSettingsLang(code) {
    if (code === getLang()) return;
    setLang(code);
    // setLang() has already fired 'locale-changed', which redraws this screen
    // through the listener at the bottom of this file. Redrawing here as well
    // would be harmless but pointless, so this is deliberately the last line.
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

// The install row changes under the user: the browser fires
// beforeinstallprompt some time after load, and the prompt is spent the moment
// it is used. Without this the row would be frozen on whatever it said when
// Settings happened to be opened.
document.addEventListener('pwa-state-changed', () => { if (open) renderSettings(); });

// Every string on this screen comes from t(), so a language change has to
// redraw it. `open` is the same guard the other listeners use: redrawing a
// hidden screen would throw away the scroll position for nothing.
document.addEventListener('locale-changed', () => { if (open) renderSettings(); });

window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.handleSettingsTheme = handleSettingsTheme;
window.handleSettingsLang = handleSettingsLang;
window.handlePresetImportPick = handlePresetImportPick;
window.handleInstallApp = handleInstallApp;
