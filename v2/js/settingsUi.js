import { getPresets } from './presets.js';
import { appStats, saveAsDefault, resetToDefault, resetStats, factoryReset } from './state.js';
import { getTotals } from './stats.js';
import { setTheme } from './ui.js';
import { toggleBodyScroll, showToast } from './utils.js';
import { isStatsOpen, closeStatsView } from './statsUi.js';
import { isAiOpen, closeAiView, refreshAiPanel } from './aiUi.js';
import {
    getAiConfig, setAiConfig, clearAiKey, maskKey, isTextConfigured,
    normalizeBaseUrl, redact as redactAi, PROVIDER_IDS, PROVIDERS, modelsUrl, buildHeaders
} from './aiConfig.js';
// These two were missing until the screen-lock row forced a second look at
// this import block, and nothing had ever pressed either button, so
// aiTestConnection() and aiFetchModels() would have thrown a ReferenceError the
// first time a real user touched them. The checks in tests/integration.html
// now press both.
import { chat } from './aiClient.js';
import { isScreenLockSupported } from './aiVoice.js';
import { getInstallState, promptInstall, isOfflineReady } from './pwa.js';
import { isSignedIn, getUser, startSignIn, signOut } from './account.js';
import { pushBundle, restoreFromCloud, getLastSyncAt } from './sync.js';
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

/** Where the app lives. The About box carries the same URL in markup. */
const SITE_URL = 'https://tenisdemesa.ar/';

/**
 * The Settings footer, with the domain in it as the link it names.
 *
 * The line is still ONE dictionary value per language - the suite checks that it
 * leads with the app name, and this is the fourth copy of that name - so the
 * domain is wrapped where it already sits rather than re-assembled out of
 * `app.title` and `footer.version`, which is exactly how those copies drift
 * apart. The string being spliced is our own dictionary, never anything a model
 * or the user typed, which is what makes it safe to hand back as HTML.
 */
function footHtml() {
    return t('settings.foot').replace(
        /tenisdemesa\.ar/i,
        (domain) => `<a class="foot-link" href="${SITE_URL}" target="_blank" rel="noopener noreferrer">${domain}</a>`
    );
}

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
    // The assistant panel can be sitting underneath, and this close is what
    // reveals it - it never re-opens, so nothing would redraw it. Without this
    // its "model not set up" row survives a key that has just been saved.
    if (isAiOpen()) refreshAiPanel();
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

/**
 * The AI assistant's settings, in whichever state the configuration is in.
 *
 * Everything here is a mirror of `nova_ai_config`. The key itself is only ever
 * shown masked, and only ever written back through a handler - there is no path
 * from this template to localStorage that does not go through
 * `aiConfig.setConfig()`.
 *
 * Note what is NOT here: a hardcoded model id. §16 Q6 - model ids change, are
 * region- and account-dependent, and a stale default is a confusing first run.
 * "Fetch model list" asks the endpoint; the field stays free text so a
 * self-hosted proxy works.
 *
 * In `follow-text` mode the voice fields are hidden rather than disabled: a
 * greyed-out field full of values that are not being used is worse than no
 * field at all, and the "Following: <model>" line already says what is in use.
 */
