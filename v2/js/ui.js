import { 
    currentDrills, 
    userCustomDrills, 
    appStats, 
    drillOrder, 
    saveDrillOrder, 
    saveDrillsToStorage, 
    selectedLevel,
    lastPlayedDrill,
    getSessionSummary 
} from './state.js';
import { bleState } from './bluetooth.js';
import { makeBall } from './ball.js';
import { showToast, formatDuration, drillKeyName } from './utils.js'; 
import { openEditor } from './editor.js';
import { t, drillDisplayName } from './i18n.js';
import { getAiDrills, deleteAiDrill, clearAiDrills, moveToCustom } from './aiStore.js';

// --- NEW: Handle Create New Drill ---
window.handleCreateNewDrill = (category) => {
    // UPDATED LIMIT: 100
    if (userCustomDrills[category].length >= 100) {
        showToast(t('toast.categoryFull'));
        return;
    }

    const newName = prompt(t('prompt.newDrillName'));
    if (!newName) return;

    if (newName.length > 25) { 
        showToast(t('toast.nameTooLong25')); 
        return; 
    }

    const catChar = category.split('-')[1].toUpperCase();
    const newKey = `cust_${catChar}_${drillKeyName(newName)}_${Date.now()}`;

    userCustomDrills[category].push({ name: newName, key: newKey });

    currentDrills[newKey] = {
        // Speed/spin and the motor RPMs are derived together by makeBall. The
        // old hard-coded array claimed "speed 5, spin 2" while carrying the
        // RPMs of a different ball, so a fresh drill fired something other
        // than what the editor displayed.
        1: [[makeBall({ speed: 5, spin: 2, type: 'top', height: 50, drop: 0, bpm: 60, reps: 1 })]],
        2: [],
        3: [],
        random: false
    };

    localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
    saveDrillsToStorage();

    renderDrillButtons();
    showToast(t('toast.created', { name: newName }));
    openEditor(newKey);
};

// --- NEW: Drag & Drop to Tab Handlers ---

window.allowTabDrop = (e) => {
    e.preventDefault(); 
};

window.handleTabDrop = (e, targetCat) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain');
    if (!key) return;

    let sourceCat = null;
    let drillObj = null;
    let drillIndex = -1;

    ['custom-a', 'custom-b', 'custom-c'].forEach(cat => {
        const idx = userCustomDrills[cat].findIndex(d => d.key === key);
        if (idx !== -1) {
            sourceCat = cat;
            drillIndex = idx;
            drillObj = userCustomDrills[cat][idx];
        }
    });

    if (!sourceCat) return; 
    if (sourceCat === targetCat) return; 
    
    // UPDATED LIMIT: 100
    if (userCustomDrills[targetCat].length >= 100) {
        showToast(t('toast.bankFull', { bank: targetCat.split('-')[1].toUpperCase() }));
        return;
    }

    const targetChar = targetCat.split('-')[1].toUpperCase();
    let newKey = key.replace(/^cust_[ABC]_/i, `cust_${targetChar}_`);
    
    if (currentDrills[newKey]) {
        newKey = `${newKey}_${Date.now()}`;
    }

    currentDrills[newKey] = JSON.parse(JSON.stringify(currentDrills[key]));
    
    userCustomDrills[targetCat].push({
        name: drillObj.name,
        key: newKey
    });

    userCustomDrills[sourceCat].splice(drillIndex, 1);
    delete currentDrills[key];

    localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
    saveDrillsToStorage();

    renderDrillButtons(); 
    showToast(t('toast.movedTo', { bank: targetChar }));
    
    const targetBtn = document.querySelector(`.tab-btn[onclick*="${targetCat}"]`);
    if(targetBtn) switchTab(targetCat, targetBtn);
};

// --- EXISTING UI LOGIC ---

