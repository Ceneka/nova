import { B, LIMITS, freqToBpm, maxSpinFor, maxScatterFor, normalizeSpin } from './ball.js';
import {
    MAX_STEPS_PER_DRILL, getPresets, getPresetById, addPreset, updatePreset, deletePreset,
    resetPresetsToDefaults, normalizePreset, presetBallCount, standardPlacements, standardDepths,
    serializePresetsToJSON, serializePresetsToCSV, parsePresetsAuto, mergePresets, describePreset
} from './presets.js';
import { showToast, clamp } from './utils.js';

// Stroke-based, never fill-based: a filled multi-subpath icon renders as a
// solid blob under the default nonzero fill rule, which is how the original
// delete glyph ended up unreadable.
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3.5 6h17"></path>' +
    '<path d="M8.7 6V4.3A1.3 1.3 0 0 1 10 3h4a1.3 1.3 0 0 1 1.3 1.3V6"></path>' +
    '<path d="M18.4 6l-.85 13.1a2 2 0 0 1-2 1.9H8.45a2 2 0 0 1-2-1.9L5.6 6"></path>' +
    '<path d="M10 10.5v6"></path><path d="M14 10.5v6"></path>' +
    '</svg>';

const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';

/**
 * How much room is left in the drill currently open behind the sheet.
 * Kept in sync by the 'drill-editor-state' event that editor.js dispatches, so
 * this module never has to import the editor (and the editor never has to
 * know the preset library exists).
 */
let drillCtx = { open: false, steps: 0, max: MAX_STEPS_PER_DRILL };

document.addEventListener('drill-editor-state', (e) => {
    drillCtx = { ...drillCtx, ...e.detail };
    if (sheetOpen) renderPresetSheet();
});

// --- PICKER SHEET -----------------------------------------------------------

let sheetOpen = false;

export function openPresetSheet() {
    sheetOpen = true;
    renderPresetSheet();
    document.getElementById('preset-sheet')?.classList.add('open');
}

export function closePresetSheet() {
    sheetOpen = false;
    document.getElementById('preset-sheet')?.classList.remove('open');
}

function roomLeft() {
    if (!drillCtx.open) return 0;
    return Math.max(0, drillCtx.max - drillCtx.steps);
}

function renderPresetSheet() {
    const list = document.getElementById('preset-list');
    if (!list) return;

    const all = getPresets();
    const free = roomLeft();
    const canAdd = drillCtx.open && free > 0;

    if (!all.length) {
        list.innerHTML = `<div class="preset-empty">
            No presets yet.<br>
            Create one here, or save any ball from the drill editor as a preset.
        </div>`;
        return;
    }

    list.innerHTML = all.map(p => {
        const count = presetBallCount(p);
        const needs = count;

        const chips = [];
        if (p.placements.length) {
            chips.push(`<span class="preset-chip preset-chip-axis">Placement</span>` +
                p.placements.map(pl => `<span class="preset-chip placement">${esc(pl.label)} <b>${pl.drop}</b></span>`).join(''));
        }
        if (p.depths.length) {
            chips.push(`<span class="preset-chip preset-chip-axis">Depth</span>` +
                p.depths.map(d => `<span class="preset-chip">${esc(d.label)} <b>${d.height}</b></span>`).join(''));
        }

        const full = canAdd && free < needs;
        const dis = canAdd ? '' : 'disabled';
        const title = !drillCtx.open ? 'Open a drill to add presets'
            : free <= 0 ? `Drill is full (${drillCtx.max} balls)`
            : full ? `Only ${free} ball${free === 1 ? '' : 's'} left in this drill` : '';

        return `
        <div class="preset-card">
            <div class="preset-card-top">
                <div style="flex:1; min-width:0;">
                    <div class="preset-name">${esc(p.name)}</div>
                    <div class="preset-sub">${esc(describePreset(p))} &middot; ${count} ball${count === 1 ? '' : 's'}</div>
                </div>
                <button class="preset-edit-btn" onclick="window.openPresetEditor('${p.id}')" title="Edit preset">${ICON_EDIT}</button>
            </div>
            ${chips.length ? `<div class="preset-chips">${chips.join('')}</div>` : ''}
            <div class="preset-actions">
                <button class="btn-preset-add" ${dis} title="${esc(title)}" onclick="window.handleInsertPreset('${p.id}','single')">+ Ball</button>
                <button class="btn-preset-add" ${dis} title="${esc(title)}" onclick="window.handleInsertPreset('${p.id}','variants')">Variants</button>
                <button class="btn-preset-add solid" ${dis} title="${esc(title)}" onclick="window.handleInsertPreset('${p.id}','sequence')">Sequence</button>
            </div>
        </div>`;
    }).join('');
}