function aiSettingsHtml() {
    const c = getAiConfig();
    const options = (slot) => PROVIDER_IDS.map(id => {
        const selected = c[slot].provider === id ? ' selected' : '';
        return `<option value="${id}"${selected}>${t(`provider.${id}`)}</option>`;
    }).join('');

    const own = c.voice.mode === 'own';
    const following = c.voice.mode === 'follow-text';

    return `
        <section class="settings-section" data-section="ai">
            <div class="settings-section-title">${t('settingsAi.section')}</div>

            <span class="ai-subgroup-title">${t('settingsAi.groupModel')}</span>
            <div class="settings-row" data-row="ai-text">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settingsAi.textModel')}</div>
                    <div class="settings-row-desc">${t('settingsAi.textModelDesc')}</div>
                </div>
            </div>

            <div class="ai-field">
                <label class="ai-field-label" for="ai-provider">${t('settingsAi.provider')}</label>
                <select class="ai-select" id="ai-provider"
                        onchange="window.handleAiField('text','provider',this.value)">${options('text')}</select>
            </div>
            <div class="ai-field">
                <label class="ai-field-label" for="ai-base">${t('settingsAi.baseUrl')}</label>
                <input class="ai-input mono" id="ai-base" type="url" inputmode="url"
                       value="${esc(c.text.baseUrl)}" placeholder="https://openrouter.ai/api/v1"
                       onchange="window.handleAiField('text','baseUrl',this.value)">
            </div>
            <div class="ai-field">
                <label class="ai-field-label" for="ai-key">${t('settingsAi.apiKey')}</label>
                <input class="ai-input mono" id="ai-key" type="password" autocomplete="off"
                       spellcheck="false" value="${esc(c.text.apiKey)}"
                       onchange="window.handleAiField('text','apiKey',this.value)">
                <div class="ai-key-state">
                    <span data-ai-key-mask>${c.text.apiKey ? maskKey(c.text.apiKey) : t('settingsAi.never')}</span>
                    <span>${c.sessionOnly ? t('settingsAi.keySessionOnly') : t('settingsAi.keyStored')}</span>
                </div>
            </div>
            <div class="ai-field">
                <label class="ai-field-label" for="ai-model">${t('settingsAi.model')}</label>
                <input class="ai-input mono" id="ai-model" type="text" list="ai-model-list"
                       value="${esc(c.text.model)}"
                       onchange="window.handleAiField('text','model',this.value)">
                <datalist id="ai-model-list"></datalist>
                <div class="ai-btn-row">
                    <button class="settings-btn" onclick="window.aiFetchModels()">${t('settingsAi.fetchModels')}</button>
                    <button class="settings-btn" onclick="window.aiTestConnection()">${t('settingsAi.testConnection')}</button>
                </div>
                <div class="ai-test-result" data-ai-test></div>
            </div>

            <div class="ai-subgroup"><span class="ai-subgroup-title">${t('settingsAi.groupVoice')}</span></div>
            <div class="ai-toggle-row" data-row="ai-voice-mode">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settingsAi.voiceModel')}</div>
                    <div class="settings-row-desc">${following
                        ? t('settingsAi.following', { model: c.text.model || t('settingsAi.never') })
                        : t('settingsAi.followTextDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleAiVoiceMode('${own ? 'follow-text' : 'own'}')">
                    ${own ? t('settingsAi.followText') : t('settingsAi.detach')}
                </button>
            </div>

            ${own ? `
            <div class="ai-field">
                <label class="ai-field-label" for="ai-v-provider">${t('settingsAi.provider')}</label>
                <select class="ai-select" id="ai-v-provider"
                        onchange="window.handleAiField('voice','provider',this.value)">${options('voice')}</select>
            </div>
            <div class="ai-field">
                <label class="ai-field-label" for="ai-v-base">${t('settingsAi.baseUrl')}</label>
                <input class="ai-input mono" id="ai-v-base" type="url" inputmode="url"
                       value="${esc(c.voice.baseUrl)}"
                       onchange="window.handleAiField('voice','baseUrl',this.value)">
            </div>
            <div class="ai-field">
                <label class="ai-field-label" for="ai-v-key">${t('settingsAi.apiKey')}</label>
                <input class="ai-input mono" id="ai-v-key" type="password" autocomplete="off"
                       spellcheck="false" value="${esc(c.voice.apiKey)}"
                       onchange="window.handleAiField('voice','apiKey',this.value)">
            </div>
            <div class="ai-field">
                <label class="ai-field-label" for="ai-v-model">${t('settingsAi.model')}</label>
                <input class="ai-input mono" id="ai-v-model" type="text"
                       value="${esc(c.voice.model)}"
                       onchange="window.handleAiField('voice','model',this.value)">
            </div>` : ''}

            <div class="ai-field">
                <label class="ai-field-label" for="ai-lang">${t('settingsAi.language')}</label>
                <select class="ai-select" id="ai-lang" onchange="window.handleAiLanguage(this.value)">
                    <option value=""${c.voice.language ? '' : ' selected'}>${t('settingsAi.languageInherit')}</option>
                    <option value="en"${c.voice.language === 'en' ? ' selected' : ''}>English</option>
                    <option value="es"${c.voice.language === 'es' ? ' selected' : ''}>Español</option>
                </select>
            </div>

            <div class="ai-subgroup"><span class="ai-subgroup-title">${t('settingsAi.groupBehaviour')}</span></div>
            <div class="ai-toggle-row" data-row="ai-screen-lock">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('ai.screenLock')}</div>
                    <div class="settings-row-desc">${isScreenLockSupported()
                        ? t('ai.screenLockDesc')
                        : t('ai.screenLockUnsupported')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleAiToggle('screenLock')"
                        ${isScreenLockSupported() ? '' : 'disabled'}>${c.screenLock ? t('action.on') : t('action.off')}</button>
            </div>

            <div class="ai-toggle-row" data-row="ai-wake">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('ai.wake')}</div>
                    <div class="settings-row-desc">${t('ai.wakeDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleAiToggle('wake')">${c.wake.enabled ? t('action.on') : t('action.off')}</button>
            </div>

            ${c.wake.enabled ? `
            <div class="ai-field">
                <label class="ai-field-label" for="ai-wake-phrases">${t('ai.wakePhrases')}</label>
                <input class="ai-input mono" id="ai-wake-phrases" type="text"
                       value="${esc(c.wake.phrases.join(', '))}"
                       placeholder="hey nova, ok nova, nova"
                       onchange="window.handleAiWakePhrases(this.value)">
                <div class="ai-note">${t('ai.wakePhrasesDesc')}</div>
            </div>` : ''}

            <div class="ai-toggle-row" data-row="ai-speak">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settingsAi.speakReplies')}</div>
                    <div class="settings-row-desc">${t('settingsAi.speakRepliesDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleAiToggle('speak')">${c.speak ? t('action.on') : t('action.off')}</button>
            </div>

            <div class="ai-toggle-row" data-row="ai-remember">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settingsAi.remember')}</div>
                    <div class="settings-row-desc">${t('settingsAi.rememberDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleAiToggle('remember')">${c.remember ? t('action.on') : t('action.off')}</button>
            </div>

            <div class="ai-toggle-row" data-row="ai-session-only">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('settingsAi.sessionOnly')}</div>
                    <div class="settings-row-desc">${t('settingsAi.keySessionOnly')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleAiToggle('sessionOnly')">${c.sessionOnly ? t('action.on') : t('action.off')}</button>
            </div>

            <div class="ai-note warn">${t('settingsAi.keyWarning')}</div>

            <div class="ai-btn-row">
                <button class="settings-btn danger" onclick="window.handleAiClearKey()">${t('settingsAi.clearKey')}</button>
            </div>
            <div class="ai-note">${t('settingsAi.clearKeyDesc')}</div>
        </section>`;
}

