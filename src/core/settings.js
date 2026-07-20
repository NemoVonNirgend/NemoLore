import { DEFAULT_PRESET_ID, PRESET_POLICY_VERSION, PRESET_SETTING_KEYS, resolvePreset } from '../presets/preset-registry.js';
import { classifyLegacySettings } from '../presets/legacy-settings-classifier.js';

export const DEFAULT_SETTINGS = Object.freeze({
    settingsSchemaVersion: 2,
    preset: DEFAULT_PRESET_ID,
    presetPolicyVersion: PRESET_POLICY_VERSION,
    presetOverrides: {},
    presetMigration: null,
    enabled: true,
    autoMode: false,
    updateInterval: 50,
    highlightNouns: true,
    createLorebookOnChat: true,
    notificationTimeout: 10_000,
    showInitialPrompt: true,
    nounMinLength: 3,
    excludeCommonWords: true,

    enableSummarization: true,
    summaryEngineMode: 'modular',
    summaryInputMaxMessages: 50,
    connectionProfile: '',
    completionPreset: '',
    prefill: '',
    autoSummarize: true,
    runningMemorySize: 50,
    maxContextSize: 100_000,
    summaryThreshold: 1_500,
    summaryMaxLength: 150,
    showSummariesInChat: true,
    hideMessagesWhenThreshold: true,
    includeTimeLocation: true,
    includeNPCs: true,
    includeEvents: true,
    includeDialogue: false,
    summaryDelay: 0,
    blockChatDuringSummary: false,
    enablePairedSummarization: true,
    linkSummariesToAI: true,
    enableSummaryContext: true,
    summaryContextPrecedence: 'new-only',
    summaryContextPriority: 80,

    loreEngineMode: 'modular',
    autoCreateLorebook: true,
    chatSummaries: {},

    enableCoreMemories: true,
    coreMemoryStartCount: 20,
    coreMemoryImportanceThreshold: 0.9,
    coreMemoryMaxPromotionsPerRun: 1,
    coreMemoryPromptLorebook: true,
    coreMemoryReplaceMessage: true,
    coreMemoryAnimationDuration: 2_000,

    enableVectorization: false,
    vectorizationSource: 'google',
    vectorSearchLimit: 3,
    vectorSimilarityThreshold: 0.7,
    forceCompatibilityMode: false,

    openaiModel: 'text-embedding-3-small',
    googleModel: 'text-embedding-004',
    cohereModel: 'embed-english-v3.0',
    ollamaModel: 'mxbai-embed-large',
    vllmModel: '',

    enableAsyncApi: false,
    asyncApiProvider: '',
    asyncApiKey: '',
    asyncApiModel: '',
    asyncApiEndpoint: '',

    enableHelperAgents: false,
    helperAgentConcurrency: 3,
    helperAgentProvider: '',
    helperMemoryProvider: '',
    helperSummaryProvider: '',
    helperLoreProvider: '',
    helperFallbackProvider: '',
    helperMemoryAfterReply: true,
    helperLoreAfterReply: false,
    helperSummaryAfterReply: false,
    helperMaxCallsPerReply: 3,
    helperMemoryMinMessages: 0,
    helperSummaryMinMessages: 4,
    helperLoreMinMessages: 2,
    helperLoreRequireSignal: true,
    helperMemoryCooldownMs: 0,
    helperSummaryCooldownMs: 0,
    helperLoreCooldownMs: 0,
    helperRequestTimeoutMs: 45_000,
    helperRetryCount: 1,
    helperCircuitBreakerFailures: 3,
    helperCircuitBreakerCooldownMs: 60_000,

    enableObservability: true,
    observabilityHistoryLimit: 100,

    summaryChunkSize: 8,
    episodePromotionThreshold: 4,
    episodePromotionSourceMode: 'archive',
    memoryAgingEnabled: true,
    memoryAgingGraceMessages: 80,
    memoryAgingRate: 0.08,
    memoryAgingFloor: 0.35,
    memoryConsolidationEnabled: true,
    memoryConsolidationMinRecords: 6,
    memoryConsolidationBatchSize: 8,
    memoryConsolidationSourceMode: 'archive',
    memoryContextBudget: 1_200,
    memoryCandidateLimit: 16,
    loreUpdateStrategy: 'balanced',

    enablePreferenceMemory: false,
    preferenceContextBudget: 400,
    preferenceContextLimit: 12,
    preferenceContextPriority: 90,
    preferenceRecords: [],
    preferenceEvidence: [],
});

export const SETTINGS_NAMESPACE = 'nemolore';
export const LEGACY_SETTINGS_NAMESPACE = 'NemoLore';

function isSettingsObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function linkExtensionSettingsNamespaces(extensionSettings) {
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        throw new TypeError('Extension settings must be an object.');
    }
<<<<<<< HEAD

