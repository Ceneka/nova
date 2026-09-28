import { currentDrills, userCustomDrills, selectedLevel, saveDrillsToStorage } from './state.js';
import {
    B, LIMITS, calculateRPMs, reverseCalculate, makeBall, normalizeBall,
    bpmToFreq, freqToBpm, maxSpinFor, maxScatterFor, isMultiVariant
} from './ball.js';
import { MAX_STEPS_PER_DRILL, getPresetById, buildVariantStep, buildSequenceSteps, buildSingleBall } from './presets.js';
import { sendPacket, packBall, bleState } from './bluetooth.js';
import { showToast, clamp, toggleBodyScroll } from './utils.js';
import { t, drillDisplayName } from './i18n.js';
import { uploadDrill } from './cloud.js';

// --- Local State ---
let tempDrillData = null;
let editingDrillKey = null;
let selectedSaveCat = 'custom-a'; 

// --- Public Module Functions ---

export function openEditor(key) {
    editingDrillKey = key;
    updateTitleDisplay(key);

    const chk = document.getElementById('chk-drill-random');
    if (chk) chk.checked = !!(currentDrills[key] && currentDrills[key].random);

    if (currentDrills[key] && currentDrills[key][selectedLevel]) {
        tempDrillData = JSON.parse(JSON.stringify(currentDrills[key][selectedLevel]));
    } else {
        tempDrillData = [[makeBall({ speed: 5, spin: 2, type: 'top', height: 50, drop: 0, bpm: 60, reps: 1 })]];
    }

    renderEditor();

    const btnDel = document.querySelector('.btn-delete-drill');
    if(btnDel) {
        btnDel.disabled = !key.startsWith('cust_');
        btnDel.style.opacity = key.startsWith('cust_') ? '1' : '0.5';
    }

    document.getElementById('editor-modal').classList.add('open');
    toggleBodyScroll(true);
}

export function closeEditor() {
    document.getElementById('editor-modal').classList.remove('open');
    editingDrillKey = null;
    tempDrillData = null;
    syncDrillContext();
    toggleBodyScroll(false);
}

export function saveDrillChanges() {
    if (!editingDrillKey || !tempDrillData) return;

    const chk = document.getElementById('chk-drill-random');
    if (chk) currentDrills[editingDrillKey].random = chk.checked;

    tempDrillData.forEach(step => {
        step.forEach(ball => normalizeBall(ball));
    });

    currentDrills[editingDrillKey][selectedLevel] = tempDrillData;
    saveDrillsToStorage();

    closeEditor();
    showToast(t('toast.configSaved'));
    document.dispatchEvent(new CustomEvent('drills-updated'));
}

// --- CORE PHYSICS LOGIC ---
// calculateRPMs / reverseCalculate now live in js/ball.js so the preset engine
// and the CSV exporter all use one implementation.

function syncDrillContext() {
    document.dispatchEvent(new CustomEvent('drill-editor-state', {
        detail: {
            open: !!tempDrillData,
            steps: tempDrillData ? tempDrillData.length : 0,
            max: MAX_STEPS_PER_DRILL
        }
    }));
}

document.addEventListener('preset-insert', (e) => {
    const { presetId, mode } = e.detail || {};
    insertPresetIntoDrill(presetId, mode);
});

/**
 * Append a preset to the drill being edited.
 * mode: 'single'   one ball, exactly as stored in the preset
 *       'variants' one step holding every placement x depth combination,
 *                  so the runner picks one at random on each repetition
 *       'sequence' one step per combination, in order
 * Returns the number of steps added, or -1 if nothing was added.
 */
export function insertPresetIntoDrill(presetId, mode = 'single') {
    if (!tempDrillData) { showToast(t('toast.openDrillFirst')); return -1; }

    const preset = getPresetById(presetId);
    if (!preset) { showToast(t('toast.presetNotFound')); return -1; }

    let steps;
    if (mode === 'variants') steps = [buildVariantStep(preset)];
    else if (mode === 'sequence') steps = buildSequenceSteps(preset);
    else steps = [[buildSingleBall(preset)]];

    const room = MAX_STEPS_PER_DRILL - tempDrillData.length;
    if (steps.length > room) {
        showToast(room <= 0
            ? t('toast.drillFull', { max: MAX_STEPS_PER_DRILL })
            : t('toast.onlyLeft', { n: room }));
        return -1;
    }

    steps.forEach(step => tempDrillData.push(step));

    renderEditor();
    showToast(t('toast.ballsAdded', { n: steps.length, name: preset.name }));
    return steps.length;
}

