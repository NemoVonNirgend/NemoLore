import { MODULE_NAME } from './constants.js';

let debugEnabled = false;

export function setDebugEnabled(enabled) {
    debugEnabled = Boolean(enabled);
}

export function debug(...args) {
    if (debugEnabled) console.debug(`[${MODULE_NAME}]`, ...args);
}

export function warn(...args) {
    if (debugEnabled) console.warn(`[${MODULE_NAME}]`, ...args);
}

export function error(...args) {
    console.error(`[${MODULE_NAME}]`, ...args);
}
