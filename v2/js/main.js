import { 
    initData, 
    setLevel, 
    setMode, 
    resetStats, 
    importCustomDrills, 
    exportCustomDrills, 
    saveAsDefault, 
    resetToDefault, 
    factoryReset,
    appStats,
    userCustomDrills,
    currentDrills,
    saveDrillsToStorage,
    selectedLevel,
    runMode
} from './state.js';

import { initStats } from './stats.js';

import { 
    connectDevice, 
    disconnectDevice, 
    bleState 
} from './bluetooth.js';

import { 
    openEditor, 
    closeEditor, 
    saveDrillChanges 
} from './editor.js';

import { 
    renderDrillButtons, 
    updateDrillButtonStates, 
    setTheme, 
    toggleMenu, 
    switchTab, 
    updateStatsUI,
    showSessionSummary 
} from './ui.js';

import { showToast, drillKeyName } from './utils.js';

// Registers the service worker and the install prompt
import { registerServiceWorker } from './pwa.js';
// Registers the window.* preset handlers used by index.html
import './presetUi.js';

// Registers the window.* settings-screen handlers
import './settingsUi.js';

// Registers the window.* statistics-screen handlers
import './statsUi.js';

// The assistant panel. Imported for its side effects (the window.* handlers and
// the 'locale-changed' listener) like every other screen module, and with a
// relative specifier on purpose: the integration suite's import-graph walker
// only follows specifiers matching ["'](\.[^'"]+)['"], so a bare 'aiUi.js'
// would escape the precache check and then 404 the first time the phone loses
// signal. See AGENTS.md, Installing.
import './aiUi.js';

import { 
    startDrillSequence, 
    stopRun, 
    togglePause,
    skipCountdown // <--- ADDED IMPORT
} from './runner.js';

import { downloadDrill } from './cloud.js';

import { initI18n, applyI18n, t } from './i18n.js';

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    // First, and before anything renders: the drill list, the connection card
    // and every Settings row all label themselves with t(), so a language
    // decided here has to be decided before the first draw.
    initI18n();
    applyI18n();
    initData();
    initStats(); // seals any session a previous page left open
    renderDrillButtons();
    updateStatsUI();
    updateSetupSummary();
    setupEventListeners();
    // Last, and deliberately so: the precache competes for the same connection
    // as the app's own modules, and the app has to boot first either way.
    registerServiceWorker();
    console.log("Nova Drill | Tenisdemesa.ar: Modules Loaded");
});

// --- Event Listeners Setup ---

function setupEventListeners() {
    const btnConnect = document.getElementById('btn-connect');
    if (btnConnect) {
        btnConnect.onclick = () => {
            if (bleState.isConnected) {
                disconnectDevice();
                showSessionSummary();
            }
            // connectDevice() also guards this, but the button is disabled
            // during a connect attempt so a double tap cannot start two.
            else connectDevice();
        };
    }

    const inputPause = document.getElementById('input-pause');
    if (inputPause) {
        inputPause.onchange = (e) => {
            // Updated Logic: Seconds (0.0 - 5.0) with 0.1 step
            let val = parseFloat(e.target.value);
            if(isNaN(val)) val = 1.0;
            
            // Allow down to 0, max 5
            if(val < 0) val = 0; 
            if(val > 5.0) val = 5.0;
            
            e.target.value = val.toFixed(1);
        };
    }

    // --- NEW: Tap to Skip Countdown ---
    const runDisplay = document.getElementById('run-display');
    if (runDisplay) {
        runDisplay.onclick = () => {
            skipCountdown();
        };
    }
    // ----------------------------------

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('theme-menu');
        if (menu && menu.classList.contains('open') && 
            !menu.contains(e.target) && 
            !e.target.closest('.menu-btn')) {
            menu.classList.remove('open');
        }
    });

    document.addEventListener('drills-updated', () => {
        renderDrillButtons();
        updateDrillButtonStates();
    });
    
    // --- ADDED: Listen for stats reset ---
    document.addEventListener('stats-updated', () => {
        updateStatsUI();
    });

    // Switching language has to redraw everything that is currently on screen.
    // applyI18n() handles the static markup that index.html ships; the rest is
    // built at render time and is rebuilt here. Settings, Statistics, the
    // editor and the preset sheet listen for the same event themselves - each
    // module owns the drawing of its own screen, and only the drill list and
    // the connection card are this module's business.
    document.addEventListener('locale-changed', () => {
        applyI18n();
        renderDrillButtons();
        updateDrillButtonStates();
        updateStatsUI();
        updateSetupSummary();
    });

    // The collapsed setup line has to follow the three inputs it summarises.
    // `input` rather than `change`: the number spinner and the keyboard both
    // fire it, and the line is up on screen while the field is being edited.
    for (const id of ['input-reps', 'input-time', 'input-pause']) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateSetupSummary);
    }

    document.addEventListener('connection-changed', () => {
        updateDrillButtonStates();
        const editorModal = document.getElementById('editor-modal');
        if(editorModal && editorModal.classList.contains('open')) {
            const testBtns = document.querySelectorAll('.btn-act-test');
            testBtns.forEach(b => b.disabled = !bleState.isConnected);
        }
    });
}