// --- RENDER EDITOR ---

function renderEditor() {
    const modalBody = document.getElementById('editor-body');
    modalBody.innerHTML = '';
    
    // Hide "Shuffle balls" toggle if drill has only 1 step
    const shuffleContainer = document.querySelector('.random-toggle-container');
    if (shuffleContainer) {
        shuffleContainer.style.display = (tempDrillData && tempDrillData.length > 1) ? 'flex' : 'none';
    }

    const isConnected = bleState.isConnected;
    syncDrillContext();

    // The first thing in the editor, so the preset route is unmissable. The
    // "+" at the bottom of the list only duplicates the previous ball - which
    // is exactly what someone reaches for when they want to add a ball. The
    // same button is repeated at the end of the list, not instead of this one.
    const entry = document.createElement('button');
    entry.className = 'preset-entry';
    entry.onclick = () => window.openPresetSheet();
    entry.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z"></path>
        </svg>
        <span>${t('editor.addFromPreset')}</span>`;
    modalBody.appendChild(entry);

    tempDrillData.forEach((stepOptions, stepIndex) => {
        const isActive = stepOptions[0][6] === undefined ? 1 : stepOptions[0][6];

        if (stepIndex > 0) {
            const swapDiv = document.createElement('div');
            swapDiv.className = 'swap-zone';
            swapDiv.innerHTML = `<button class="btn-swap" onclick="window.handleSwapSteps(${stepIndex - 1}, ${stepIndex})">⇅</button>`;
            modalBody.appendChild(swapDiv);
        }

        const groupDiv = document.createElement('div');
        groupDiv.className = `ball-group ${isActive ? '' : 'inactive'}`;
        
        const isSingle = stepOptions.length === 1;
        
        // --- SCATTER LOGIC ---
        const currentDrop = stepOptions[0][3];
        const currentScatter = stepOptions[0][10] || 0;
        const maxScatter = maxScatterFor(currentDrop);

        const scatterHtml = isSingle ? `
            <div style="display:flex; align-items:center; gap:5px; margin-left:auto; margin-right:10px;">
                <div class="editor-field" style="flex-direction:row; align-items:center; gap:6px; padding:2px 6px; background:var(--bg); border:1px solid var(--border);">
                    <label style="font-size:0.6rem; color:var(--text-light); font-weight:800; text-transform:uppercase;">${t('field.scatter')}</label>
                    <input type="number" inputmode="decimal" 
                           value="${currentScatter}" 
                           step="0.5" min="0" max="${maxScatter}"
                           style="width:40px; text-align:center; font-weight:bold; color:var(--primary); font-size:0.9rem;"
                           onchange="window.handleScatterChange(${stepIndex}, this.value)">
                </div>
            </div>` : '';

        // Duplicate/Next Step Button (Header)
        const plusBtn = `
            <button class="btn-add-opt" title="${t('editor.duplicateBall')}" onclick="window.handleAddSequenceStep(${stepIndex})">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>`;

        groupDiv.innerHTML = `
            <div class="group-title">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <span>${t('editor.ball', { n: stepIndex + 1 })}</span>
                    <div class="ball-toggle ${isActive ? 'active' : ''}" onclick="window.handleToggleBallActive(${stepIndex})">
                        <div class="toggle-switch"></div>
                    </div>
                    ${scatterHtml}
                </div>
                ${plusBtn}
            </div>`;

        stepOptions.forEach((ballParams, optIndex) => {
            if (ballParams[B.SPEED] === undefined) {
                const rev = reverseCalculate(ballParams[B.TOP], ballParams[B.BOT]);
                ballParams[B.SPEED] = clamp(rev.speed, 0, 10);
                ballParams[B.SPIN] = clamp(rev.spin, 0, 10);
                ballParams[B.TYPE] = rev.type;
            }

            const speed = ballParams[B.SPEED];
            const spin = ballParams[B.SPIN];
            const type = ballParams[B.TYPE];
            const currentMaxSpin = maxSpinFor(speed);

            // --- UPDATED: Backspin Visual Logic (Red Input Field) ---
            const spinStyle = type === 'back' ? 'background:var(--danger); color:#fff; border-radius:4px;' : '';
            // -------------------------------------

            const bpmValue = freqToBpm(ballParams[B.FREQ]);

            const optDiv = document.createElement('div');
            optDiv.className = 'option-card';

            // --- UPDATED: Swap Colors for Top/Back Toggle (Top=Blue, Back=Red) ---
            const toggleHtml = `
                <div class="spin-row">
                    <span class="spin-label">${t('editor.rotation')}</span>
                    <div class="spin-capsule">
                        <div class="sc-opt ${type === 'top' ? 'active' : ''}" 
                             style="${type === 'top' ? 'background:#0984e3' : ''}"
                             onclick="window.handleTypeToggle(${stepIndex}, ${optIndex}, 'top')">${t('unit.top')}</div>
                        <div class="sc-opt ${type === 'back' ? 'active' : ''}" 
                             style="${type === 'back' ? 'background:var(--danger)' : ''}"
                             onclick="window.handleTypeToggle(${stepIndex}, ${optIndex}, 'back')">${t('unit.back')}</div>
                    </div>
                </div>`;
            // ---------------------------------------------------------------------

            // NOTE: 'Drop' and 'Speed' use onchange to prevent re-rendering while typing negative numbers or clearing input
            const inputsHtml = `
                <div class="editor-grid">
                    <div class="editor-field">
                        <div class="field-header"><label>${t('field.speed')}</label><span class="range-hint">0-10</span></div>
                        <input type="number" inputmode="decimal" id="inp-speed-${stepIndex}-${optIndex}" value="${speed}" step="0.5" min="0" max="10"
                            onchange="window.handleEditorInput(${stepIndex}, ${optIndex}, ${B.SPEED}, this.value)">
                    </div>
                    <div class="editor-field">
                        <div class="field-header"><label>${t('field.spin')}</label><span class="range-hint" id="lbl-spin-${stepIndex}-${optIndex}">${t('unit.max', { n: currentMaxSpin })}</span></div>
                        <input type="number" inputmode="decimal" id="inp-spin-${stepIndex}-${optIndex}" value="${spin}" step="0.5" min="0" max="${currentMaxSpin}"
                            style="${spinStyle}"
                            oninput="window.handleEditorInput(${stepIndex}, ${optIndex}, ${B.SPIN}, this.value)">
                    </div>
                    <div class="editor-field">
                        <div class="field-header"><label>${t('field.height')}</label><span class="range-hint">-50/100</span></div>
                        <input type="number" inputmode="decimal" value="${ballParams[B.HEIGHT]}" step="1" min="-50" max="100"
                            oninput="window.handleEditorInput(${stepIndex}, ${optIndex}, ${B.HEIGHT}, this.value)">
                    </div>
                    <div class="editor-field">
                        <div class="field-header"><label>${t('field.drop')}</label><span class="range-hint">${t('field.dropHint')}</span></div>
                        <input type="number" inputmode="decimal" value="${ballParams[B.DROP]}" step="0.5" min="-10" max="10"
                            onchange="window.handleEditorInput(${stepIndex}, ${optIndex}, ${B.DROP}, this.value)">
                    </div>
                    <div class="editor-field">
                        <div class="field-header"><label>${t('field.bpm')}</label><span class="range-hint">30-90</span></div>
                        <input type="number" inputmode="decimal" value="${bpmValue}" step="1" min="30" max="90"
                            oninput="window.handleEditorInput(${stepIndex}, ${optIndex}, ${B.FREQ}, this.value)">
                    </div>
                    <div class="editor-field">
                        <div class="field-header"><label>${t('field.reps')}</label><span class="range-hint">#</span></div>
                        <input type="number" inputmode="decimal" value="${ballParams[B.REPS]}" step="1" min="1" max="200"
                            oninput="window.handleEditorInput(${stepIndex}, ${optIndex}, ${B.REPS}, this.value)">
                    </div>
                </div>`;

            const isLastBall = tempDrillData.length === 1 && stepOptions.length === 1;

            const actionsHtml = `
                <div class="card-actions">
                     <button class="btn-action btn-act-test"
                             onclick="window.handleTestBall(${stepIndex}, ${optIndex})"
                             ${isConnected && isActive ? '' : 'disabled'}>${t('action.test')}</button>
                     <button class="btn-action btn-act-clone"
                             onclick="window.handleAddVariant(${stepIndex}, ${optIndex})">${t('editor.addVariant')}</button>
                     <button class="btn-action btn-act-del"
                             onclick="window.handleDeleteBall(${stepIndex}, ${optIndex})"
                             ${isLastBall ? 'disabled' : ''}>${t('action.delete')}</button>
                     <button class="btn-action btn-act-preset" title="${t('editor.saveBallAsPreset')}"
                             onclick="window.handleSaveBallAsPreset(${stepIndex}, ${optIndex})">
                         <svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z"></path></svg>
                     </button>
                </div>
            `;
            
            const label = stepOptions.length > 1 ? `<span class="option-label">${t('editor.variant', { n: optIndex + 1 })}</span>` : '';
            optDiv.innerHTML = label + toggleHtml + inputsHtml + actionsHtml;
            groupDiv.appendChild(optDiv);
        });
        modalBody.appendChild(groupDiv);
    });

    // --- NEW: Add Button at Bottom of Sequence ---
    const addZone = document.createElement('div');
    addZone.className = 'swap-zone';
    addZone.style.margin = "-10px 0 6px 0";
    addZone.innerHTML = `
        <button class="btn-swap"
                style="color:var(--primary); border-color:var(--primary); width:32px; height:32px;"
                onclick="window.handleAddSequenceStep(${tempDrillData.length - 1})"
                title="${t('editor.duplicateLastBall')}">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        </button>`;
    modalBody.appendChild(addZone);

    // Sitting right under the "+", so "I want another ball" leads here too.
    // The "+" only duplicates the previous ball, which is not what people
    // reaching for it usually want. Same .preset-entry class as the top one:
    // identical action, identical styling.
    const bottomEntry = document.createElement('button');
    bottomEntry.className = 'preset-entry';
    bottomEntry.onclick = () => window.openPresetSheet();
    bottomEntry.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z"></path>
        </svg>
        <span>${t('editor.addFromPreset')}</span>`;
    modalBody.appendChild(bottomEntry);
}

