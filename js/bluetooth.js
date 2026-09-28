import { SERVICE_UUID, UUID_S, UUID_N, UUID_W, SALT, MSG_DONE } from './constants.js';
import { log, showToast, MD5, clamp } from './utils.js';
import { handleDone } from './runner.js';
import { startSession } from './state.js'; // <--- ADDED IMPORT

export const bleState = {
    isConnected: false,
    isConnecting: false,
    // UI-facing lifecycle: disconnected | picking | connecting |
    // authenticating | ready | error
    phase: 'disconnected',
    statusText: 'Disconnected',
    device: null,
    writeChar: null,
    handshakeState: "disconnected"
};

let writeLock = Promise.resolve();
let watchdog = null;
let teardownExpected = false;

// The robot is chatty but not instant. Every stage gets a deadline so a hung
// connection reports itself instead of leaving the user staring at a button
// that appears to do nothing.
let CONNECT_TIMEOUT = 12000;
let HANDSHAKE_TIMEOUT = 10000;

/** Test seam so the watchdog can be exercised without a 10s wait. */
export function setConnectTimeouts(connectMs, handshakeMs) {
    if (connectMs > 0) CONNECT_TIMEOUT = connectMs;
    if (handshakeMs > 0) HANDSHAKE_TIMEOUT = handshakeMs;
}

function setPhase(phase, statusText) {
    bleState.phase = phase;
    bleState.statusText = statusText;
    bleState.isConnected = phase === 'ready';
    bleState.isConnecting = phase === 'picking' || phase === 'connecting' || phase === 'authenticating';
    document.dispatchEvent(new CustomEvent('connection-changed', { detail: { phase } }));
}

function startWatchdog(ms, message) {
    clearWatchdog();
    watchdog = setTimeout(() => failConnect(message), ms);
}

function clearWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
}

/** Turn a GATT failure into something a player can act on. */
function describeConnectError(e) {
    const msg = (e && e.message) || String(e);
    if (/already connected/i.test(msg)) {
        return 'That robot is still connected to another tab. Disconnect it and try again.';
    }
    if (/NotFoundError/i.test(e && e.name)) {
        return 'That device does not look like a Nova robot.';
    }
    if (/write channel|notify channel|service/i.test(msg)) {
        return 'The robot answered but did not offer the Nova service. Check you picked the right device.';
    }
    return `Could not connect: ${msg}`;
}

function failConnect(message) {
    clearWatchdog();
    teardownExpected = true;
    try {
        if (bleState.device && bleState.device.gatt && bleState.device.gatt.connected) {
            bleState.device.gatt.disconnect();
        }
    } catch { /* the link was already gone */ }
    teardownExpected = false;

    bleState.device = null;
    bleState.writeChar = null;
    bleState.handshakeState = 'disconnected';

    log("Connect Error: " + message);
    setPhase('error', 'Connection failed');
    showToast(message);
}

export async function connectDevice() {
    if (bleState.isConnected || bleState.isConnecting) return;

    setPhase('picking', 'Pick your robot…');
    log("Scanning...");

    let device;
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [UUID_S]
        });
    } catch (e) {
        clearWatchdog();
        // Dismissing the chooser is a normal thing to do, not a failure.
        if (e && e.name === 'NotFoundError') {
            log("Device picker dismissed");
            setPhase('disconnected', 'Disconnected');
        } else {
            failConnect('Could not open the device picker');
        }
        return;
    }

    device.addEventListener('gattserverdisconnected', onDisconnect);
    bleState.device = device;

    setPhase('connecting', 'Connecting…');
    startWatchdog(CONNECT_TIMEOUT, 'The robot did not answer. Move it closer, make sure it is on, then try again.');

    try {
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(UUID_S);
        const chars = await service.getCharacteristics();

        // Subscribe listeners BEFORE enabling notifications. The robot pushes
        // its serial the moment notifications switch on, so a listener
        // registered after the await loses that packet and the handshake can
        // never start - which looks exactly like "nothing happened".
        let notifyChar = null;
        let writeChar = null;
        for (const c of chars) {
            if (c.uuid === UUID_N) {
                c.addEventListener('characteristicvaluechanged', onNotify);
                notifyChar = c;
            } else if (c.uuid === UUID_W) {
                writeChar = c;
            }
        }

        if (!writeChar) throw new Error('robot exposed no write channel');
        if (!notifyChar) throw new Error('robot exposed no notify channel');
        bleState.writeChar = writeChar;

        // Arm the state machine BEFORE subscribing. The robot may push its
        // serial the instant notifications are enabled, and a packet handled
        // while handshakeState is still "disconnected" matches no branch and
        // is thrown away - the same "nothing happened" symptom.
        bleState.handshakeState = "handshake";
        setPhase('authenticating', 'Authorising…');
        startWatchdog(HANDSHAKE_TIMEOUT, 'Connected to the robot but it did not finish authorising. Try again.');

        await notifyChar.startNotifications();
        await sendPacket([0x07, 0, 0, 0]); // Start handshake
    } catch (e) {
        failConnect(describeConnectError(e));
    }
}

