import {
    chat_metadata,
    generateRaw,
<<<<<<< HEAD
=======
    user_avatar,
>>>>>>> dev/preset-architecture
    saveMetadata,
    saveSettingsDebounced,
    getCurrentChatId,
    eventSource,
    event_types,
    extension_prompt_types,
    extension_prompt_roles,
    MAX_INJECTION_DEPTH,
    getRequestHeaders,
} from '../../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import {
    createNewWorldInfo,
    deleteWorldInfo,
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    updateWorldInfoList,
    METADATA_KEY,
} from '../../../world-info.js';

import { createApiHelperAgent } from './src/agents/api-helper-agent.js';
import { createMemoryHelperAgent, createCallbackHelperAgent } from './src/agents/builtin-helper-agents.js';
import { createHelperAgentRegistry } from './src/agents/helper-agent-registry.js';
import { createHelperAgentRuntime } from './src/agents/helper-agent-runtime.js';
import { createHelperSchedulingPolicy } from './src/agents/helper-scheduling-policy.js';
import { createHelperTaskRegistry } from './src/agents/helper-task-registry.js';
import { createPostReplyDispatcher } from './src/agents/post-reply-dispatcher.js';
import { CONTEXT_POSITIONS } from './src/context/context-contribution.js';
import { createContextExclusionPolicy } from './src/context/context-exclusion-policy.js';
import { createContextInjector } from './src/context/context-injector.js';
import { createContextRegistry } from './src/context/context-registry.js';
import { createMemoryContextContributor } from './src/context/contributors/memory-context-contributor.js';
import { MODULE_NAME } from './src/core/constants.js';
import { createKeyedLock } from './src/core/keyed-lock.js';
import { createLifecycle } from './src/core/lifecycle.js';
import { createLogger } from './src/core/logger.js';
import { applySettingsDefaults, linkExtensionSettingsNamespaces } from './src/core/settings.js';
import { createNemoLoreState } from './src/core/state.js';
import { createSillyTavernContextBridge } from './src/integrations/sillytavern-context-bridge.js';
import { createSillyTavernContextExclusionInterceptor } from './src/integrations/sillytavern-context-exclusion-interceptor.js';
import { createSillyTavernContextRequestFactory } from './src/integrations/sillytavern-context-request-factory.js';
import { createSillyTavernExtensionPromptAdapter } from './src/integrations/sillytavern-extension-prompt-adapter.js';
import { createSillyTavernGenerationOrchestrator } from './src/integrations/sillytavern-generation-orchestrator.js';
import { createSillyTavernMemoryLifecycle } from './src/integrations/sillytavern-memory-lifecycle.js';
import { createSillyTavernPostReplyListener } from './src/integrations/sillytavern-post-reply-listener.js';
import { createSillyTavernVectorAdapter } from './src/integrations/sillytavern-vector-adapter.js';
import { createWorldInfoAdapter } from './src/integrations/world-info-adapter.js';
import { createEngineOwnership, createNemoTavernHostInterop } from './src/integrations/nemotavern-host-interop.js';
import { createLoreGenerationService } from './src/lore/lore-generation-service.js';
import { createLoreHelperWorkflow } from './src/lore/lore-helper-workflow.js';
import { createLorebookRepository } from './src/lore/lorebook-repository.js';
import { createNounDetector } from './src/lore/noun-detector.js';
import { createAtomicFactExtractor } from './src/memory/extractors/atomic-fact-extractor.js';
import { createEpisodeExtractor } from './src/memory/extractors/episode-extractor.js';
import { createStateChangeExtractor } from './src/memory/extractors/state-change-extractor.js';
import { createLegacyMemoryMigrator } from './src/memory/legacy-memory-migrator.js';
import { createMemoryPersistence } from './src/memory/memory-persistence.js';
import { createMemoryPipeline } from './src/memory/memory-pipeline.js';
import { createMemoryAgingService } from './src/memory/maintenance/memory-aging-service.js';
import { createMemoryConsolidationService } from './src/memory/maintenance/memory-consolidation-service.js';
import { createMemoryMaintenanceService } from './src/memory/maintenance/memory-maintenance-service.js';
import { createEpisodePromotionService } from './src/memory/maintenance/episode-promotion-service.js';
import { createCorePromotionService } from './src/memory/maintenance/core-promotion-service.js';
import { createMemoryStore } from './src/memory/memory-store.js';
import { createContradictionDetector } from './src/memory/processors/contradiction-detector.js';
import { createDeduplicator } from './src/memory/processors/deduplicator.js';
import { createImportanceScorer } from './src/memory/processors/importance-scorer.js';
import { createCandidateSelector } from './src/memory/retrieval/candidate-selector.js';
import { createContextComposer } from './src/memory/retrieval/context-composer.js';
import { createMemoryRetriever } from './src/memory/retrieval/memory-retriever.js';
import { createRedundancyFilter } from './src/memory/retrieval/redundancy-filter.js';
import { createRelevanceScorer } from './src/memory/retrieval/relevance-scorer.js';
import { createTokenBudget } from './src/memory/retrieval/token-budget.js';
import { createSemanticMemoryIndex } from './src/memory/retrieval/semantic-memory-index.js';
import { createSourceLedger } from './src/memory/source-ledger.js';
import { createObservabilityService } from './src/observability/observability-service.js';
import { createPreferenceContextContributor } from './src/preferences/preference-context-contributor.js';
import { createPreferenceManagementService } from './src/preferences/preference-management-service.js';
import { createPreferenceStore } from './src/preferences/preference-store.js';
import { createOpenAICompatibleProvider } from './src/providers/openai-compatible-provider.js';
import { createProviderRegistry } from './src/providers/provider-registry.js';
import { createResilientGenerationRouter } from './src/providers/resilient-generation-router.js';
import { createSillyTavernProvider } from './src/providers/sillytavern-provider.js';
import { createSummaryContextContributor } from './src/summary/summary-context-contributor.js';
import { createSummaryHelperWorkflow } from './src/summary/summary-helper-workflow.js';
import { createSummaryInputBuilder } from './src/summary/summary-input-builder.js';
import { createSummaryService } from './src/summary/summary-service.js';
import { createSummaryStore } from './src/summary/summary-store.js';
import { createHighlighter } from './src/ui/highlighting.js';
import { createChatHighlightingController } from './src/ui/chat-highlighting-controller.js';
import { createModularSettingsController } from './src/ui/modular-settings-controller.js';
import { createModularUiBootstrap } from './src/ui/modular-ui-bootstrap.js';
import { createNotificationCenter } from './src/ui/notification-center.js';
import { createPopupCoordinator } from './src/ui/popup-coordinator.js';