// --- HANDLERS ---

// The editor is the one surface that stays open across a language change, so
// it redraws itself. `tempDrillData` is the same "is it open" signal
// closeEditor() already relies on; a closed editor has nothing to redraw and
// rebuilding it would throw away the user's scroll position for nothing.
document.addEventListener('locale-changed', () => {
    if (tempDrillData) renderEditor();
});

window.handleScatterChange = (stepIdx, value) => {
    if (!tempDrillData) return;
    const ball = tempDrillData[stepIdx][0]; // Scatter applies to the first ball (group level)

    let val = parseFloat(value);
    if(isNaN(val)) val = 0;

    const maxAllowed = maxScatterFor(ball[3]);
    if (val > maxAllowed) {
        val = maxAllowed;
        showToast(t('toast.scatterLimit', { n: val }));
    }

    ball[10] = clamp(val, 0, maxAllowed);
    renderEditor();
};

window.handleEditorInput = (stepIdx, optIdx, paramIdx, value) => {
    if (!tempDrillData) return;
    const ball = tempDrillData[stepIdx][optIdx];
    let val = parseFloat(value);
    if(isNaN(val)) val = 0;

    if (paramIdx === B.FREQ) {
        ball[paramIdx] = bpmToFreq(val);
    }
    else if (paramIdx === B.DROP) {
        ball[paramIdx] = clamp(val, -10, 10);

        // The drop point and the scatter share the same 20 units of table.
        const maxAllowed = maxScatterFor(ball[B.DROP]);
        if ((ball[B.SCATTER] || 0) > maxAllowed) ball[B.SCATTER] = maxAllowed;
        renderEditor();
        return;
    }
    else {
        ball[paramIdx] = val;
    }

    if (paramIdx === B.SPEED) {
        const maxAllowed = maxSpinFor(val);
        if (ball[B.SPIN] > maxAllowed) ball[B.SPIN] = maxAllowed;

        const spinInput = document.getElementById(`inp-spin-${stepIdx}-${optIdx}`);
        const spinLabel = document.getElementById(`lbl-spin-${stepIdx}-${optIdx}`);
        if (spinInput) { spinInput.max = maxAllowed; spinInput.value = ball[B.SPIN]; }
        if (spinLabel) spinLabel.textContent = t('unit.max', { n: maxAllowed });
    }

    if (paramIdx === B.SPEED || paramIdx === B.SPIN) {
        const res = calculateRPMs(ball[B.SPEED], ball[B.SPIN], ball[B.TYPE]);
        ball[B.TOP] = res.top; ball[B.BOT] = res.bot;
    }
};