/**
 * Which groups the user has opened.
 *
 * `renderSettings()` is called on `presets-updated`, `stats-updated`,
 * `pwa-state-changed` and `locale-changed`, and it rebuilds the whole body from
 * a template. Without this, tapping a theme would snap every group shut - the
 * screen would close itself under the user's thumb, which is worse than the
 * long page it replaced. Two groups start open because they are the two things
 * people open Settings for, and both are a single tap of content.
 */
const openGroups = new Set(['appearance', 'language']);

/**
 * A group to expand on the next render, asked for by another screen.
 *
 * It is held rather than written into `openGroups` directly because
 * `captureOpenGroups()` reads the live DOM at the START of `renderSettings`
 * and clears the set from there. Seeding it before the call therefore works
 * only when the body happens to be empty - on a re-open the previous render's
 * state wipes it and the group the user was sent to stays shut.
 */
let pendingGroup = null;

const CHEVRON = `<svg class="settings-group-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

/**
 * One collapsible group. `note` is the live status shown on the closed row, so
 * the screen can be scanned without opening anything.
 */
const group = (id, titleKey, bodyHtml, note = '') => `
    <details class="settings-group" data-group="${id}"${openGroups.has(id) ? ' open' : ''}>
        <summary class="settings-group-head">
            <span class="settings-group-title">${t(titleKey)}</span>
            ${note ? `<span class="settings-group-note">${note}</span>` : ''}
            ${CHEVRON}
        </summary>
        <div class="settings-group-body">${bodyHtml}</div>
    </details>`;

/**
 * Remember which groups are open, by reading them BEFORE the body is
 * overwritten.
 *
 * The obvious version - a `toggle` listener per group - is wrong, and the
 * suite caught it: `toggle` is queued as a task, so it has not run yet when the
 * `click` that caused it is followed synchronously by a re-render. The state
 * was therefore always one render stale, and the group a user had just opened
 * snapped shut. Reading the live DOM here is synchronous and cannot be.
 *
 * On the very first render the body is empty, so the defaults in `openGroups`
 * stand - which is what "two groups start open" means.
 */
function captureOpenGroups(root) {
    const found = root.querySelectorAll('details.settings-group');
    if (!found.length) return;
    openGroups.clear();
    for (const d of found) {
        if (d.open) openGroups.add(d.dataset.group);
    }
}

/** Render the whole screen. Cheap enough to redraw after any change. */
export /**
 * What the closed "AI assistant" row says. The point of a collapsed group is
 * that you can still read it, so this has to be the answer to "is it set up?"
 * without opening anything.
 */
function aiGroupNote(config) {
    if (!isTextConfigured()) return t('settingsAi.notConfigured');
    return config.text.model || t('settingsAi.configured');
}

/** The same idea for the App group: installable, offline-ready, or neither. */
function appGroupNote() {
    const state = getInstallState();
    if (state === 'installed') return t('settings.installed');
    if (isOfflineReady()) return t('settings.offlineReadyShort');
    return t('settings.offlinePreparingShort');
}

/**
 * The account group.
 *
 * Two states and no third: signed out, or signed in with a backup button. Both
 * say plainly that this is optional - the app above this group works with no
 * account at all, and copy that implies otherwise would be a lie the user only
 * finds out about when they decline.
 *
 * The email goes through `esc()`. It is the user's own address rather than
 * something a stranger typed, but it is the only untrusted string on this
 * screen, and one `esc()` is cheaper than being the screen where that changes.
 */
function accountHtml() {
    const user = getUser();
    // The key reassurance is outside the branch on purpose. It is the thing
    // that makes signing in feel safe, so it is the thing to read *before*
    // signing in - hiding it behind a session would put it exactly one step
    // too late.
    const keyRow = `
        <div class="settings-row" data-row="key-stays-here">
            <div class="settings-row-main">
                <div class="settings-row-desc">${t('account.keyStaysHere')}</div>
            </div>
        </div>`;

    if (!isSignedIn() || !user) {
        return `
            <div class="settings-row" data-row="sign-in">
                <div class="settings-row-main">
                    <div class="settings-row-title">${t('account.signIn')}</div>
                    <div class="settings-row-desc">${t('account.signInDesc')}</div>
                </div>
                <button class="settings-btn" onclick="window.handleSignIn()">${t('account.signIn')}</button>
            </div>${keyRow}`;
    }
    const lastSync = getLastSyncAt();
    const when = lastSync ? formatWhen(lastSync) : '';
    return `
        <div class="settings-row" data-row="account-state">
            <div class="settings-row-main">
                <div class="settings-row-title">${esc(user.email || user.name || t('account.signedInShort'))}</div>
                <div class="settings-row-desc">${when ? t('account.backupAt', { when: esc(when) }) : t('account.backupNever')}</div>
            </div>
        </div>
        <div class="settings-row" data-row="backup-now">
            <div class="settings-row-main">
                <div class="settings-row-title">${t('account.backupNow')}</div>
                <div class="settings-row-desc">${t('account.backupNowDesc')}</div>
            </div>
            <button class="settings-btn" onclick="window.handleCloudBackup()">${t('action.save')}</button>
        </div>
        <div class="settings-row" data-row="restore-backup">
            <div class="settings-row-main">
                <div class="settings-row-title">${t('account.restore')}</div>
                <div class="settings-row-desc">${t('account.restoreDesc')}</div>
            </div>
            <button class="settings-btn" onclick="window.handleCloudRestore()">${t('action.restore')}</button>
        </div>
        <div class="settings-row" data-row="sign-out">
            <div class="settings-row-main">
                <div class="settings-row-title">${t('account.signOut')}</div>
                <div class="settings-row-desc">${t('account.signOutDesc')}</div>
            </div>
            <button class="settings-btn" onclick="window.handleSignOut()">${t('account.signOut')}</button>
        </div>${keyRow}`;
}

/** What the closed row says, per the rule that a collapsed group is scannable. */
function accountGroupNote() {
    return isSignedIn() ? t('account.signedInShort') : t('account.signedOutShort');
}

/**
 * A timestamp in the app's own language, not a machine one.
 *
 * `toLocaleString` with no options is deliberately not what is wanted here -
 * "1/2/2026, 3:04:05 PM" is a date a person reads, and the settings list is
 * full of sentences rather than a data table.
 */
function formatWhen(iso) {
    try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString(getLang(), {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    } catch {
        return '';
    }
}

export function renderSettings() {
    const body = document.getElementById('settings-body');
    if (!body) return;

    // Read what is open now, before the template replaces it all.
    captureOpenGroups(body);

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
                ${group('appearance', 'settings.appearance', `
                        <div class="theme-grid">${themeCards}</div>
        `, t(`theme.${active}`))}
        ${group('language', 'settings.language', `
                        ${languageRowHtml()}
        `, t(`lang.${getLang()}`))}
        ${group('ai', 'settingsAi.section', `${aiSettingsHtml()}`, aiGroupNote(getAiConfig()))}
        ${group('presets', 'settings.presets', `
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
        `, t('settings.presetsInLibrary', { n: presetCount }))}
        ${group('drills', 'settings.drills', `
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
        `, )}
        ${group('statistics', 'settings.statistics', `
                        <div class="settings-row" data-row="open-stats">
                            <div class="settings-row-main">
                                <div class="settings-row-title">${t('settings.trainingHistory')}</div>
                                <div class="settings-row-desc">${t('settings.trainingHistoryDesc', { n: sessionCount })}</div>
                            </div>
                            <button class="settings-btn" onclick="window.openStatsFromSettings()">${t('action.open')}</button>
                        </div>
        `, t('settings.sessionCount', { n: sessionCount }))}
        ${group('app', 'settings.app', `
                        ${installRowHtml()}
                        <div class="settings-row" data-row="offline-ready">
                            <div class="settings-row-main">
                                <div class="settings-row-title">${t('settings.offlineUse')}</div>
                                <div class="settings-row-desc">${isOfflineReady()
                                    ? t('settings.offlineReady')
                                    : t('settings.offlinePreparing')}</div>
                            </div>
                        </div>
        `, appGroupNote())}
        ${group('account', 'account.section', `${accountHtml()}`, accountGroupNote())}
        ${group('data', 'settings.data', `
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
        `, )}
        <div class="settings-foot">${footHtml()}</div>`;

    revealPendingGroup();
}

