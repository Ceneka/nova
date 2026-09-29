import { currentDrills, selectedLevel, runMode, appStats, setLastPlayed } from './state.js';
import { noteSessionDrill, noteSessionBalls } from './stats.js';
import { sendPacket, packBall, bleState } from './bluetooth.js';
import { log, showToast, clamp, toggleBodyScroll } from './utils.js';
import { t } from './i18n.js';
import { updateStatsUI, updateLastPlayedHighlight } from './ui.js';
import { B } from './ball.js';

let isRunning = false;
let isPaused = false;
let currentCount = 0;
let targetCount = 0;
let remainingTime = 0;

// Timers
let pauseTimer = null;
let countdownTimer = null;
let runTimer = null;
let startTimeout = null; // --- ADDED: Track the start delay

let activeDrillParams = null;
let activeDrillRandom = false;

/**
 * The name the training history files this run under, and the key the "last
 * played" highlight matches on. They are set together by startSequence() and
 * read by beginDrillExecution(), which is not given a drill name and cannot
 * see one - it used to reference a parameter that was not in its scope, which
 * is a ReferenceError in a module, on every single drill start.
 *
 * `label` may be a name that is not in `currentDrills` at all: the assistant
 * builds a drill in memory, and playing it is still training, so it is still
 * counted. `key` is only set for a drill the list can point at.
 */
let activeDrillName = null;

// UI Elements (Cached for performance)
const ui = {
    overlay: document.getElementById('run-overlay'),
    display: document.getElementById('run-display'),
    label: document.getElementById('run-label'),
    progress: document.getElementById('run-progress'),
    btnPause: document.getElementById('btn-pause')
};

/** True while a sequence is playing or counting down. */
export function isDrillRunning() {
    return isRunning || !!activeDrillParams;
}

/**
 * Play a sequence of steps that is not necessarily in `currentDrills` at all.
 *
 * The AI assistant composes a drill in memory and hands the steps straight
 * here, so this is the entry point it uses; `startDrillSequence` below is the
 * thin wrapper that looks a name up in the list and calls this. Everything
 * after the countdown - the packet builder, pause, stop, the counters - is
 * shared, so a draft behaves exactly like a saved drill.
 *
 * @param {Array<step>} steps        a drill level: an array of steps
 * @param {object}      [options]
 * @param {string|null} [options.label]  what to file this run under in the history
 * @param {string|null} [options.key]    a `currentDrills` key, for the last-played mark
 * @param {boolean}     [options.random] shuffle the step order every repetition
 */
export function startSequence(steps, { label = null, key = null, random = false } = {}) {
    // --- FILTER INACTIVE STEPS ---
    // Index 6 being undefined means "active", not "inactive" - see ball.js and
    // AGENTS.md. A step plays on the strength of its first ball, which is the
    // rule the drill list has always used.
    const executableSteps = (Array.isArray(steps) ? steps : []).filter(step => {
        if (!Array.isArray(step) || step.length === 0) return false;
        const isActive = step[0][B.ACTIVE];
        return isActive === undefined || isActive === 1;
    });

    if (executableSteps.length === 0) {
        showToast(t('toast.noActiveBallsToPlay'));
        document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));
        return false;
    }

    activeDrillParams = executableSteps;
    activeDrillRandom = !!random;
    activeDrillName = label;

    // --- NEW: SAVE LAST PLAYED STATE ---
    // Only a drill the list can point at gets the highlight. An in-memory draft
    // has no row to light up, and writing its name here would leave a key in
    // localStorage that resolves to nothing on the next load.
    if (key) {
        setLastPlayed(key);
        updateLastPlayedHighlight();
    }

    // --- LOCK SCROLL ON START ---
    toggleBodyScroll(true);
    ui.overlay.classList.add('open');

    let count = 4;
    ui.display.textContent = count;
    ui.label.textContent = t('run.getReady');
    ui.btnPause.style.display = 'none';

    ui.progress.style.transition = 'none';
    ui.progress.style.strokeDashoffset = '0';
    void ui.progress.offsetWidth;

    requestAnimationFrame(() => {
        ui.progress.style.transition = 'stroke-dashoffset 4s linear';
        ui.progress.style.strokeDashoffset = '565';
    });

    countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            ui.display.textContent = count;
        } else {
            clearInterval(countdownTimer);
            ui.display.textContent = t('run.go');
            // --- UPDATED: Store timeout to allow cancelling ---
            startTimeout = setTimeout(beginDrillExecution, 800);
        }
    }, 1000);

    return true;
}

