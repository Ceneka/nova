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

    updateLastPlayedHighlight();
}

export function updateLastPlayedHighlight() {
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('last-played'));
    
    if (lastPlayedDrill) {
        const btn = document.querySelector(`.btn-drill[data-key="${lastPlayedDrill}"]`);
        if (btn) btn.classList.add('last-played');
    }
}

function createButton(container, key, label, allowSort, category) {
    const btn = document.createElement('button');
    btn.className = 'btn-drill';
    btn.dataset.key = key;
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'drill-icon';
    for(let i=0; i<4; i++) {
        iconDiv.appendChild(document.createElement('div')).className = 'd-dot';
    }
    btn.appendChild(iconDiv);

    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);

    if (currentDrills[key] && currentDrills[key].random) {
        const rMark = document.createElement('div');
        rMark.className = 'mark-random';
        rMark.textContent = 'R';
        btn.appendChild(rMark);
    }
    
    if (allowSort) {
        const grip = document.createElement('div');
        grip.className = 'drill-grab-handle';
        grip.innerHTML = '≡'; 
        grip.title = t('a11y.dragToReorder');
        
        btn.draggable = false; 

        const enableDrag = () => { btn.draggable = true; };
        const disableDrag = () => { btn.draggable = false; };

        grip.addEventListener('mousedown', enableDrag);
        grip.addEventListener('touchstart', enableDrag, {passive: true});
        grip.addEventListener('mouseup', disableDrag);
        grip.addEventListener('mouseleave', disableDrag);
        grip.addEventListener('touchend', disableDrag);

        btn.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', key); 
            btn.classList.add('dragging');
        });

        btn.addEventListener('dragend', () => {
            btn.classList.remove('dragging');
            btn.draggable = false; 
            handleReorder(container, category);
        });
        
        btn.addEventListener('dragover', (e) => {
            e.preventDefault(); 
            const draggingItem = container.querySelector('.dragging');
            if (draggingItem && draggingItem !== btn) {
                const box = btn.getBoundingClientRect();
                const offset = e.clientY - box.top - (box.height / 2);
                if (offset < 0) {
                    container.insertBefore(draggingItem, btn);
                } else {
                    container.insertBefore(draggingItem, btn.nextSibling);
                }
            }
        });

        grip.onclick = (e) => e.stopPropagation();
        btn.appendChild(grip);
    }
    
    btn.onclick = (e) => {
        if(btn.classList.contains('dragging')) return;
        window.handleDrillClick(key, btn);
    };

    let pressTimer;
    let startX = 0, startY = 0;
    
    const start = (e) => {
        if (e.target.closest('.drill-grab-handle')) return;
        if(btn.classList.contains('running')) return;
        
        if (e.type === 'touchstart') {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        } else {
            startX = e.clientX;
            startY = e.clientY;
        }

        pressTimer = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            openEditor(key);
        }, 600);
    };

    const cancel = () => clearTimeout(pressTimer);

    const move = (e) => {
        if (!pressTimer) return;

        let curX, curY;
        if (e.type === 'touchmove') {
            curX = e.touches[0].clientX;
            curY = e.touches[0].clientY;
        } else {
            curX = e.clientX;
            curY = e.clientY;
        }

        const diffX = Math.abs(curX - startX);
        const diffY = Math.abs(curY - startY);

        if (diffX > 10 || diffY > 10) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };
    
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mousemove', move);
    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', cancel);

    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('touchmove', move, { passive: true });
    btn.addEventListener('touchend', cancel);
    btn.addEventListener('touchcancel', cancel);

    container.appendChild(btn);
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
    const btns = document.querySelectorAll('.btn-drill');
    btns.forEach(b => {
         b.style.opacity = bleState.isConnected ? "1" : "0.6";
    });

    const btnConnect = document.getElementById('btn-connect');
    const statusText = document.getElementById('status-text');

    if (btnConnect && statusText) {
        btnConnect.classList.toggle('connecting', bleState.isConnecting);
        btnConnect.disabled = bleState.isConnecting;

        if (bleState.isConnected) {
            btnConnect.textContent = t('action.disconnect');
            btnConnect.classList.add('connected');
            statusText.textContent = t('status.connected');
            statusText.style.color = "var(--primary)";
        } else if (bleState.isConnecting) {
            // Previously the button did not change at all during the whole
            // attempt, so a connection that hung looked like no-op.
            btnConnect.textContent = t('status.connecting');
            btnConnect.classList.remove('connected');
            statusText.textContent = bleState.statusText || t('status.connecting');
            statusText.style.color = "var(--primary)";
        } else if (bleState.phase === 'error') {
            btnConnect.textContent = t('action.retry');
            btnConnect.classList.remove('connected');
            statusText.textContent = bleState.statusText || t('status.failed');
            statusText.style.color = "var(--danger)";
        } else {
            btnConnect.textContent = t('action.connect');
            btnConnect.classList.remove('connected');
            statusText.textContent = t('status.disconnected');
            statusText.style.color = "var(--text-light)";
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
    const tabs = ['basic','combined','complex','custom-a','custom-b','custom-c'];
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
        diffGroup.style.display = ['custom-a', 'custom-b', 'custom-c'].includes(catName) ? 'none' : 'flex';
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

window.closeSummaryModal = () => {
    const modal = document.getElementById('summary-modal');
    if(modal) modal.classList.remove('open');
};