const logger = createLogger({ moduleName: MODULE_NAME });
const settingsBacking = linkExtensionSettingsNamespaces(extension_settings);
const settings = applySettingsDefaults(settingsBacking);
const persistSettings = updated => {
    Object.assign(settingsBacking, updated);
    saveSettingsDebounced();
};
const hostInterop = createNemoTavernHostInterop();
const ownership = createEngineOwnership({ settings, hostInterop });
const state = createNemoLoreState({ logger });
const lifecycle = createLifecycle({ logger, state });
const writeLock = createKeyedLock();
const preferenceStore = createPreferenceStore({ settings, persist: persistSettings, logger });
const preferenceManagement = createPreferenceManagementService({ store: preferenceStore });
const summaryInputBuilder = createSummaryInputBuilder({ settings, logger });
const contextExclusion = createContextExclusionPolicy({ settings, logger });

const worldInfo = createWorldInfoAdapter({
    createWorld: createNewWorldInfo,
    deleteWorld: deleteWorldInfo,
    loadWorld: loadWorldInfo,
    saveWorld: saveWorldInfo,
    createEntry: createWorldInfoEntry,
    updateWorldList: updateWorldInfoList,
    logger,
});
const lorebooks = createLorebookRepository({
    adapter: worldInfo,
<<<<<<< HEAD
=======
    metadata: chat_metadata,
>>>>>>> dev/preset-architecture
    getMetadata: () => chat_metadata,
    saveMetadata,
    metadataKey: METADATA_KEY,
    state,
    logger,
    getActiveChatId: getCurrentChatId,
});