/**
 * Expand the group another screen asked for, now that the DOM exists.
 *
 * The group id is matched against the rendered rows rather than interpolated
 * into a selector: it arrives from an event, and there is no reason to hand a
 * caller a way to build a query out of one.
 */
function revealPendingGroup() {
    if (!pendingGroup) return;
    const wanted = pendingGroup;
    pendingGroup = null;
    const details = [...document.querySelectorAll('#settings-body details.settings-group')]
        .find((d) => d.dataset.group === wanted);
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ block: 'start' });
}

/**
 * Picking a theme must not bounce the user out of Settings - the whole point
 * of moving themes here is to compare all four side by side. Same for the
 * language: switch it and stay on the screen to see the result.
 */
// --- the AI assistant's settings handlers -----------------------------------
//
// Every one of these writes through `setAiConfig()`, which normalizes on the
// way in and persists through the same try/catch the rest of the app uses. The
// screen is redrawn afterwards rather than patched in place, so what is on
// screen is always what is stored.

export function handleAiField(slot, field, value) {
    if (slot !== 'text' && slot !== 'voice') return;
    // Picking a provider fills in its base URL - but only when the field is
    // still empty or still on a provider default, so it never overwrites a
    // self-hosted URL somebody typed by hand.
    if (field === 'provider') {
        const c = getAiConfig();
        const current = normalizeBaseUrl(c[slot].baseUrl);
        const known = Object.values(PROVIDERS).map(p => p.baseUrl).filter(Boolean);
        if (!current || known.includes(current)) {
            setAiConfig({ [slot]: { provider: value, baseUrl: PROVIDERS[value]?.baseUrl || '' } });
            renderSettings();
            return;
        }
    }
    setAiConfig({ [slot]: { [field]: value } });
    showToast(t('settingsAi.savedMsg'));
    renderSettings();
}

