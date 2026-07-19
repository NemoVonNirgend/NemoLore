import { ERROR_RECOVERY_INTERVAL_MS } from './constants.js';
import { error, warn } from './logger.js';

function createInitialState() {
    return {
        lifecycle: {
            isInitialized: false,
            currentChatLorebook: null,
            lastHandledChatId: null,
            loadedSummariesChatId: null,
        },
        metrics: {
            messageCount: 0,
            totalChatTokens: 0,
        },
        processing: {
            summaries: false,
            lorebookCreation: false,
            coreMemory: false,
            popup: false,
        },
        features: {
            vectorizationEnabled: false,
        },
        collections: {
            messageSummaries: new Map(),
            vectorizedMessages: new Map(),
            highlightedNouns: new Set(),
            processedMessages: new WeakSet(),
            summaryQueue: [],
            hierarchicalSummaries: new Map(),
        },
        services: {
            memoryManager: null,
        },
        timers: {
            summary: new Set(),
            pairedSummary: new Set(),
            recoveryInterval: null,
        },
        ui: {
            currentTooltip: null,
            messageObserver: null,
            summaryProgressBar: null,
        },
    };
}

const state = createInitialState();

export function getState() {
    return state;
}

export function resetChatState() {
    state.processing.summaries = false;
    state.processing.lorebookCreation = false;
    state.processing.coreMemory = false;
    state.processing.popup = false;
    state.collections.summaryQueue.length = 0;
    state.collections.messageSummaries.clear();
    state.collections.vectorizedMessages.clear();
    state.collections.highlightedNouns.clear();
    state.collections.hierarchicalSummaries.clear();
    state.collections.processedMessages = new WeakSet();
    state.metrics.messageCount = 0;
    state.metrics.totalChatTokens = 0;
    clearTrackedTimeouts();
}

export function addTrackedTimeout(callback, delay, type = 'summary') {
    const bucket = type === 'pairedSummary'
        ? state.timers.pairedSummary
        : state.timers.summary;

    const timeoutId = setTimeout(() => {
        try {
            callback();
        } catch (cause) {
            error('Error in tracked timeout callback:', cause);
        } finally {
            state.timers.summary.delete(timeoutId);
            state.timers.pairedSummary.delete(timeoutId);
        }
    }, delay);

    bucket.add(timeoutId);
    return timeoutId;
}

export function clearTrackedTimeouts() {
    for (const timeoutId of state.timers.summary) clearTimeout(timeoutId);
    for (const timeoutId of state.timers.pairedSummary) clearTimeout(timeoutId);
    state.timers.summary.clear();
    state.timers.pairedSummary.clear();
}

export function startErrorRecovery() {
    if (state.timers.recoveryInterval) return;

    state.timers.recoveryInterval = setInterval(() => {
        if (state.processing.summaries && state.collections.summaryQueue.length === 0) {
            warn('Recovered a stuck summary-processing flag.');
            state.processing.summaries = false;
        }

        if (state.processing.lorebookCreation) {
            warn('Recovered a stuck lorebook-creation flag.');
            state.processing.lorebookCreation = false;
        }

        if (state.processing.coreMemory) {
            warn('Recovered a stuck core-memory flag.');
            state.processing.coreMemory = false;
        }
    }, ERROR_RECOVERY_INTERVAL_MS);
}

export function stopErrorRecovery() {
    if (!state.timers.recoveryInterval) return;
    clearInterval(state.timers.recoveryInterval);
    state.timers.recoveryInterval = null;
}

export function createNemoLoreState({ logger } = {}) {
    return Object.freeze({
        raw: state,

        get isInitialized() {
            return state.lifecycle.isInitialized;
        },
        set isInitialized(value) {
            state.lifecycle.isInitialized = Boolean(value);
        },

        reset() {
            resetChatState();
            stopErrorRecovery();
            state.lifecycle.isInitialized = false;
            logger?.debug('Canonical state reset.');
        },

        startErrorRecovery,
        stopErrorRecovery,
        addTimeout: addTrackedTimeout,
        clearTimeouts: clearTrackedTimeouts,
    });
}
