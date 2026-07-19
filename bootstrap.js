import {
    chat_metadata,
    saveMetadata,
    getCurrentChatId,
    eventSource,
    event_types,
    extension_prompt_types,
    extension_prompt_roles,
    MAX_INJECTION_DEPTH,
} from '../../../../script.js';
import { getContext } from '../../../extensions.js';
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
import { createHelperTaskRegistry } from './src/agents/helper-task-registry.js';
import { createPostReplyDispatcher } from './src/agents/post-reply-dispatcher.js';
import { CONTEXT_POSITIONS } from './src/context/context-contribution.js';
import { createContextInjector } from './src/context/context-injector.js';
import { createContextRegistry } from './src/context/context-registry.js';
import { createMemoryContextContributor } from './src/context/contributors/memory-context-contributor.js';
import { MODULE_NAME } from './src/core/constants.js';
import { createKeyedLock } from './src/core/keyed-lock.js';
import { createLifecycle } from './src/core/lifecycle.js';
import { createLogger } from './src/core/logger.js';
import { createSettings } from './src/core/settings.js';
import { createNemoLoreState } from './src/core/state.js';
import { createSillyTavernContextBridge } from './src/integrations/sillytavern-context-bridge.js';
import { createSillyTavernContextRequestFactory } from './src/integrations/sillytavern-context-request-factory.js';
import { createSillyTavernExtensionPromptAdapter } from './src/integrations/sillytavern-extension-prompt-adapter.js';
import { createSillyTavernGenerationOrchestrator } from './src/integrations/sillytavern-generation-orchestrator.js';
import { createSillyTavernPostReplyListener } from './src/integrations/sillytavern-post-reply-listener.js';
import { createWorldInfoAdapter } from './src/integrations/world-info-adapter.js';
import { createLoreGenerationService } from './src/lore/lore-generation-service.js';
import { createLoreHelperWorkflow } from './src/lore/lore-helper-workflow.js';
import { createLorebookRepository } from './src/lore/lorebook-repository.js';
import { createNounDetector } from './src/lore/noun-detector.js';
import { createAtomicFactExtractor } from './src/memory/extractors/atomic-fact-extractor.js';
import { createEpisodeExtractor } from './src/memory/extractors/episode-extractor.js';
import { createStateChangeExtractor } from './src/memory/extractors/state-change-extractor.js';
import { createMemoryPipeline } from './src/memory/memory-pipeline.js';
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
import { createSourceLedger } from './src/memory/source-ledger.js';
import { createOpenAICompatibleProvider } from './src/providers/openai-compatible-provider.js';
import { createProviderRegistry } from './src/providers/provider-registry.js';
import { createSillyTavernProvider } from './src/providers/sillytavern-provider.js';
import { createSummaryHelperWorkflow } from './src/summary/summary-helper-workflow.js';
import { createSummaryService } from './src/summary/summary-service.js';
import { createSummaryStore } from './src/summary/summary-store.js';
import { createHighlighter } from './src/ui/highlighting.js';
import { createNotificationCenter } from './src/ui/notification-center.js';
import { createPopupCoordinator } from './src/ui/popup-coordinator.js';

const logger = createLogger({ moduleName: MODULE_NAME });
const settings = createSettings();
const state = createNemoLoreState({ logger });
const lifecycle = createLifecycle({ logger, state });
const writeLock = createKeyedLock();

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
    metadata: chat_metadata,
    saveMetadata,
    metadataKey: METADATA_KEY,
    state,
    logger,
});

const providers = createProviderRegistry({ logger });
if (settings.enableAsyncApi && settings.asyncApiEndpoint) {
    providers.register('async', createOpenAICompatibleProvider({
        endpoint: settings.asyncApiEndpoint,
        apiKey: settings.asyncApiKey,
        model: settings.asyncApiModel,
    }));
}