/**
 * Open the preset editor pre-filled from a ball already in this drill, so a
 * ball you have tuned by hand can be promoted to a reusable recipe.
 */
window.handleSaveBallAsPreset = (stepIdx, optIdx) => {
    if (!tempDrillData || !tempDrillData[stepIdx] || !tempDrillData[stepIdx][optIdx]) return;

    const ball = tempDrillData[stepIdx][optIdx].slice();
    if (ball[B.SPEED] === undefined) {
        const rev = reverseCalculate(ball[B.TOP], ball[B.BOT]);
        ball[B.SPEED] = clamp(rev.speed, 0, 10);
        ball[B.SPIN] = clamp(rev.spin, 0, 10);
        ball[B.TYPE] = rev.type;
    }
    // Scatter only makes sense for a single-variant step, which a preset is.
    if (!isMultiVariant(tempDrillData[stepIdx])) ball[B.SCATTER] = ball[B.SCATTER] || 0;
    else ball[B.SCATTER] = 0;

    window.openPresetEditor(null, ball);
};

window.handleTypeToggle = (stepIdx, optIdx, newType) => {
    if (!tempDrillData) return;
    const ball = tempDrillData[stepIdx][optIdx];
    if(ball[B.TYPE] === newType) return;
    ball[B.TYPE] = newType;
    const res = calculateRPMs(ball[B.SPEED], ball[B.SPIN], ball[B.TYPE]);
    ball[B.TOP] = res.top; ball[B.BOT] = res.bot;
    renderEditor();
};

