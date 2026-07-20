import { PRESET_IDS } from './preset-registry.js';

export function classifyLegacySettings(settings = {}) {
    const reasons = [];

    if (settings.hideMessagesWhenThreshold === false && settings.enableVectorization !== true && settings.enableCoreMemories !== true) {
        reasons.push('No message hiding, vector retrieval, or core memories were enabled.');
        return Object.freeze({ preset: PRESET_IDS.SHORT_RP, confidence: 0.95, reasons: Object.freeze(reasons) });
    }

    const recentWindow = Number(settings.runningMemorySize ?? 50);
    const searchLimit = Number(settings.vectorSearchLimit ?? 3);
    if (recentWindow <= 35 && settings.enableVectorization === true && searchLimit >= 6) {
        reasons.push('A tight recent-message window and broad semantic retrieval indicate very long-chat precision settings.');
        return Object.freeze({ preset: PRESET_IDS.EPIC, confidence: 0.9, reasons: Object.freeze(reasons) });
    }

    const summaryWindow = Number(settings.summaryInputMaxMessages ?? 50);
    const coreStart = Number(settings.coreMemoryStartCount ?? 20);
    if (summaryWindow <= 30 || coreStart <= 12) {
        reasons.push('Fast summary turnover or early core-memory promotion indicates episodic retention.');
        return Object.freeze({ preset: PRESET_IDS.EPISODIC, confidence: 0.8, reasons: Object.freeze(reasons) });
    }

    reasons.push('The configuration uses balanced retention suitable for the standard long-form workflow.');
    return Object.freeze({ preset: PRESET_IDS.LONG_FORM, confidence: 0.7, reasons: Object.freeze(reasons) });
}