/**
 * "Use the text model for voice too" is a MODE, not a copy and not a shared
 * pointer - see the header of aiConfig.js. Switching to `own` seeds the voice
 * slot from what the text slot currently says, so detaching does not leave you
 * staring at four empty fields wondering what it used to be.
 */
export function handleAiVoiceMode(mode) {
    const c = getAiConfig();
    if (mode === 'own' && c.voice.mode !== 'own') {
        setAiConfig({ voice: { mode: 'own', provider: c.text.provider, baseUrl: c.text.baseUrl, model: c.text.model, apiKey: c.text.apiKey } });
    } else {
        setAiConfig({ voice: { mode: 'follow-text' } });
    }
    renderSettings();
}

/** '' means "same as the app", which is the app's one rule everywhere else. */
export function handleAiLanguage(code) {
    setAiConfig({ voice: { language: code === 'en' || code === 'es' ? code : '' } });
    renderSettings();
}

export function handleAiToggle(field) {
    const c = getAiConfig();
    if (field === 'speak' || field === 'remember' || field === 'sessionOnly' || field === 'screenLock') {
        setAiConfig({ [field]: !c[field] });
    } else if (field === 'wake') {
        setAiConfig({ wake: { enabled: !c.wake.enabled } });
    }
    // Arming or disarming belongs to whoever is listening, and the panel
    // redraws itself, so tell it.
    if (field === 'wake' || field === 'screenLock') document.dispatchEvent(new CustomEvent('ai-voice-settings'));
    renderSettings();
}

