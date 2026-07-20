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
    helperAgentConcurrency: 2,
    helperAgentProvider: '',
    helperMemoryAfterReply: true,
    helperLoreAfterReply: false,
    helperSummaryAfterReply: false,

    enableObservability: true,
    observabilityHistoryLimit: 100,
});

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

export function mergeSettings(storedSettings = {}) {
    return createSettings(storedSettings);
}
