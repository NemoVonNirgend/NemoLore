import { MODULE_NAME } from './constants.js';

let debugEnabled = false;

export function setDebugEnabled(enabled) {
    debugEnabled = Boolean(enabled);
}

export function debug(...args) {
    if (debugEnabled) console.debug(`[${MODULE_NAME}]`, ...args);
}

export function info(...args) {
    console.info(`[${MODULE_NAME}]`, ...args);
}

export function warn(...args) {
    if (debugEnabled) console.warn(`[${MODULE_NAME}]`, ...args);
}

export function error(...args) {
    console.error(`[${MODULE_NAME}]`, ...args);
}

export function createLogger({ moduleName = MODULE_NAME, debug: initialDebug = false } = {}) {
    let localDebugEnabled = Boolean(initialDebug);
    const prefix = `[${moduleName}]`;

    return Object.freeze({
        setDebugEnabled(enabled) {
            localDebugEnabled = Boolean(enabled);
        },
        debug(...args) {
            if (localDebugEnabled) console.debug(prefix, ...args);
        },
        info(...args) {
            console.info(prefix, ...args);
        },
        warn(...args) {
            if (localDebugEnabled) console.warn(prefix, ...args);
        },
        error(...args) {
            console.error(prefix, ...args);
        },
    });
}