/** "hey nova, ok nova" -> the phrase list. Junk entries are dropped by normalizeConfig. */
export function handleAiWakePhrases(value) {
    setAiConfig({ wake: { phrases: String(value ?? '').split(',') } });
    showToast(t('settingsAi.savedMsg'));
    renderSettings();
}

/** Forget the key. Everything else about the configuration stays. */
export function handleAiClearKey() {
    clearAiKey();
    showToast(t('settingsAi.cleared'));
    renderSettings();
}

/**
 * Ask the endpoint what models it has. The result fills a <datalist> rather
 * than a <select>: §16 Q6 - a self-hosted proxy may have ids the picker never
 * heard of, so the field has to stay free text and the list is only a hint.
 */
export async function aiFetchModels({ fetchImpl = fetch } = {}) {
    const slot = getAiConfig().text;
    if (!slot.baseUrl || !slot.apiKey) {
        setAiTestResult(t('settingsAi.failed'), 'bad');
        return [];
    }
    setAiTestResult(t('settingsAi.testing'), '');

    try {
        const res = await fetchImpl(modelsUrl(slot), { headers: buildHeaders(slot, { json: false }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const ids = (Array.isArray(data?.data) ? data.data : [])
            .map(m => m?.id).filter(id => typeof id === 'string').slice(0, 200);

        const list = document.getElementById('ai-model-list');
        if (list) {
            list.innerHTML = '';
            for (const id of ids) {
                const opt = document.createElement('option');
                opt.value = id;
                list.appendChild(opt);
            }
        }
        setAiTestResult(ids.length
            ? t('settingsAi.modelsLoaded', { n: ids.length })
            : t('settingsAi.noModels'), ids.length ? 'ok' : 'bad');
        return ids;
    } catch (err) {
        // The message is redacted on the way out: a provider that echoes the
        // Authorization header into its own error body is a real thing, and
        // that text ends up in the DOM and in a screenshot.
        setAiTestResult(`${t('settingsAi.failed')}: ${redactAi(err?.message || String(err))}`, 'bad');
        return [];
    }
}

/** One real request, and a real answer, rather than a "looks configured" tick. */
export async function aiTestConnection({ fetchImpl = fetch } = {}) {
    const slot = getAiConfig().text;
    if (!isTextConfigured()) {
        setAiTestResult(t('settingsAi.failed'), 'bad');
        return false;
    }
    setAiTestResult(t('settingsAi.testing'), '');

    try {
        const res = await chat({
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 8,
            fetchImpl,
            slot
        });
        setAiTestResult(res?.text ? t('settingsAi.ok') : t('settingsAi.failed'), res?.text ? 'ok' : 'bad');
        return !!res?.text;
    } catch (err) {
        setAiTestResult(`${t('settingsAi.failed')}: ${redactAi(err?.message || String(err))}`, 'bad');
        return false;
    }
}

/** The result line, as text. Never as markup. */
function setAiTestResult(text, kind) {
    const node = document.querySelector('#settings-body [data-ai-test]');
    if (!node) return;
    node.className = `ai-test-result${kind ? ' ' + kind : ''}`;
    node.textContent = text;
}

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
// app. This is the only Escape handler in the stack: Statistics and the
// assistant sit above Settings, and two listeners would both fire on one
// keypress. It cannot live in statsUi.js either, because Settings imports that
// module - its dependency is evaluated first, so a listener there would close
// Statistics before this one got to look, and one Escape would close both.
//
// The order below IS the z-order: assistant 170, Statistics 160, Settings 150.
// Checking them out of order closes the wrong screen and leaves the topmost
// one up, which is worse than closing nothing.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isAiOpen()) { closeAiView(); return; }
    if (isStatsOpen()) { closeStatsView(); return; }
    if (open) closeSettings();
});

// The preset count and the statistics line both go stale while this screen is
// open, so redraw whenever the data behind them changes.
document.addEventListener('presets-updated', () => { if (open) renderSettings(); });
document.addEventListener('stats-updated', () => { if (open) renderSettings(); });

/**
 * Open Settings with one group already expanded.
 *
 * The assistant panel needs this and cannot call it directly: this module
 * already imports aiUi.js, so importing the other way would be a cycle. A
 * document event is the pattern the rest of the app uses for exactly that
 * (AGENTS.md, "Cross-module talk goes through CustomEvents").
 */export function openSettingsAt(group) {
    if (typeof group === 'string' && group) pendingGroup = group;
    openSettings();
}

document.addEventListener('settings-open', (event) => {
    openSettingsAt(event?.detail?.group);
});

// The install row changes under the user: the browser fires
// beforeinstallprompt some time after load, and the prompt is spent the moment
// it is used. Without this the row would be frozen on whatever it said when
// Settings happened to be opened.
document.addEventListener('pwa-state-changed', () => { if (open) renderSettings(); });

// Every string on this screen comes from t(), so a language change has to
// redraw it. `open` is the same guard the other listeners use: redrawing a
// hidden screen would throw away the scroll position for nothing.
document.addEventListener('locale-changed', () => { if (open) renderSettings(); });

// --- the account and backup handlers -----------------------------------------
//
// All four act on the screen they are on, so each one redraws rather than
// patching a single row: the group's status note changes ("not signed in" ->
// "signed in", "never backed up" -> a timestamp) and the note lives on the
// summary row, which a one-row patch would miss.

/** Leave for the site's own login. There is nothing to render on the way out. */
export async function handleSignIn() {
    try {
        await startSignIn();
    } catch (err) {
        console.error('Could not start sign-in', err);
        showToast(t('account.backupFailed'));
    }
}

export async function handleSignOut() {
    await signOut();
    showToast(t('account.signOut'));
    renderSettings();
}

export async function handleCloudBackup() {
    if (!isSignedIn()) {
        showToast(t('account.needAccount'));
        return;
    }
    const result = await pushBundle();
    if (!result.ok) {
        // Deliberately the same message for "not signed in" and "the network
        // is down": this screen has no way to tell the user which, and
        // guessing wrong is worse than saying it did not go through.
        showToast(t('account.backupFailed'));
        return;
    }
    showToast(t('account.backupDone'));
    renderSettings();
}

export async function handleCloudRestore() {
    if (!isSignedIn()) {
        showToast(t('account.needAccount'));
        return;
    }
    // This overwrites the drills on this device, so it asks first. The answer
    // is the user's decision about their own data, never a default.
    if (!confirm(t('account.restoreConfirm'))) return;

    const result = await restoreFromCloud();
    if (!result.ok) {
        showToast(t('account.restoreFailed'));
        return;
    }
    if (!result.saved || result.applied === null) {
        showToast(t('account.restoreNone'));
        return;
    }

    // A reload is not laziness here, it is the only way it works: the drill
    // lists, the preset library and the stats totals are all read from
    // localStorage once at start-up and held in memory. Writing the values
    // back without reloading would restore the data and leave the screen
    // showing what was there before.
    showToast(t('account.restoreDone', { n: result.applied }));
    setTimeout(() => location.reload(), 600);
}

window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.handleSettingsTheme = handleSettingsTheme;
window.handleSettingsLang = handleSettingsLang;
window.handlePresetImportPick = handlePresetImportPick;
window.handleInstallApp = handleInstallApp;
window.handleSignIn = handleSignIn;
window.handleSignOut = handleSignOut;
window.handleCloudBackup = handleCloudBackup;
window.handleCloudRestore = handleCloudRestore;
window.handleAiField = handleAiField;
window.handleAiVoiceMode = handleAiVoiceMode;
window.handleAiToggle = handleAiToggle;
window.handleAiLanguage = handleAiLanguage;
window.handleAiWakePhrases = handleAiWakePhrases;
window.handleAiClearKey = handleAiClearKey;
window.aiFetchModels = aiFetchModels;
window.aiTestConnection = aiTestConnection;