window.handleSwapSteps = (idxA, idxB) => {
    if (!tempDrillData) return;
    [tempDrillData[idxA], tempDrillData[idxB]] = [tempDrillData[idxB], tempDrillData[idxA]];
    renderEditor(); 
};

window.handleToggleBallActive = (stepIdx) => {
    if (!tempDrillData) return;
    const currentVal = tempDrillData[stepIdx][0][B.ACTIVE] === undefined ? 1 : tempDrillData[stepIdx][0][B.ACTIVE];
    tempDrillData[stepIdx].forEach(opt => opt[B.ACTIVE] = currentVal === 1 ? 0 : 1);
    renderEditor();
};

window.handleAddSequenceStep = (sourceStepIndex) => {
    const fullStepClone = JSON.parse(JSON.stringify(tempDrillData[sourceStepIndex]));
    tempDrillData.splice(sourceStepIndex + 1, 0, fullStepClone);
    renderEditor();
};

window.handleAddVariant = (stepIndex, sourceOptIndex) => {
    const baseConfig = JSON.parse(JSON.stringify(tempDrillData[stepIndex][sourceOptIndex]));
    tempDrillData[stepIndex].push(baseConfig);
    renderEditor();
};

window.handleDeleteBall = (stepIdx, optIdx) => {
    if (tempDrillData.length <= 1 && tempDrillData[0].length <= 1) {
        showToast(t('toast.cannotDeleteLastBall')); return;
    }
    tempDrillData[stepIdx].splice(optIdx, 1);
    if (tempDrillData[stepIdx].length === 0) tempDrillData.splice(stepIdx, 1);
    renderEditor();
};

window.handleSaveAsDrill = () => {
    selectedSaveCat = 'custom-a';
    const nameInput = document.getElementById('save-name');
    if (nameInput) nameInput.value = '';
    
    const switchEl = document.getElementById('save-cat-switch');
    if(switchEl) {
        Array.from(switchEl.children).forEach(c => c.classList.remove('active'));
        if(switchEl.children[0]) switchEl.children[0].classList.add('active');
    }

    document.getElementById('save-as-modal').classList.add('open');
    setTimeout(() => { if(nameInput) nameInput.focus(); }, 100);
};

window.closeSaveAsModal = () => {
    document.getElementById('save-as-modal').classList.remove('open');
};