// --- Window Binding for HTML Compatibility ---

window.toggleMenu = toggleMenu;
window.setTheme = setTheme;
window.switchTab = switchTab;

window.setLevel = (lvl, btn) => {
    setLevel(lvl);
    document.querySelectorAll('.lvl-dot').forEach(d => d.classList.remove('active'));
    if(btn) btn.classList.add('active');
    updateSetupSummary();
};

window.setMode = (mode, btn) => {
    setMode(mode);
    // Only the run-mode switch, never every .mode-option in the document: this
    // used to clear the category picker inside the import/save-as modals too.
    const group = btn ? btn.parentElement : document.querySelector('#session-setup .mode-switch');
    group?.querySelectorAll('.mode-option').forEach(d => d.classList.remove('active'));
    if(btn) btn.classList.add('active');
    
    const uiReps = document.getElementById('ui-reps');
    const uiTime = document.getElementById('ui-time');
    if(mode === 'reps') {
        uiReps?.classList.remove('hidden');
        uiTime?.classList.add('hidden');
    } else {
        uiReps?.classList.add('hidden');
        uiTime?.classList.remove('hidden');
    }
    updateSetupSummary();
};

/**
 * The one line inside the collapsed "Session setup". The numbers are read from
 * the inputs, because those are the model for reps/time/pause; the level and
 * the mode are module state.
 */
export function updateSetupSummary() {
    const el = document.getElementById('setup-values');
    if (!el) return;

    const reps = document.getElementById('input-reps')?.value || '10';
    const secs = document.getElementById('input-time')?.value || '60';
    const pause = document.getElementById('input-pause')?.value || '0.0';
    const amount = runMode === 'time'
        ? t('label.timeShort', { n: secs })
        : t('label.repsShort', { n: reps });

    el.textContent = [
        t('label.levelShort', { n: selectedLevel }),
        amount,
        t('label.pauseShort', { n: pause })
    ].join(' · ');
}

window.resetStats = resetStats;
window.saveAsDefault = saveAsDefault;
window.resetToDefault = resetToDefault;
window.factoryReset = factoryReset;
window.exportCustomDrills = exportCustomDrills;