// --- PRESET EDITOR ----------------------------------------------------------

let working = null;   // working copy being edited
let isNew = false;

function blankPreset() {
    return normalizePreset({
        id: '',
        name: 'New preset',
        speed: 4, spin: 1.5, type: 'top',
        height: 50, drop: 0, bpm: 60, reps: 1, scatter: 0,
        placements: standardPlacements(0),
        depths: []
    });
}

/**
 * @param {string|null} presetId  null starts a new preset
 * @param {number[]|null} seedBall a ball array to copy the values from
 */
export function openPresetEditor(presetId, seedBall) {
    const titleEl = document.getElementById('preset-modal-title');
    const delBtn = document.querySelector('.btn-delete-preset');

    if (presetId) {
        const found = getPresetById(presetId);
        if (!found) { showToast("Preset not found"); return; }
        working = JSON.parse(JSON.stringify(found));
        isNew = false;
        if (titleEl) titleEl.textContent = 'Edit Preset';
    } else {
        working = seedBall ? seedFromBall(seedBall) : blankPreset();
        isNew = true;
        if (titleEl) titleEl.textContent = 'New Preset';
    }

    if (delBtn) delBtn.hidden = isNew;
    renderPresetForm();
    document.getElementById('preset-modal')?.classList.add('open');
    setTimeout(() => {
        const nameInput = document.getElementById('pf-name');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }, 100);
}

function seedFromBall(ball) {
    return normalizePreset({
        id: '',
        name: 'New preset',
        speed: ball[B.SPEED] ?? 5,
        spin: ball[B.SPIN] ?? 0,
        type: ball[B.TYPE] ?? 'top',
        height: ball[B.HEIGHT],
        drop: ball[B.DROP],
        bpm: freqToBpm(ball[B.FREQ]),
        reps: ball[B.REPS],
        scatter: ball[B.SCATTER] ?? 0,
        placements: [],
        depths: []
    });
}

export function closePresetEditor() {
    document.getElementById('preset-modal')?.classList.remove('open');
    working = null;
}

export function savePresetEditor() {
    if (!working) return;

    const name = (document.getElementById('pf-name')?.value || '').trim();
    if (!name) { showToast("Give the preset a name"); return; }
    if (name.length > 30) { showToast("Name too long (max 30)"); return; }

    working.name = name;

    if (isNew) addPreset(working);
    else updatePreset(working.id, working);

    closePresetEditor();
    document.dispatchEvent(new CustomEvent('presets-updated'));
    showToast(`Preset "${name}" saved`);
}