const providers = createProviderRegistry({ logger });
providers.register('sillytavern', createSillyTavernProvider({
    generate: ({ prompt, maxTokens, prefill }) => generateRaw({
        prompt,
        responseLength: maxTokens,
        prefill,
    }),
    logger,
}));
<<<<<<< HEAD
if (settings.enableAsyncApi && settings.asyncApiEndpoint) {
=======
function synchronizeAsyncProvider() {
    if (providers.has('async')) providers.unregister('async');
    if (!settings.enableAsyncApi || !settings.asyncApiEndpoint) return false;
>>>>>>> dev/preset-architecture
    providers.register('async', createOpenAICompatibleProvider({
        endpoint: settings.asyncApiEndpoint,
        apiKey: settings.asyncApiKey,
        model: settings.asyncApiModel,
    }));
    return true;
}
synchronizeAsyncProvider();
const generationRouter = createResilientGenerationRouter({ registry: providers, settings, logger });

const sourceLedger = createSourceLedger({ logger });
const memoryStore = createMemoryStore({ sourceLedger, logger });
const memoryPipeline = createMemoryPipeline({ store: memoryStore, sourceLedger, logger });
const vectorAdapter = createSillyTavernVectorAdapter({
    getRequestHeaders,
    getVectorSettings: () => extension_settings.vectors,
    logger,
});
const semanticMemoryIndex = createSemanticMemoryIndex({ store: memoryStore, adapter: vectorAdapter, settings, logger });
const summaryStore = createSummaryStore({ metadata: chat_metadata, getMetadata: () => chat_metadata, saveMetadata });
const memoryPersistence = createMemoryPersistence({
    store: memoryStore,
    sourceLedger,
<<<<<<< HEAD
=======
    metadata: chat_metadata,
>>>>>>> dev/preset-architecture
    getMetadata: () => chat_metadata,
    saveMetadata,
    logger,
});
const legacyMemoryMigrator = createLegacyMemoryMigrator({
    store: memoryStore,
    sourceLedger,
<<<<<<< HEAD
    settings,
    getMetadata: () => chat_metadata,
    getChat: () => getContext()?.chat ?? [],
    getActiveChatId: getCurrentChatId,
=======
    summaryStore,
    settings,
    metadata: chat_metadata,
    getMetadata: () => chat_metadata,
>>>>>>> dev/preset-architecture
    saveMetadata,
    getActiveChatId: getCurrentChatId,
    logger,
});
const memoryLifecycle = createSillyTavernMemoryLifecycle({
    eventSource,
    chatChangedEvent: event_types.CHAT_CHANGED,
    chatLoadedEvent: event_types.CHAT_LOADED,
    getChatId: getCurrentChatId,
    persistence: memoryPersistence,
    migrator: legacyMemoryMigrator,
    onActivated: chatId => semanticMemoryIndex.activate(chatId),
    logger,
});

const memoryExtractors = Object.freeze({
    episode: createEpisodeExtractor({ generation: generationRouter, logger }),
    atomicFact: createAtomicFactExtractor({ generation: generationRouter, logger }),
    stateChange: createStateChangeExtractor({ generation: generationRouter, logger }),
});
memoryPipeline.registerExtractor('episode', memoryExtractors.episode);
memoryPipeline.registerExtractor('atomic-fact', memoryExtractors.atomicFact);
memoryPipeline.registerExtractor('state-change', memoryExtractors.stateChange);

const memoryProcessors = Object.freeze({
    deduplicator: createDeduplicator({ logger }),
    contradictionDetector: createContradictionDetector({ logger }),
    importanceScorer: createImportanceScorer({ logger }),
});
memoryPipeline.registerProcessor(memoryProcessors.deduplicator);
memoryPipeline.registerProcessor(memoryProcessors.contradictionDetector);
memoryPipeline.registerProcessor(memoryProcessors.importanceScorer);

const memoryMaintenance = Object.freeze({
    aging: createMemoryAgingService({ store: memoryStore, sourceLedger, settings, logger }),
    consolidation: createMemoryConsolidationService({ store: memoryStore, settings, logger }),
    episodePromotion: createEpisodePromotionService({ store: memoryStore, settings, logger }),
    corePromotion: createCorePromotionService({ store: memoryStore, settings, logger }),
});
const memoryMaintenanceService = createMemoryMaintenanceService({ ...memoryMaintenance, logger });

const memoryRetrieval = Object.freeze({
    selector: createCandidateSelector({ store: memoryStore }),
    scorer: createRelevanceScorer(),
    redundancy: createRedundancyFilter(),
    budget: createTokenBudget(),
    composer: createContextComposer(),
});
const memoryRetriever = createMemoryRetriever({ ...memoryRetrieval, semantic: semanticMemoryIndex, settings, logger });

<<<<<<< HEAD
const summaryStore = createSummaryStore({ getMetadata: () => chat_metadata, saveMetadata });
=======
>>>>>>> dev/preset-architecture
const summaryService = createSummaryService({
    generation: generationRouter,
    store: summaryStore,
    settings,
    logger,
    getActiveChatId: getCurrentChatId,
});
const loreGeneration = createLoreGenerationService({
    generation: generationRouter,
    lorebooks,
    lock: writeLock,
    logger,
    getActiveChatId: getCurrentChatId,
});

const contextRegistry = createContextRegistry({ logger });
const contextContributors = Object.freeze({
    summary: createSummaryContextContributor({
        summaryStore,
<<<<<<< HEAD
        legacySummaries: settings.chatSummaries,
        getMetadata: () => chat_metadata,
=======
>>>>>>> dev/preset-architecture
        settings,
        ownership,
        logger,
    }),
    memory: createMemoryContextContributor({
        retrieval: memoryRetriever,
        persistence: memoryPersistence,
<<<<<<< HEAD
        ownership,
=======
        settings,
        ownership,
        logger,
    }),
    preferences: createPreferenceContextContributor({
        store: preferenceStore,
        settings,
        getPersonaId: () => user_avatar,
>>>>>>> dev/preset-architecture
        logger,
    }),
});
contextRegistry.register('summary', contextContributors.summary);
contextRegistry.register('memory', contextContributors.memory);
contextRegistry.register('preferences', contextContributors.preferences);
const contextInjector = createContextInjector({ registry: contextRegistry, logger });

const extensionPromptAdapter = createSillyTavernExtensionPromptAdapter({ resolveContext: getContext, logger });
const contextBridge = createSillyTavernContextBridge({
    injector: contextInjector,
    promptAdapter: extensionPromptAdapter,
    slotConfig: {
        [CONTEXT_POSITIONS.BEFORE_SYSTEM]: { position: extension_prompt_types.BEFORE_PROMPT, depth: 0, scan: false, role: extension_prompt_roles.SYSTEM },
        [CONTEXT_POSITIONS.AFTER_SYSTEM]: { position: extension_prompt_types.IN_PROMPT, depth: 0, scan: false, role: extension_prompt_roles.SYSTEM },
        [CONTEXT_POSITIONS.BEFORE_CHAT]: { position: extension_prompt_types.IN_CHAT, depth: MAX_INJECTION_DEPTH, scan: false, role: extension_prompt_roles.SYSTEM },
        [CONTEXT_POSITIONS.AFTER_CHAT]: { position: extension_prompt_types.IN_CHAT, depth: 0, scan: false, role: extension_prompt_roles.SYSTEM },
    },
    logger,
});

const helperTasks = createHelperTaskRegistry({ logger });
const helperAgents = createHelperAgentRegistry({ logger });
helperAgents.register('api', createApiHelperAgent({ generation: generationRouter, tasks: helperTasks, logger }));
<<<<<<< HEAD
helperAgents.register('memory', createMemoryHelperAgent({ pipeline: memoryPipeline, getActiveChatId: getCurrentChatId }));
=======
helperAgents.register('memory', createMemoryHelperAgent({
    pipeline: memoryPipeline,
    maintenance: memoryMaintenanceService,
    getActiveChatId: getCurrentChatId,
}));
>>>>>>> dev/preset-architecture
helperAgents.register('summary', createCallbackHelperAgent({
    name: 'summary',
    handler: createSummaryHelperWorkflow({
        summary: summaryService,
        inputBuilder: summaryInputBuilder,
    }),
}));
helperAgents.register('lore', createCallbackHelperAgent({
    name: 'lore',
    handler: createLoreHelperWorkflow({ lore: loreGeneration }),
}));

const helperRuntime = createHelperAgentRuntime({
    registry: helperAgents,
    logger,
    concurrency: () => settings.helperAgentConcurrency,
    contextFactory: () => ({
        lorebooks,
        loreGeneration,
        summary: summaryService,
        summaryStore,
        memory: memoryPipeline,
        memoryPersistence,
        retrieval: memoryRetriever,
        context: contextInjector,
        generation: generationRouter,
    }),
});
const helperScheduling = createHelperSchedulingPolicy({ settings });
const postReplyDispatcher = createPostReplyDispatcher({
    runtime: helperRuntime,
    settings,
    policy: helperScheduling,
    providerRouter: generationRouter,
    logger,
});

function registerHelperWorkflow(name, handler) {
    return helperAgents.register(name, createCallbackHelperAgent({ name, handler }));
}

const contextRequestFactory = createSillyTavernContextRequestFactory({
    getChatId: getCurrentChatId,
    getContext,
    getPersonaId: () => user_avatar,
    settings,
});
function wrapGenerationInterceptor(next, overrides = {}) {
    return createSillyTavernGenerationOrchestrator({
        contextBridge,
        requestFactory: overrides.requestFactory ?? contextRequestFactory,
        next,
        logger,
    });
}

const postReplyListener = createSillyTavernPostReplyListener({
    eventSource,
    messageReceivedEvent: event_types.MESSAGE_RECEIVED,
    getContext,
    getChatId: getCurrentChatId,
    dispatcher: postReplyDispatcher,
    logger,
});

const observability = createObservabilityService({
    contextBridge,
    contextRegistry,
    helperRuntime,
    memoryStore,
    summaryStore,
    lorebooks,
    semanticMemory: semanticMemoryIndex,
    getChatId: getCurrentChatId,
    hostInterop,
    ownership,
    logger,
    historyLimit: settings.observabilityHistoryLimit,
});
const settingsController = createModularSettingsController({
    settings,
    save: persistSettings,
    observability,
    providerRouter: generationRouter,
<<<<<<< HEAD
=======
    onPolicyChange: () => helperScheduling.reset(),
    onProviderConfigChange: synchronizeAsyncProvider,
>>>>>>> dev/preset-architecture
    getChatId: getCurrentChatId,
    eventSource,
    chatChangedEvent: event_types.CHAT_CHANGED,
    chatLoadedEvent: event_types.CHAT_LOADED,
<<<<<<< HEAD
=======
    logger,
});
const modularUi = createModularUiBootstrap({
    renderTemplate: renderExtensionTemplateAsync,
    settingsController,
>>>>>>> dev/preset-architecture
    logger,
});

const nounDetector = createNounDetector({ settings, logger });
const highlighter = createHighlighter({ settings, state, logger });
const chatHighlighting = createChatHighlightingController({
    eventSource,
    messageEvent: event_types.MESSAGE_RECEIVED,
    chatEvents: [event_types.CHAT_CHANGED, event_types.CHAT_LOADED],
    nounDetector,
    highlighter,
    logger,
});
const notifications = createNotificationCenter({ logger });
const popups = createPopupCoordinator({ state, logger });

const publicApi = Object.freeze({
    logger,
    settings,
    hostInterop,
    ownership,
    state,
    lifecycle,
    hostInterop,
    ownership,
    providers: Object.freeze({
        registry: providers,
        router: generationRouter,
        createSillyTavernProvider,
        createOpenAICompatibleProvider,
    }),
    agents: Object.freeze({
        registry: helperAgents,
        tasks: helperTasks,
        runtime: helperRuntime,
        scheduling: helperScheduling,
        postReply: postReplyDispatcher,
        postReplyListener,
        registerWorkflow: registerHelperWorkflow,
    }),
    context: Object.freeze({
        registry: contextRegistry,
        injector: contextInjector,
        bridge: contextBridge,
        adapter: extensionPromptAdapter,
        exclusion: contextExclusion,
        contributors: contextContributors,
        requestFactory: contextRequestFactory,
        wrapGenerationInterceptor,
    }),
    observability,
    settingsController,
    ui: modularUi,
    summary: Object.freeze({
        store: summaryStore,
        service: summaryService,
        contributor: contextContributors.summary,
        inputBuilder: summaryInputBuilder,
    }),
    lore: Object.freeze({ repository: lorebooks, generation: loreGeneration }),
    preferences: Object.freeze({ store: preferenceStore, management: preferenceManagement, contributor: contextContributors.preferences }),
    memory: Object.freeze({
        sourceLedger,
        store: memoryStore,
        pipeline: memoryPipeline,
        persistence: memoryPersistence,
        migrator: legacyMemoryMigrator,
        lifecycle: memoryLifecycle,
        extractors: memoryExtractors,
        processors: memoryProcessors,
        maintenance: Object.freeze({ ...memoryMaintenance, service: memoryMaintenanceService }),
        retrieval: Object.freeze({ ...memoryRetrieval, retriever: memoryRetriever }),
        semantic: Object.freeze({ adapter: vectorAdapter, index: semanticMemoryIndex }),
    }),
    services: Object.freeze({
        worldInfo,
        lorebooks,
        loreGeneration,
        summary: summaryService,
        summaryStore,
        summaryInputBuilder,
        generation: generationRouter,
        providerRegistry: providers,
        agents: helperRuntime,
        scheduling: helperScheduling,
        postReply: postReplyDispatcher,
        memory: memoryPipeline,
        memoryMaintenance: memoryMaintenanceService,
        memoryPersistence,
        retrieval: memoryRetriever,
        semanticMemory: semanticMemoryIndex,
        context: contextInjector,
        contextBridge,
        contextExclusion,
        observability,
        settings: settingsController,
        ui: modularUi,
        nounDetector,
        highlighter,
        chatHighlighting,
        notifications,
        popups,
    }),
});
globalThis.NemoLore = publicApi;

async function installSettingsControllerWhenReady({ attempts = 20, delayMs = 250 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (settingsController.install()) return true;
        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    logger.warn('Legacy settings loaded without a compatible container for modular controls.', {
        attempts,
        selector: '#nemo-ext-nemolore .inline-drawer-content',
    });
    return false;
}

lifecycle.start();
try {
    await modularUi.install();

    const modularExclusionInterceptor = createSillyTavernContextExclusionInterceptor({
        policy: contextExclusion,
        summaryStore,
        getChatId: getCurrentChatId,
        getContext,
        logger,
    });
    globalThis.nemolore_intercept_messages = wrapGenerationInterceptor(modularExclusionInterceptor);
    logger.info('Replaced the retired legacy interceptor with modular context orchestration.');

    semanticMemoryIndex.start();
    memoryLifecycle.install();
    postReplyListener.install();
<<<<<<< HEAD
    await installSettingsControllerWhenReady();
    lifecycle.markLegacyLoaded();
=======
    chatHighlighting.install();
    lifecycle.markUiReady();
>>>>>>> dev/preset-architecture
    lifecycle.markReady();
    logger.info('NemoLore modular runtime ready; legacy data import remains available without legacy execution.');
} catch (error) {
    lifecycle.fail(error);
    throw error;
}