window.selectSaveCategory = (val, btn) => {
    selectedSaveCat = val;
    const parent = btn.parentElement;
    Array.from(parent.children).forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
};

window.performSaveAs = () => {
    const newName = document.getElementById('save-name').value.trim();
    if(!newName) { showToast(t('toast.enterAName')); return; }
    if (newName.length > 40) { showToast(t('toast.nameTooLong')); return; }
    if (!/^[a-zA-Z0-9.\-#\[\]><\+\)\( ]+$/.test(newName)) { showToast(t('toast.invalidCharacters')); return; }

    const targetCat = selectedSaveCat;
    if (userCustomDrills[targetCat].length >= 100) { 
            showToast(t('toast.bankFullMax100')); return; 
    }

    const catChar = targetCat.split('-')[1].toUpperCase(); 
    const newKey = `cust_${catChar}_${newName.replace(/\s+/g, '_')}_${Date.now()}`;
    userCustomDrills[targetCat].push({ name: newName, key: newKey });

    let baseDrill = currentDrills[editingDrillKey] || { 1: [], 2: [], 3: [] }; 
    const newDrillData = JSON.parse(JSON.stringify(baseDrill));
    newDrillData[selectedLevel] = tempDrillData;
    
    const chk = document.getElementById('chk-drill-random');
    if (chk) newDrillData.random = chk.checked;

    currentDrills[newKey] = newDrillData;
    saveDrillsToStorage(); 
    localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));

    window.closeSaveAsModal();
    closeEditor();
    openEditor(newKey);
    document.dispatchEvent(new CustomEvent('drills-updated'));
    
    const tabBtn = document.querySelector(`.tab-btn[onclick*="${targetCat}"]`);
    if (tabBtn) switchTab(targetCat, tabBtn);
    showToast(t('toast.savedTo', { bank: catChar }));
};

window.handleDeleteDrill = () => {
    if (!editingDrillKey || !editingDrillKey.startsWith('cust_')) return;
    if (!confirm(t('confirm.deleteDrill'))) return;

    const parts = editingDrillKey.split('_');
    const catKey = `custom-${parts[1].toLowerCase()}`;
    if (userCustomDrills[catKey]) {
        userCustomDrills[catKey] = userCustomDrills[catKey].filter(d => d.key !== editingDrillKey);
    }

    delete currentDrills[editingDrillKey];
    saveDrillsToStorage();
    localStorage.setItem('custom_data', JSON.stringify(userCustomDrills));

    closeEditor();
    showToast(t('toast.drillDeleted'));
    document.dispatchEvent(new CustomEvent('drills-updated'));
};

window.handleRenameDrill = () => {
    if (!editingDrillKey || !editingDrillKey.startsWith('cust_')) return;
    
    const nameEl = document.getElementById('editor-drill-name');
    const currentName = nameEl ? nameEl.textContent : t('drill.newDrill');
    
    const newName = prompt(t('prompt.renameDrill'), currentName);
    if (!newName || newName === currentName) return;
    if (newName.length > 40) { showToast(t('toast.nameTooLong')); return; }

    const parts = editingDrillKey.split('_'); 
    const catChar = parts[1]; 
    const catListKey = `custom-${catChar.toLowerCase()}`;
    const newKey = `cust_${catChar}_${newName.replace(/\s+/g, '_')}_${Date.now()}`;
    
    const list = userCustomDrills[catListKey];
    const entry = list.find(d => d.key === editingDrillKey);
    
    if (entry) {
        entry.name = newName;
        entry.key = newKey;
        currentDrills[newKey] = currentDrills[editingDrillKey];
        delete currentDrills[editingDrillKey];

        editingDrillKey = newKey;
        localStorage.setItem('custom_data', JSON.stringify(userCustomDrills)); 
        saveDrillsToStorage(); 
        updateTitleDisplay(newKey);
        showToast(t('toast.renamed'));
        document.dispatchEvent(new CustomEvent('drills-updated'));
    }
};