function renderPresetForm() {
    const body = document.getElementById('preset-editor-body');
    if (!body || !working) return;

    const p = working;
    const maxSpin = maxSpinFor(p.speed);
    const spinStyle = p.type === 'back' ? 'background:var(--danger); color:#fff; border-radius:4px;' : '';
    const scatterMax = maxScatterFor(p.drop);

    const axisRows = (items, axis) => items.map((it, i) => `
        <div class="axis-row">
            <input class="axis-label-input" type="text" maxlength="12" placeholder="Label" value="${esc(it.label)}"
                   oninput="window.handlePresetAxisInput(${i}, '${axis}', 'label', this.value)">
            <input class="axis-value-input" type="number" inputmode="decimal" step="0.5"
                   min="${axis === 'placement' ? -10 : -50}" max="${axis === 'placement' ? 10 : 100}"
                   value="${axis === 'placement' ? it.drop : it.height}"
                   onchange="window.handlePresetAxisInput(${i}, '${axis}', 'value', this.value)">
            <button class="axis-del-btn" onclick="window.handlePresetAxisRemove(${i}, '${axis}')" title="Remove">${ICON_TRASH}</button>
        </div>`).join('');

    body.innerHTML = `
        <input class="preset-name-input" type="text" id="pf-name" maxlength="30" placeholder="Preset name" value="${esc(p.name)}"
               oninput="window.handlePresetName(this.value)">

        <div class="spin-row">
            <span class="spin-label">Rotation:</span>
            <div class="spin-capsule">
                <div class="sc-opt ${p.type === 'top' ? 'active' : ''}" style="${p.type === 'top' ? 'background:#0984e3' : ''}"
                     onclick="window.handlePresetType('top')">TOP</div>
                <div class="sc-opt ${p.type === 'back' ? 'active' : ''}" style="${p.type === 'back' ? 'background:var(--danger)' : ''}"
                     onclick="window.handlePresetType('back')">BACK</div>
            </div>
        </div>

        <div class="editor-grid">
            <div class="editor-field">
                <div class="field-header"><label>Speed</label><span class="range-hint">0-10</span></div>
                <input type="number" inputmode="decimal" value="${p.speed}" step="0.5" min="0" max="10"
                    onchange="window.handlePresetField('speed', this.value)">
            </div>
            <div class="editor-field">
                <div class="field-header"><label>Spin</label><span class="range-hint" id="pf-spin-max">Max ${maxSpin}</span></div>
                <input type="number" inputmode="decimal" id="pf-spin" value="${p.spin}" step="0.5" min="0" max="${maxSpin}"
                    style="${spinStyle}" onchange="window.handlePresetField('spin', this.value)">
            </div>
            <div class="editor-field">
                <div class="field-header"><label>Height</label><span class="range-hint">-50/100</span></div>
                <input type="number" inputmode="decimal" id="pf-height" value="${p.height}" step="1" min="-50" max="100"
                    onchange="window.handlePresetField('height', this.value)">
            </div>
        </div>

        <div class="editor-grid">
            <div class="editor-field">
                <div class="field-header"><label>Drop</label><span class="range-hint">L/R</span></div>
                <input type="number" inputmode="decimal" value="${p.drop}" step="0.5" min="-10" max="10"
                    onchange="window.handlePresetField('drop', this.value)">
            </div>
            <div class="editor-field">
                <div class="field-header"><label>BPM</label><span class="range-hint">30-90</span></div>
                <input type="number" inputmode="decimal" value="${p.bpm}" step="1" min="30" max="90"
                    onchange="window.handlePresetField('bpm', this.value)">
            </div>
            <div class="editor-field">
                <div class="field-header"><label>Reps</label><span class="range-hint">#</span></div>
                <input type="number" inputmode="decimal" value="${p.reps}" step="1" min="1" max="200"
                    onchange="window.handlePresetField('reps', this.value)">
            </div>
        </div>

        <div class="editor-field" style="margin-bottom:10px;">
            <div class="field-header"><label>Scatter</label><span class="range-hint" id="pf-scatter-max">Max ${scatterMax}</span></div>
            <input type="number" inputmode="decimal" id="pf-scatter" value="${p.scatter}" step="0.5" min="0" max="${scatterMax}"
                onchange="window.handlePresetField('scatter', this.value)">
        </div>

        <div class="axis-block">
            <div class="axis-head"><span class="axis-title">Placement (Drop L/R)</span></div>
            <div class="axis-hint">Sideways target. Named from the receiver's view, right-handed:
                backhand is a negative drop, forehand positive.</div>
            ${axisRows(p.placements, 'placement')}
            <button class="btn-axis-add" onclick="window.handlePresetAxisAdd('placement')">+ Add placement</button>
            <button class="axis-standard-btn" onclick="window.handlePresetAxisStandard('placement')">Use BH / Center / FH</button>
        </div>

        <div class="axis-block">
            <div class="axis-head"><span class="axis-title">Depth (Height)</span></div>
            <div class="axis-hint">How far the ball carries. Use this to go short / mid / long off the same serve.</div>
            ${axisRows(p.depths, 'depth')}
            <button class="btn-axis-add" onclick="window.handlePresetAxisAdd('depth')">+ Add depth</button>
            <button class="axis-standard-btn" onclick="window.handlePresetAxisStandard('depth')">Use Short / Mid / Long</button>
        </div>

        <div class="preset-sub" style="text-align:center; margin-top:2px;" id="pf-summary"></div>
    `;

    updatePresetSummary();
}