/** Look a named drill up in the list and play the current level. */
export function startDrillSequence(drillName) {
    const rawParams = currentDrills[drillName] ? currentDrills[drillName][selectedLevel] : null;
    if (!rawParams) {
        log("Drill data not found: " + drillName);
        return false;
    }

    return startSequence(rawParams, {
        label: drillName,
        key: drillName,
        random: !!currentDrills[drillName].random
    });
}

export function beginDrillExecution() {
    isRunning = true;
    isPaused = false;
    
    // --- FIX: Increment Drill Count ONCE per session, not per rep ---
    appStats.drills += 1;
    localStorage.setItem('nova_stats', JSON.stringify(appStats));
    // ...and record it in the training history. `activeDrillName` is the
    // module-level name startSequence() set: this function is not passed one
    // and, being a module, cannot see a parameter of its caller's scope.
    noteSessionDrill(activeDrillName);
    updateStatsUI();
    // ---------------------------------------------------------------

    ui.btnPause.style.display = 'block';
    ui.btnPause.textContent = t('run.pause');
    ui.btnPause.classList.remove('pulse-anim');
    ui.label.textContent = t('run.remaining');

    ui.progress.style.transition = 'none';
    ui.progress.style.strokeDashoffset = '0';

    if (runMode === 'time') {
        const tVal = document.getElementById('input-time').value;
        remainingTime = parseInt(tVal);
        ui.display.textContent = formatTime(remainingTime);
        
        requestAnimationFrame(() => {
             if(isRunning && !isPaused) {
                 ui.progress.style.transition = `stroke-dashoffset ${remainingTime}s linear`;
                 ui.progress.style.strokeDashoffset = '565';
             }
        });

        runTimer = setInterval(() => {
            if (!isPaused) {
                remainingTime--;
                ui.display.textContent = formatTime(remainingTime);
                if (remainingTime <= 0) stopRun();
            }
        }, 1000);
    } else {
        targetCount = parseInt(document.getElementById('input-reps').value) || 1;
        currentCount = 0;
        ui.display.textContent = targetCount;
        ui.progress.style.transition = 'stroke-dashoffset 0.5s ease';
    }
    
    runIteration();
}

async function runIteration() {
    if(!isRunning || isPaused) return;

    if (runMode === 'reps') {
        const remaining = targetCount - currentCount;
        ui.display.textContent = remaining;
        
        const fractionCompleted = currentCount / targetCount;
        ui.progress.style.strokeDashoffset = 565 * fractionCompleted;
        currentCount++;
    }

    let sequence = activeDrillParams; 
    if (activeDrillRandom) {
        sequence = [...activeDrillParams]; 
        for (let i = sequence.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
        }
    }

    const balls = [];
    sequence.forEach((stepOptions, i) => {
        const chosenOption = stepOptions[Math.floor(Math.random() * stepOptions.length)];
        const tempBall = [...chosenOption];

        const scatter = tempBall[10] || 0;
        if (scatter > 0) {
            const currentDrop = tempBall[3];
            const minDrop = currentDrop - scatter;
            const maxDrop = currentDrop + scatter;
            const span = maxDrop - minDrop;
            const steps = Math.floor(span / 0.5);
            
            if (steps > 0) {
                const randomStep = Math.floor(Math.random() * (steps + 1));
                let newDrop = minDrop + (randomStep * 0.5);
                newDrop = clamp(newDrop, -10, 10);
                tempBall[3] = newDrop;
                log(`Scatter Active: Base ${currentDrop} ±${scatter} -> ${newDrop}`);
            }
        }

        log(`TX Ball ${i+1}: ${tempBall.join(' ')}`);
        balls.push(packBall(...tempBall));
    });

    // --- FIX: Only increment BALLS here ---
    appStats.balls += balls.length;
    localStorage.setItem('nova_stats', JSON.stringify(appStats));
    noteSessionBalls(balls.length); // ...and in the training history
    updateStatsUI();
    // --------------------------------------

    const packet = buildPacket(balls);
    await sendPacket(packet);
}