function updateTitleDisplay(key) {
    let displayName = key;
    let isCustom = false;
    
    if (key.startsWith('cust_')) {
        isCustom = true;
        const parts = key.split('_');
        if (parts.length >= 3) {
           const catKey = `custom-${parts[1].toLowerCase()}`;
           const entry = userCustomDrills[catKey]?.find(d => d.key === key);
           displayName = entry ? entry.name : key.replace(/^cust_[A-C]_/, '');
        }
    } else {
        displayName = drillDisplayName(key);
    }
    
    const nameEl = document.getElementById('editor-drill-name');
    const iconEl = document.getElementById('editor-drill-edit-icon');
    const container = document.querySelector('#editor-modal .title-container');

    if(nameEl) nameEl.textContent = displayName;
    
    if(isCustom) {
        if(iconEl) iconEl.style.display = 'inline-block';
        if(container) {
            container.style.pointerEvents = 'auto';
            container.onclick = () => window.handleRenameDrill();
        }
    } else {
        if(iconEl) iconEl.style.display = 'none';
        if(container) {
            container.style.pointerEvents = 'none';
            container.onclick = null;
        }
    }
}

window.handleTestBall = async (stepIdx, optIdx) => {
    if (!bleState.isConnected) { showToast(t('toast.notConnected')); return; }
    const d = tempDrillData[stepIdx][optIdx];
    const ballData = packBall(d[0], d[1], d[2], d[3], d[4], 1); 
    const buffer = new ArrayBuffer(31); 
    const view = new DataView(buffer);
    view.setUint8(0, 0x81); view.setUint16(1, 28, true); 
    view.setUint8(3, 1);
    view.setUint16(4, 1, true); 
    view.setUint8(6, 0);
    new Uint8Array(buffer).set(ballData, 7);
    try { await sendPacket(new Uint8Array(buffer)); showToast(t('toast.testBallFired')); } 
    catch (e) { console.error(e); showToast(t('toast.testFailed')); }
};

window.handleTestCombo = async () => {
    if (!bleState.isConnected) { showToast(t('toast.notConnected')); return; }
    if (!tempDrillData || tempDrillData.length === 0) return;
    const balls = [];
    tempDrillData.forEach(stepOptions => {
        if (stepOptions[0][6] === 0) return;
        const chosen = stepOptions[0]; 
        const d = [...chosen];
        
        // --- SCATTER LOGIC FOR TEST COMBO ---
        const scatter = d[10] || 0;
        if (scatter > 0) {
            const currentDrop = d[3];
            const minDrop = currentDrop - scatter;
            const maxDrop = currentDrop + scatter;
            const span = maxDrop - minDrop;
            const steps = Math.floor(span / 0.5);
            if (steps > 0) {
                 const randomStep = Math.floor(Math.random() * (steps + 1));
                 d[3] = clamp(minDrop + (randomStep * 0.5), -10, 10);
            }
        }
        
        balls.push(packBall(d[0], d[1], d[2], d[3], d[4], 1));
    });
    if (balls.length === 0) { showToast(t('toast.noActiveBalls')); return; }
    const totalLen = 7 + (balls.length * 24);
    const buffer = new ArrayBuffer(totalLen);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);
    view.setUint8(0, 0x81); view.setUint16(1, 4 + (balls.length * 24), true); 
    view.setUint8(3, 1);
    view.setUint16(4, 1, true); 
    view.setUint8(6, 0);
    let offset = 7;
    balls.forEach(b => { uint8.set(b, offset); offset += 24; });
    try { await sendPacket(uint8); showToast(t('toast.testingDrill')); } 
    catch (e) { console.error(e); showToast(t('toast.testFailed')); }
};

window.handleShareDrill = async () => {
    if (!editingDrillKey || !tempDrillData) return;
    let drillName = t('drill.sharedDrill');
    const nameEl = document.getElementById('editor-drill-name');
    if(nameEl) drillName = nameEl.textContent;

    const payload = {
        name: drillName,
        level: selectedLevel,
        params: tempDrillData,
        random: document.getElementById('chk-drill-random')?.checked || false
    };

    const btn = document.querySelector('.btn-header-share');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<span style="font-size:10px">...</span>'; 
    btn.disabled = true;

    try {
        const code = await uploadDrill(payload);
        if (navigator.clipboard && navigator.clipboard.writeText) {
             await navigator.clipboard.writeText(code);
             alert(t('alert.shareSuccess', { code }));
        } else {
             prompt(t('prompt.shareCopy'), code);
        }
    } catch (e) {
        console.error("Share Error:", e);
        showToast(t('toast.shareFailed'));
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};