window.handleCSVUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) { 
        const success = importCustomDrills(e.target.result);
        if(success) {
            renderDrillButtons();
            toggleMenu(); 
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};

window.openEditor = openEditor;
window.closeEditor = closeEditor;
window.saveDrillChanges = saveDrillChanges;
window.togglePause = togglePause;
window.stopRun = stopRun;
// The rest of the run API is on window, and the thing that STARTS a run was
// not: it was reachable only through handleDrillClick, which refuses without
// a robot connected. That made the countdown unreachable for anything driving
// the real page - including tools/screenshots.mjs.
window.startDrillSequence = startDrillSequence;

window.handleDrillClick = (key, btn) => {
    if (!bleState.isConnected) {
        showToast(t('toast.notConnected'));
        return;
    }
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
    btn.classList.add('running');
    startDrillSequence(key);
};

// --- DOWNLOAD MODAL LOGIC (New) ---

let selectedDownloadCat = 'custom-a';

// 1. Open the Modal
window.handleDownloadDialog = () => {
    // Close main menu if open
    const menu = document.getElementById('theme-menu');
    if(menu) menu.classList.remove('open');

    // Reset State
    selectedDownloadCat = 'custom-a';
    const codeInput = document.getElementById('dl-code');
    if (codeInput) codeInput.value = '';
    
    // Reset Switch UI to default (A)
    const switchEl = document.getElementById('dl-cat-switch');
    if(switchEl) {
        Array.from(switchEl.children).forEach(c => c.classList.remove('active'));
        if(switchEl.children[0]) switchEl.children[0].classList.add('active'); 
    }

    const modal = document.getElementById('download-modal');
    if(modal) {
        modal.classList.add('open');
        setTimeout(() => { if(codeInput) codeInput.focus(); }, 100);
    }
};

// 2. Close the Modal
window.closeDownloadModal = () => {
    const modal = document.getElementById('download-modal');
    if(modal) modal.classList.remove('open');
};

// 3. Handle Tab Switching inside Modal
window.selectDlCategory = (val, btn) => {
    selectedDownloadCat = val;
    if(btn && btn.parentElement) {
        Array.from(btn.parentElement.children).forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
    }
};

// 4. Perform Download
window.performDownload = async () => {
    const codeInput = document.getElementById('dl-code');
    if(!codeInput) return;
    
    const code = codeInput.value.trim().toUpperCase();

    if (code.length !== 6) {
        showToast(t('toast.invalidCode'));
        return;
    }

    // Check capacity before calling server
    // UPDATED LIMIT: 100
    if (userCustomDrills[selectedDownloadCat].length >= 100) {
        const catChar = selectedDownloadCat.split('-')[1].toUpperCase();
        showToast(t('toast.bankFull', { bank: catChar }));
        return;
    }

    showToast(t('toast.searching'));

    try {
        const data = await downloadDrill(code);
        if (!data) {
            showToast(t('toast.codeNotFound'));
            return;
        }

        let name = data.name;
        // Check for duplicates in the specific target category
        const existingNames = userCustomDrills[selectedDownloadCat].map(d => d.name);
        if (existingNames.includes(name)) {
            name = `${name} (Imp)`;
        }

        // Unique Key Generation
        const catChar = selectedDownloadCat.split('-')[1].toUpperCase();
        const newKey = `cust_${catChar}_${drillKeyName(name)}_${Date.now()}`;

        // Save Data
        userCustomDrills[selectedDownloadCat].push({ name: name, key: newKey });
        
        const newDrillObj = { 1: [], 2: [], 3: [], random: data.random };
        newDrillObj[selectedLevel] = data.params; 
        currentDrills[newKey] = newDrillObj;

        localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
        saveDrillsToStorage();

        // UI Refresh
        renderDrillButtons();
        window.closeDownloadModal();
        
        // Auto-switch to the target tab
        const tabBtn = document.querySelector(`.tab-btn[onclick*="${selectedDownloadCat}"]`);
        if (tabBtn) switchTab(selectedDownloadCat, tabBtn);

        showToast(t('toast.importedTo', { bank: catChar }));
        toggleMenu(); // Close main menu if it was open behind modal

    } catch (e) {
        console.error(e);
        showToast(t('toast.downloadError'));
    }
};