// Callback from bluetooth.js when robot finishes
export function handleDone() {
    if(!isRunning) return;
    
    if (runMode === 'reps' && currentCount >= targetCount) {
        stopRun();
        return;
    }
    
    const pauseInput = parseFloat(document.getElementById('input-pause').value);
    const pauseMs = (isNaN(pauseInput) ? 1.0 : pauseInput) * 1000;

    if (!isPaused) {
         pauseTimer = setTimeout(() => { 
             if(isRunning && !isPaused) runIteration(); 
         }, pauseMs);
    }
}

export function togglePause() {
    if (isPaused) {
        isPaused = false;
        ui.btnPause.textContent = t('run.pause');
        ui.btnPause.classList.remove('pulse-anim');
        
        if(runMode === 'time') {
             ui.progress.style.transition = `stroke-dashoffset ${remainingTime}s linear`;
             ui.progress.style.strokeDashoffset = '565';
        }
        runIteration(); 
    } else {
        isPaused = true;
        ui.btnPause.textContent = t('run.resume');
        ui.btnPause.classList.add('pulse-anim');
        clearTimeout(pauseTimer);
        
        const computedStyle = window.getComputedStyle(ui.progress);
        const currentOffset = computedStyle.getPropertyValue('stroke-dashoffset');
        ui.progress.style.transition = 'none';
        ui.progress.style.strokeDashoffset = currentOffset;
        
        sendPacket([0x80,1,0,1]); 
    }
}

export function stopRun() {
    isRunning = false;
    isPaused = false;
    clearInterval(countdownTimer);
    clearInterval(runTimer);
    clearTimeout(pauseTimer);
    clearTimeout(startTimeout); // --- ADDED: Clear start delay on stop

    activeDrillParams = null;
    activeDrillRandom = false;
    activeDrillName = null;

    // --- UNLOCK SCROLL ON STOP ---
    toggleBodyScroll(false);
    ui.overlay.classList.remove('open');
    document.querySelectorAll('.btn-drill').forEach(b => b.classList.remove('running'));

    sendPacket([0x80,1,0,1]); // Stop command
    log("Drill Stopped");
}

// --- NEW FUNCTION: Skip Countdown ---
export function skipCountdown() {
    // Only execute if NOT running and overlay IS open (i.e., we are in countdown state)
    if (isRunning) return;
    if (!ui.overlay.classList.contains('open')) return;
    
    // Cancel any pending start mechanisms
    clearInterval(countdownTimer);
    clearTimeout(startTimeout);
    
    // Visual feedback
    ui.display.textContent = t('run.go');
    
    // Start immediately
    beginDrillExecution();
}

function formatTime(s) {
    return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

function buildPacket(balls) {
    const b = new ArrayBuffer(7 + balls.length*24);
    const v = new DataView(b);
    v.setUint8(0, 0x81); v.setUint16(1, 4+balls.length*24, true);
    v.setUint8(3, 1); v.setUint16(4, 1, true); v.setUint8(6, 0);
    const u = new Uint8Array(b);
    let off = 7;
    balls.forEach(ba => { u.set(ba, off); off+=24; });
    return u;
}