function updatePresetSummary() {
    const el = document.getElementById('pf-summary');
    if (!el || !working) return;
    const count = presetBallCount(working);
    el.textContent = count === 1
        ? 'Adds 1 ball'
        : `Adds ${count} balls (${working.placements.length || 1} placement${working.placements.length === 1 ? '' : 's'} x ${working.depths.length || 1} depth${working.depths.length === 1 ? '' : 's'})`;
}

const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// --- PRESET EDITOR HANDLERS (exposed on window for the inline handlers) ------

export function handlePresetField(field, value) {
    if (!working) return;

    if (field === 'speed') {
        working.speed = clamp(toNum(value), ...LIMITS.speed);
        const max = maxSpinFor(working.speed);
        working.spin = normalizeSpin(working.speed, working.spin);
        const spinInput = document.getElementById('pf-spin');
        if (spinInput) { spinInput.max = max; spinInput.value = working.spin; }
        const spinMax = document.getElementById('pf-spin-max');
        if (spinMax) spinMax.textContent = `Max ${max}`;
    } else if (field === 'spin') {
        working.spin = normalizeSpin(working.speed, toNum(value));
        const spinInput = document.getElementById('pf-spin');
        if (spinInput) spinInput.value = working.spin;
    } else if (field === 'drop') {
        working.drop = clamp(toNum(value), ...LIMITS.drop);
        // Scatter and the drop point share the table, so re-clamp both.
        const max = maxScatterFor(working.drop);
        working.scatter = clamp(working.scatter, 0, max);
        const scatterInput = document.getElementById('pf-scatter');
        if (scatterInput) { scatterInput.max = max; scatterInput.value = working.scatter; }
        const scatterMax = document.getElementById('pf-scatter-max');
        if (scatterMax) scatterMax.textContent = `Max ${max}`;
    } else if (field === 'scatter') {
        working.scatter = clamp(toNum(value), 0, maxScatterFor(working.drop));
        const scatterInput = document.getElementById('pf-scatter');
        if (scatterInput) scatterInput.value = working.scatter;
    } else if (field === 'height') {
        working.height = clamp(toNum(value), ...LIMITS.height);
    } else if (field === 'bpm') {
        working.bpm = clamp(toNum(value), ...LIMITS.bpm);
    } else if (field === 'reps') {
        working.reps = clamp(toNum(value), ...LIMITS.reps);
    } else {
        return;
    }

    updatePresetSummary();
}

export function handlePresetName(value) {
    // Kept in the model on every keystroke: any structural change (adding an
    // axis row, switching rotation) re-renders this form, and an unbound
    // input would be reset to whatever the model last held.
    if (!working) return;
    working.name = value.slice(0, 30);
}

export function handlePresetType(type) {
    if (!working || working.type === type) return;
    working.type = type;
    renderPresetForm();
}

export function handlePresetAxisAdd(axis) {
    if (!working) return;
    const list = axis === 'placement' ? working.placements : working.depths;
    if (list.length >= 6) { showToast("Max 6 per axis"); return; }

    list.push(axis === 'placement'
        ? { label: `Spot ${list.length + 1}`, drop: clamp(working.drop + (list.length - 1) * 2.5, -10, 10) }
        : { label: `Depth ${list.length + 1}`, height: clamp(working.height, -50, 100) });
    renderPresetForm();
}