const sourceLedger = createSourceLedger({ logger });
const memoryStore = createMemoryStore({ sourceLedger, logger });
const memoryPipeline = createMemoryPipeline({ store: memoryStore, sourceLedger, logger });
const memoryExtractors = Object.freeze({
    episode: createEpisodeExtractor({ generation: providers, logger }),
    atomicFact: createAtomicFactExtractor({ generation: providers, logger }),
    stateChange: createStateChangeExtractor({ generation: providers, logger }),
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

const memoryRetrieval = Object.freeze({
    selector: createCandidateSelector({ store: memoryStore }),
    scorer: createRelevanceScorer(),
    redundancy: createRedundancyFilter(),
    budget: createTokenBudget(),
    composer: createContextComposer(),
});
const memoryRetriever = createMemoryRetriever({ ...memoryRetrieval, logger });

const summaryStore = createSummaryStore({ metadata: chat_metadata, saveMetadata });
const summaryService = createSummaryService({ generation: providers, store: summaryStore, settings, logger });
const loreGeneration = createLoreGenerationService({ generation: providers, lorebooks, lock: writeLock, logger });

const contextRegistry = createContextRegistry({ logger });
const contextContributors = Object.freeze({
    memory: createMemoryContextContributor({ retrieval: memoryRetriever, logger }),
});
contextRegistry.register('memory', contextContributors.memory);
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
helperAgents.register('api', createApiHelperAgent({ generation: providers, tasks: helperTasks, logger }));
helperAgents.register('memory', createMemoryHelperAgent({ pipeline: memoryPipeline }));
helperAgents.register('summary', createCallbackHelperAgent({
    name: 'summary',
    handler: createSummaryHelperWorkflow({ summary: summaryService }),
}));
helperAgents.register('lore', createCallbackHelperAgent({
    name: 'lore',
    handler: createLoreHelperWorkflow({ lore: loreGeneration }),
}));

const helperRuntime = createHelperAgentRuntime({
    registry: helperAgents,
    logger,
    concurrency: settings.helperAgentConcurrency,
    contextFactory: () => ({
        lorebooks,
        loreGeneration,
        summary: summaryService,
        summaryStore,
        memory: memoryPipeline,
        retrieval: memoryRetriever,
        context: contextInjector,
    }),
});
const postReplyDispatcher = createPostReplyDispatcher({ runtime: helperRuntime, settings, logger });

function registerHelperWorkflow(name, handler) {
    return helperAgents.register(name, createCallbackHelperAgent({ name, handler }));
}

const contextRequestFactory = createSillyTavernContextRequestFactory({
    getChatId: getCurrentChatId,
    getContext,
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

const nounDetector = createNounDetector({ settings, logger });
const highlighter = createHighlighter({ settings, state, logger });
const notifications = createNotificationCenter({ logger });
const popups = createPopupCoordinator({ state, logger });

const publicApi = Object.freeze({
    logger,
    settings,
    state,
    lifecycle,
    providers: Object.freeze({ registry: providers, createSillyTavernProvider, createOpenAICompatibleProvider }),
    agents: Object.freeze({
        registry: helperAgents,
        tasks: helperTasks,
        runtime: helperRuntime,
        postReply: postReplyDispatcher,
        postReplyListener,
        registerWorkflow: registerHelperWorkflow,
    }),
    context: Object.freeze({
        registry: contextRegistry,
        injector: contextInjector,
        bridge: contextBridge,
        adapter: extensionPromptAdapter,
        contributors: contextContributors,
        requestFactory: contextRequestFactory,
        wrapGenerationInterceptor,
    }),
    summary: Object.freeze({ store: summaryStore, service: summaryService }),
    lore: Object.freeze({ repository: lorebooks, generation: loreGeneration }),
    memory: Object.freeze({
        sourceLedger,
        store: memoryStore,
        pipeline: memoryPipeline,
        extractors: memoryExtractors,
        processors: memoryProcessors,
        retrieval: Object.freeze({ ...memoryRetrieval, retriever: memoryRetriever }),
    }),
    services: Object.freeze({
        worldInfo,
        lorebooks,
        loreGeneration,
        summary: summaryService,
        summaryStore,
        generation: providers,
        agents: helperRuntime,
        postReply: postReplyDispatcher,
        memory: memoryPipeline,
        retrieval: memoryRetriever,
        context: contextInjector,
        contextBridge,
        nounDetector,
        highlighter,
        notifications,
        popups,
    }),
});
globalThis.NemoLore = publicApi;

lifecycle.start();
try {
    await import('./index.js');

    const legacyInterceptor = globalThis.nemolore_intercept_messages;
    if (typeof legacyInterceptor === 'function') {
        globalThis.nemolore_intercept_messages = wrapGenerationInterceptor(legacyInterceptor);
        logger.info('Installed modular NemoLore generation interceptor.');
    } else {
        logger.warn('Legacy NemoLore interceptor was not found; context bridge remains available manually.');
    }

    postReplyListener.install();
    lifecycle.markLegacyLoaded();
    lifecycle.markReady();
    logger.info('Legacy compatibility module loaded through modular bootstrap.');
} catch (error) {
    lifecycle.fail(error);
    throw error;
}