export function renderDrillButtons() {
    ['basic', 'combined', 'complex'].forEach(cat => {
        const container = document.getElementById(`view-${cat}`);
        if (!container) return;
        container.innerHTML = '';
        
        if (drillOrder[cat]) {
            drillOrder[cat].forEach(key => {
                if (!currentDrills[key]) return; 
                createButton(container, key, drillDisplayName(key), true, cat);
            });
        }
    });

    ['custom-a', 'custom-b', 'custom-c'].forEach(cat => {
        const container = document.getElementById(`view-${cat}`);
        if (!container) return;
        container.innerHTML = '';
        
        userCustomDrills[cat].forEach(item => {
            createButton(container, item.key, item.name, true, cat);
        });

        const addWrapper = document.createElement('div');
        addWrapper.style.cssText = "width:100%; display:flex; justify-content:center; margin:15px 0 10px 0;";

        const addBtn = document.createElement('button');
        // Sizing lives in .btn-drill-add rather than an inline cssText, so the
        // button's colours keep following the active theme. An inline
        // border-color here used to pin it to whatever the palette was on the
        // day this was written.
        addBtn.className = 'btn-swap btn-drill-add';
        addBtn.title = t('a11y.createNewDrill');
        
        addBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        `;
        
        addBtn.onclick = () => window.handleCreateNewDrill(cat);
        
        addWrapper.appendChild(addBtn);
        container.appendChild(addWrapper);
    });

    renderIaList();

    updateLastPlayedHighlight();
}

/**
 * The IA tab.
 *
 * Not a custom set, and that is the whole reason it exists separately:
 * `importCustomDrills()` rebuilds `custom_data` from scratch, so AI drills
 * living inside a custom set would be silently deleted by importing any CSV -
 * including one the user exported themselves. They are in `nova_ai_drills`
 * instead, and they are not in the shared drill CSV until one is moved into
 * Custom A/B/C, at which point it is an ordinary drill.
 *
 * Rows carry an IA chip and a source glyph, and three one-tap move buttons. A
 * drill that is not in the shared CSV is exactly the thing a user needs to be
 * able to notice, so the row says so rather than looking like any other.
 */
function renderIaList() {
    const container = document.getElementById('view-ia');
    if (!container) return;
    container.innerHTML = '';

    const drills = getAiDrills();
    if (!drills.length) {
        const empty = document.createElement('div');
        empty.className = 'ia-empty';
        empty.textContent = t('ia.emptyList');
        container.appendChild(empty);
        return;
    }

    for (const drill of drills) container.appendChild(iaRow(drill));

    const clear = document.createElement('button');
    clear.className = 'btn-swap btn-drill-add ia-clear';
    clear.textContent = t('ai.clearCategory');
    clear.onclick = () => window.clearIaCategory();
    container.appendChild(clear);
}

/** A glyph for where the drill came from. Decorative: the chip carries the meaning. */
const SOURCE_GLYPH = { voice: '\u{1F399}', text: '\u{2328}', model: '\u2726' };

function iaRow(drill) {
    const wrap = document.createElement('div');
    wrap.className = 'ia-row';

    const row = document.createElement('div');
    row.className = 'btn-drill';
    // The key is minted from the clock, so interpolating it into this
    // attribute is safe - see aiStore.newAiDrillKey().
    row.dataset.key = drill.key;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'drill-play';
    play.innerHTML = ICON_PLAY;
    play.title = t('a11y.playDrill');
    play.setAttribute('aria-label', `${t('a11y.playDrill')}: ${drill.name}`);
    play.onclick = (e) => {
        e.stopPropagation();
        if (!bleState.isConnected) {
            showToast(t('toast.notConnected'));
            return;
        }
        window.playAiDrill(drill.key);
    };

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'drill-main';
    main.title = t('a11y.editDrill');
    main.setAttribute('aria-label', `${t('a11y.editDrill')}: ${drill.name}`);

    const text = document.createElement('span');
    text.className = 'drill-text';

    const label = document.createElement('span');
    label.className = 'drill-name';
    // A model-authored name: textContent, never innerHTML.
    label.textContent = drill.name;
    text.appendChild(label);

    const meta = document.createElement('span');
    meta.className = 'drill-meta';
    meta.textContent = t('ia.meta');
    text.appendChild(meta);
    main.appendChild(text);

    const chip = document.createElement('div');
    chip.className = 'mark-ai';
    chip.textContent = 'IA';
    main.appendChild(chip);

    const glyph = document.createElement('div');
    glyph.className = 'mark-source';
    glyph.textContent = SOURCE_GLYPH[drill.source] || SOURCE_GLYPH.text;
    glyph.title = t(`ia.source.${drill.source}`);
    main.appendChild(glyph);

    // Tap the body to edit it, exactly like every other drill. Playing lives on
    // its own button; on this row that button is also the only thing that needs
    // a robot.
    main.onclick = () => openEditor(drill.key);

    row.appendChild(play);
    row.appendChild(main);
    wrap.appendChild(row);

    const actions = document.createElement('div');
    actions.className = 'ia-row-actions';
    for (const bank of ['A', 'B', 'C']) {
        const move = document.createElement('button');
        move.className = 'ia-move';
        move.textContent = bank;
        move.title = t('ia.moveTo', { bank });
        move.setAttribute('aria-label', t('ia.moveTo', { bank }));
        move.onclick = () => window.moveAiDrill(drill.key, `custom-${bank.toLowerCase()}`);
        actions.appendChild(move);
    }

    const del = document.createElement('button');
    del.className = 'ia-move danger';
    del.textContent = '\u2715';
    del.title = t('action.delete');
    del.setAttribute('aria-label', t('action.delete'));
    del.onclick = () => window.deleteAiDrillRow(drill.key);
    actions.appendChild(del);

    wrap.appendChild(actions);
    return wrap;
}

/**
 * Move an AI drill into one of the user's own sets. This is how it becomes
 * permanently theirs: an ordinary custom drill, in `custom_drills`, and
 * therefore in the CSV export.
 */
export function moveAiDrillTo(key, category) {
    const deps = {
        currentDrills,
        userCustomDrills,
        setCustomData: () => localStorage.setItem('custom_data', JSON.stringify(userCustomDrills)),
        saveDrillsToStorage
    };
    const newKey = moveToCustom(key, category, deps);
    if (!newKey) {
        showToast(t('toast.bankFull', { bank: category.split('-')[1].toUpperCase() }));
        return null;
    }
    showToast(t('toast.aiMoved', { bank: category.split('-')[1].toUpperCase() }));
    renderDrillButtons();
    document.dispatchEvent(new CustomEvent('drills-updated'));
    return newKey;
}

export function deleteAiDrillRow(key) {
    if (deleteAiDrill(key)) renderIaList();
}

export function clearIaCategory() {
    if (!getAiDrills().length) return false;
    if (!confirm(t('ai.confirmClearCategory'))) return false;
    clearAiDrills();
    showToast(t('toast.aiCleared'));
    renderIaList();
    return true;
}

export function updateLastPlayedHighlight() {
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('last-played'));
    
    if (lastPlayedDrill) {
        const btn = document.querySelector(`.btn-drill[data-key="${lastPlayedDrill}"]`);
        if (btn) btn.classList.add('last-played');
    }
}

/* Stroke icons, explicitly painted. The icon-paint check in the integration
   suite exists because an <svg> with no fill/stroke paints solid black. */
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z"></path></svg>';
const ICON_GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<circle cx="9" cy="7" r="1.4"></circle><circle cx="15" cy="7" r="1.4"></circle>'
    + '<circle cx="9" cy="12" r="1.4"></circle><circle cx="15" cy="12" r="1.4"></circle>'
    + '<circle cx="9" cy="17" r="1.4"></circle><circle cx="15" cy="17" r="1.4"></circle></svg>';

/** The line under a drill's name: how much is in it, and a hint that it edits. */
function drillMeta(key) {
    const steps = currentDrills[key]?.[selectedLevel]?.length || 0;
    return steps ? t('unit.countBalls', { n: steps }) : t('drill.noBalls');
}

/**
 * One row in the drill list: play, name, edit.
 *
 * A single tap used to *start* the drill and editing was hidden behind a 600ms
 * press, which meant the common action was easy and the one people could not
 * find was invisible. Now the row says what it does:
 *
 *   [▶]  starts the drill          (the only action that needs a robot)
 *   name / count  opens the editor  (the row's body, with a pencil affordance)
 *   grip  reorders it               (desktop drag, as before)
 */
function createButton(container, key, label, allowSort, category) {
    const row = document.createElement('div');
    row.className = 'btn-drill';
    row.dataset.key = key;

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'drill-play';
    play.innerHTML = ICON_PLAY;
    play.title = t('a11y.playDrill');
    play.setAttribute('aria-label', `${t('a11y.playDrill')}: ${label}`);
    play.onclick = (e) => {
        e.stopPropagation();
        if (row.classList.contains('dragging')) return;
        window.handleDrillClick(key, row);
    };

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'drill-main';
    main.title = t('a11y.editDrill');
    main.setAttribute('aria-label', `${t('a11y.editDrill')}: ${label}`);

    const text = document.createElement('span');
    text.className = 'drill-text';

    const name = document.createElement('span');
    name.className = 'drill-name';
    name.textContent = label;
    text.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'drill-meta';
    meta.textContent = drillMeta(key);
    text.appendChild(meta);
    main.appendChild(text);

    if (currentDrills[key] && currentDrills[key].random) {
        const rMark = document.createElement('span');
        rMark.className = 'mark-random';
        rMark.textContent = 'R';
        rMark.title = t('drill.word.random');
        main.appendChild(rMark);
    }

    const edit = document.createElement('span');
    edit.className = 'drill-edit-mark';
    edit.setAttribute('aria-hidden', 'true');
    edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16v4z"></path><path d="M13.5 6.5l4 4"></path></svg>';
    main.appendChild(edit);

    main.onclick = () => openEditor(key);

    row.appendChild(play);
    row.appendChild(main);

    if (allowSort) {
        const grip = document.createElement('div');
        grip.className = 'drill-grab-handle';
        grip.innerHTML = ICON_GRIP;
        grip.title = t('a11y.dragToReorder');

        row.draggable = false;

        const enableDrag = () => { row.draggable = true; };
        const disableDrag = () => { row.draggable = false; };

        grip.addEventListener('mousedown', enableDrag);
        grip.addEventListener('touchstart', enableDrag, {passive: true});
        grip.addEventListener('mouseup', disableDrag);
        grip.addEventListener('mouseleave', disableDrag);
        grip.addEventListener('touchend', disableDrag);

        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key);
            row.classList.add('dragging');
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            row.draggable = false;
            handleReorder(container, category);
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingItem = container.querySelector('.dragging');
            if (draggingItem && draggingItem !== row) {
                const box = row.getBoundingClientRect();
                const offset = e.clientY - box.top - (box.height / 2);
                if (offset < 0) {
                    container.insertBefore(draggingItem, row);
                } else {
                    container.insertBefore(draggingItem, row.nextSibling);
                }
            }
        });

        grip.onclick = (e) => e.stopPropagation();
        row.appendChild(grip);
    }

    container.appendChild(row);
}

function handleReorder(container, category) {
    const buttons = Array.from(container.querySelectorAll('.btn-drill'));
    const newKeys = buttons.map(b => b.dataset.key);
    
    if (['basic', 'combined', 'complex'].includes(category)) {
        if(newKeys.length === drillOrder[category].length) {
            drillOrder[category] = newKeys;
            saveDrillOrder();
        }
    } else {
        if(newKeys.length === userCustomDrills[category].length) {
            const oldList = userCustomDrills[category];
            const newList = [];
            newKeys.forEach(k => {
                const item = oldList.find(d => d.key === k);
                if(item) newList.push(item);
            });
            userCustomDrills[category] = newList;
            localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));
        }
    }
}

export function updateDrillButtonStates() {
    // The rows stay readable when there is no robot - only the play control is
    // muted. Dimming the whole row also dimmed the name, which is the one thing
    // you are still allowed to read and edit without a connection.
    document.querySelectorAll('.btn-drill').forEach(b => {
        b.classList.toggle('is-offline', !bleState.isConnected);
    });

    const btnConnect = document.getElementById('btn-connect');
    const statusText = document.getElementById('status-text');
    const card = document.getElementById('session-card');

    if (card) {
        card.classList.toggle('is-connected', bleState.isConnected);
        card.classList.toggle('is-busy', bleState.isConnecting);
        card.classList.toggle('is-error',
            !bleState.isConnected && !bleState.isConnecting && bleState.phase === 'error');
    }

    if (btnConnect && statusText) {
        btnConnect.classList.toggle('connecting', bleState.isConnecting);
        btnConnect.disabled = bleState.isConnecting;

        if (bleState.isConnected) {
            btnConnect.textContent = t('action.disconnect');
            btnConnect.classList.add('connected');
            statusText.textContent = t('status.connected');
        } else if (bleState.isConnecting) {
            // Previously the button did not change at all during the whole
            // attempt, so a connection that hung looked like no-op.
            btnConnect.textContent = t('status.connecting');
            btnConnect.classList.remove('connected');
            statusText.textContent = bleState.statusText || t('status.connecting');
        } else if (bleState.phase === 'error') {
            btnConnect.textContent = t('action.retry');
            btnConnect.classList.remove('connected');
            statusText.textContent = bleState.statusText || t('status.failed');
        } else {
            btnConnect.textContent = t('action.connect');
            btnConnect.classList.remove('connected');
            statusText.textContent = t('status.disconnected');
        }
    }
}

export function updateStatsUI() {
    const el = document.getElementById('stats-display');
    if(el) el.textContent = t('footer.totals', { balls: appStats.balls, drills: appStats.drills });
}

export function toggleMenu() {
    const m = document.getElementById('theme-menu');
    if(m) m.classList.toggle('open');
}

export function setTheme(themeName, { closeMenu = true } = {}) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('nova_theme_pref', themeName);
    // Settings picks a theme without dismissing itself, so the caller decides.
    if (closeMenu) toggleMenu();
}

export function switchTab(catName, btn) {
    const tabs = ['basic','combined','complex','custom-a','custom-b','custom-c','ia'];
    tabs.forEach(c => {
        const el = document.getElementById('view-'+c);
        if(el) el.classList.add('hidden');
    });
    const target = document.getElementById('view-' + catName);
    if(target) target.classList.remove('hidden');
    
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    if(btn) btn.classList.add('active');

    const diffGroup = document.getElementById('grp-difficulty');
    if(diffGroup) {
        // A level applies to the factory drills; a custom set or the IA
        // category has its own content, so the control would mean nothing.
        diffGroup.style.display = ['custom-a', 'custom-b', 'custom-c', 'ia'].includes(catName) ? 'none' : 'flex';
    }
}

// --- NEW: About Modal Handlers ---
window.openAboutModal = () => {
    // Close menu first if open
    const menu = document.getElementById('theme-menu');
    if(menu) menu.classList.remove('open');
    
    const m = document.getElementById('about-modal');
    if(m) m.classList.add('open');
};

window.closeAboutModal = () => {
    const m = document.getElementById('about-modal');
    if(m) m.classList.remove('open');
};

// --- NEW: Session Summary UI ---
export function showSessionSummary() {
    const summary = getSessionSummary();
    
    const dVal = document.getElementById('sum-drills-val');
    const bVal = document.getElementById('sum-balls-val');
    const tVal = document.getElementById('sum-time-val'); // <--- NEW
    
    if(dVal) dVal.textContent = summary.drills;
    if(bVal) bVal.textContent = summary.balls;
    if(tVal) tVal.textContent = formatDuration(summary.duration); // <--- NEW
    
    const modal = document.getElementById('summary-modal');
    if(modal) modal.classList.add('open');
}

window.moveAiDrill = moveAiDrillTo;
window.deleteAiDrillRow = deleteAiDrillRow;
window.clearIaCategory = clearIaCategory;

window.closeSummaryModal = () => {
    const modal = document.getElementById('summary-modal');
    if(modal) modal.classList.remove('open');
};