export function handlePresetAxisRemove(index, axis) {
    if (!working) return;
    const list = axis === 'placement' ? working.placements : working.depths;
    if (!list[index]) return;
    list.splice(index, 1);
    renderPresetForm();
}

export function handlePresetAxisStandard(axis) {
    if (!working) return;
    if (axis === 'placement') working.placements = standardPlacements(working.drop);
    else working.depths = standardDepths(working.height);
    renderPresetForm();
}

export function handlePresetAxisInput(index, axis, field, value) {
    if (!working) return;
    const list = axis === 'placement' ? working.placements : working.depths;
    const item = list[index];
    if (!item) return;

    if (field === 'label') item.label = value.slice(0, 12);
    else {
        if (axis === 'placement') item.drop = clamp(toNum(value), -10, 10);
        else item.height = clamp(toNum(value), -50, 100);
    }
}

export function deleteEditingPreset() {
    if (!working || isNew) return;
    if (!confirm(`Delete the preset "${working.name}"?`)) return;

    const name = working.name;
    deletePreset(working.id);
    closePresetEditor();
    document.dispatchEvent(new CustomEvent('presets-updated'));
    showToast(`"${name}" deleted`);
}

// --- FILE TRANSFER ----------------------------------------------------------

function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

export function exportPresetsJSON() {
    download('nova_ball_presets.json', serializePresetsToJSON(), 'application/json;charset=utf-8;');
    closeMenu();
    showToast("Presets exported");
}

export function exportPresetsCSV() {
    download('nova_ball_presets.csv', serializePresetsToCSV(), 'text/csv;charset=utf-8;');
    closeMenu();
    showToast("Presets exported");
}

export function handlePresetFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const incoming = parsePresetsAuto(e.target.result);
            if (!incoming.length) { showToast("No presets found in file"); return; }

            const { added, updated } = mergePresets(incoming);
            document.dispatchEvent(new CustomEvent('presets-updated'));
            showToast(added || updated
                ? `Imported ${added} new, ${updated} updated`
                : "Nothing new to import");
        } catch (err) {
            console.error(err);
            showToast("Import failed");
        }
    };
    reader.readAsText(file);
    event.target.value = '';
    closeMenu();
}

export function handleResetPresets() {
    if (!confirm("Replace the preset library with the shipped defaults? Presets already used in drills are not affected.")) return;
    resetPresetsToDefaults();
    document.dispatchEvent(new CustomEvent('presets-updated'));
    showToast("Presets reset to defaults");
    closeMenu();
}

function closeMenu() {
    document.getElementById('theme-menu')?.classList.remove('open');
}

// --- WINDOW BINDINGS -------------------------------------------------------
// The drill editor talks to this module through CustomEvents (preset-insert)
// so neither module has to import the other.

export function requestInsert(presetId, mode) {
    document.dispatchEvent(new CustomEvent('preset-insert', { detail: { presetId, mode } }));
}

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

window.openPresetSheet = openPresetSheet;
window.closePresetSheet = closePresetSheet;
window.openPresetEditor = openPresetEditor;
window.closePresetEditor = closePresetEditor;
window.savePresetEditor = savePresetEditor;
window.deleteEditingPreset = deleteEditingPreset;
window.handlePresetField = handlePresetField;
window.handlePresetName = handlePresetName;
window.handlePresetType = handlePresetType;
window.handlePresetAxisAdd = handlePresetAxisAdd;
window.handlePresetAxisRemove = handlePresetAxisRemove;
window.handlePresetAxisStandard = handlePresetAxisStandard;
window.handlePresetAxisInput = handlePresetAxisInput;
window.handlePresetFileUpload = handlePresetFileUpload;
window.handleResetPresets = handleResetPresets;
window.handleInsertPreset = requestInsert;
window.exportPresetsJSON = exportPresetsJSON;
window.exportPresetsCSV = exportPresetsCSV;
