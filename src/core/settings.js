export const DEFAULT_SETTINGS = Object.freeze({
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
    summaryEngineMode: 'legacy',
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
    summaryContextPrecedence: 'new-first',
    summaryContextPriority: 80,

    loreEngineMode: 'legacy',
    autoCreateLorebook: true,
    chatSummaries: {},

    enableCoreMemories: true,
    coreMemoryStartCount: 20,
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

    const canonical = isSettingsObject(extensionSettings[SETTINGS_NAMESPACE])
        ? extensionSettings[SETTINGS_NAMESPACE]
        : null;
    const legacy = isSettingsObject(extensionSettings[LEGACY_SETTINGS_NAMESPACE])
        ? extensionSettings[LEGACY_SETTINGS_NAMESPACE]
        : null;
    // The original extension has historically written to the uppercase
    // namespace. Keep that object authoritative during an upgrade so a stale
    // lowercase snapshot cannot silently replace user-selected legacy modes.
    // Lowercase-only modular settings are copied across before both names are
    // linked to the same live object.
    const shared = legacy ?? canonical ?? {};

    if (canonical && legacy && canonical !== legacy) {
        for (const [key, value] of Object.entries(canonical)) {
            if (!(key in legacy)) legacy[key] = value;
        }
    }

    extensionSettings[SETTINGS_NAMESPACE] = shared;
    extensionSettings[LEGACY_SETTINGS_NAMESPACE] = shared;
    return shared;
}

export function isLegacySummaryEngine(settings = {}) {
    return settings.summaryEngineMode !== 'modular';
}

export function isLegacyLoreEngine(settings = {}) {
    return settings.loreEngineMode !== 'modular';
}

export function createSettings(overrides = {}) {
    return {
        ...DEFAULT_SETTINGS,
        ...overrides,
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

    Object.assign(settings, createSettings(settings));
    return settings;
}

export function mergeSettings(storedSettings = {}) {
    return createSettings(storedSettings);
}