=======
>>>>>>> dev/preset-architecture
    const canonical = isSettingsObject(extensionSettings[SETTINGS_NAMESPACE])
        ? extensionSettings[SETTINGS_NAMESPACE]
        : null;
    const legacy = isSettingsObject(extensionSettings[LEGACY_SETTINGS_NAMESPACE])
        ? extensionSettings[LEGACY_SETTINGS_NAMESPACE]
        : null;
<<<<<<< HEAD
    // The original extension has historically written to the uppercase
    // namespace. Keep that object authoritative during an upgrade so a stale
    // lowercase snapshot cannot silently replace user-selected legacy modes.
    // Lowercase-only modular settings are copied across before both names are
    // linked to the same live object.
=======
>>>>>>> dev/preset-architecture
    const shared = legacy ?? canonical ?? {};

    if (canonical && legacy && canonical !== legacy) {
        for (const [key, value] of Object.entries(canonical)) {
            if (!(key in legacy)) legacy[key] = value;
        }
    }
<<<<<<< HEAD

=======
>>>>>>> dev/preset-architecture
    extensionSettings[SETTINGS_NAMESPACE] = shared;
    extensionSettings[LEGACY_SETTINGS_NAMESPACE] = shared;
    return shared;
}

<<<<<<< HEAD
export function isLegacySummaryEngine(settings = {}) {
    return settings.summaryEngineMode !== 'modular';
}

export function isLegacyLoreEngine(settings = {}) {
    return settings.loreEngineMode !== 'modular';
}

=======
>>>>>>> dev/preset-architecture
export function createSettings(overrides = {}) {
    const hasStoredSettings = Object.keys(overrides ?? {}).length > 0;
    const hasPresetSchema = Number(overrides.settingsSchemaVersion) >= 2 && overrides.preset;
    const requiresCutover = hasStoredSettings && (!hasPresetSchema
        || overrides.summaryEngineMode === 'legacy'
        || overrides.loreEngineMode === 'legacy'
        || overrides.presetMigration?.legacyValuesPreserved === true);
    const isPresetSettings = hasPresetSchema && !requiresCutover;
    const classification = hasPresetSchema
        ? { preset: overrides.preset, confidence: 1, reasons: [] }
        : hasStoredSettings ? classifyLegacySettings(overrides) : { preset: DEFAULT_PRESET_ID, confidence: 1, reasons: [] };
    const resolved = resolvePreset(classification.preset, isPresetSettings ? overrides.presetOverrides : {});
    const migration = isPresetSettings ? overrides.presetMigration ?? null : hasStoredSettings ? {
        fromSchemaVersion: Number(overrides.settingsSchemaVersion ?? 1),
        selectedPreset: classification.preset,
        confidence: classification.confidence,
        reasons: [...classification.reasons],
        legacyValuesPreserved: false,
        cutoverCompleted: true,
        legacyPolicySnapshot: Object.fromEntries(PRESET_SETTING_KEYS
            .filter(key => Object.hasOwn(overrides, key))
            .map(key => [key, overrides[key]])),
    } : null;
    const presetKeys = new Set(PRESET_SETTING_KEYS);
    const preserved = Object.fromEntries(Object.entries(overrides).filter(([key]) => !presetKeys.has(key)));

    return {
        ...DEFAULT_SETTINGS,
        ...resolved.settings,
        ...preserved,
        settingsSchemaVersion: 2,
        preset: resolved.id,
        presetPolicyVersion: resolved.policyVersion,
        presetOverrides: { ...resolved.overrides },
        presetMigration: migration,
        summaryEngineMode: 'modular',
        loreEngineMode: 'modular',
        summaryContextPrecedence: 'new-only',
        chatSummaries: {
            ...DEFAULT_SETTINGS.chatSummaries,
            ...(overrides.chatSummaries ?? {}),
        },
    };
}

export function applySettingsDefaults(settings) {
    if (!isSettingsObject(settings)) {
        throw new TypeError('Settings must be an object.');
    }
<<<<<<< HEAD

=======
>>>>>>> dev/preset-architecture
    Object.assign(settings, createSettings(settings));
    return settings;
}

export function mergeSettings(storedSettings = {}) {
    return createSettings(storedSettings);
}

export function selectPreset(currentSettings = {}, preset, presetOverrides = {}) {
    const presetKeys = new Set(PRESET_SETTING_KEYS);
    const preserved = Object.fromEntries(Object.entries(currentSettings).filter(([key]) => (
        !presetKeys.has(key) && !['preset', 'presetOverrides', 'presetMigration', 'presetPolicyVersion'].includes(key)
    )));
    return createSettings({
        ...preserved,
        settingsSchemaVersion: 2,
        preset,
        presetOverrides,
        presetMigration: currentSettings.presetMigration ?? null,
    });
}

export function setPresetOverride(currentSettings = {}, key, value) {
    if (!PRESET_SETTING_KEYS.includes(key)) throw new TypeError(`Setting is not controlled by a NemoLore preset: ${key}`);
    return selectPreset(currentSettings, currentSettings.preset ?? DEFAULT_PRESET_ID, {
        ...(currentSettings.presetOverrides ?? {}),
        [key]: value,
    });
}