export function disconnectDevice() {
    teardownExpected = true;
    try {
        if (bleState.device && bleState.device.gatt && bleState.device.gatt.connected) {
            bleState.device.gatt.disconnect();
        }
    } finally {
        teardownExpected = false;
    }
}

function onDisconnect() {
    clearWatchdog();
    bleState.device = null;
    bleState.writeChar = null;
    bleState.handshakeState = 'disconnected';

    if (teardownExpected) {
        setPhase('disconnected', 'Disconnected');
        return;
    }

    log("Disconnected");
    showToast("Disconnected");
    setPhase('disconnected', 'Disconnected');
}

export function sendPacket(data) {
    if(!bleState.writeChar) return Promise.reject("No Write Char");
    const arr = new Uint8Array(data);
    writeLock = writeLock.then(() => bleState.writeChar.writeValue(arr).catch(e => log("TX Error: " + e)));
    return writeLock;
}

function onNotify(e) {
    const buf = e.target.value.buffer;
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');

    // Handshake Sequence
    if(bleState.handshakeState === "handshake") {
        const td = new TextDecoder();
        const str = td.decode(buf);
        if(str.length > 18) {
            const serial = str.slice(6,18);
            const code = str.slice(18);
            let hashme = serial;
            for(let i=0; i<serial.length; i++) hashme += SALT[serial.charCodeAt(i)%0x24];
            hashme += code;
            const hash = MD5(hashme);
            const resp = new Uint8Array(3+hash.length);
            resp.set([0x08,0x20,0,0]);
            resp.set(new TextEncoder().encode(hash),3);
            sendPacket(resp);
            bleState.handshakeState = "auth_1";
        }
    } 
    else if(bleState.handshakeState === "auth_1") { sendPacket([1,0,0]); bleState.handshakeState = "auth_2"; }
    else if(bleState.handshakeState === "auth_2") { sendPacket([2,0,0]); bleState.handshakeState = "auth_3"; }
    else if(bleState.handshakeState === "auth_3") {
        sendPacket([0x80,1,0,0]);
        clearWatchdog();
        bleState.handshakeState = "ready";
        startSession(); // <--- ADDED: Capture stats snapshot on connect
        log("Ready");
        showToast("Connected");
        setPhase('ready', 'Connected');
    }

    // Drill execution callback
    if (hex.includes(MSG_DONE)) {
        handleDone();
    }
}

// Data Packing Helper
export function packBall(us, ls, bh, dp, freq, reps) {
    const b = new ArrayBuffer(24), v = new DataView(b);
    us = clamp(us, 400, 7500); ls = clamp(ls, 400, 7500);
    const bh_f = (clamp(bh,-50,100)+50)/150*50-20;
    const dp_f = (clamp(dp,-10,10)+10)/20*44-22;
    const fr_f = (clamp(freq,0,100)/100)+0.5;
    
    v.setUint32(0, us, true); 
    v.setUint32(4, ls, true);
    v.setFloat32(8, bh_f, true); 
    v.setFloat32(12, dp_f, true);
    v.setFloat32(16, fr_f, true); 
    v.setUint32(20, reps, true);
    return new Uint8Array(b);
}