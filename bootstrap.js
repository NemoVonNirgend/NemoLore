import { chat_metadata, saveMetadata } from '../../../../script.js';
import {
    createNewWorldInfo,
    deleteWorldInfo,
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    updateWorldInfoList,
    METADATA_KEY,
} from '../../../world-info.js';

import { MODULE_NAME } from './src/core/constants.js';
import { createLogger } from './src/core/logger.js';
import { createSettings } from './src/core/settings.js';
import { createNemoLoreState } from './src/core/state.js';
import { createLifecycle } from './src/core/lifecycle.js';
import { createWorldInfoAdapter } from './src/integrations/world-info-adapter.js';
import { createNounDetector } from './src/lore/noun-detector.js';
import { createLorebookRepository } from './src/lore/lorebook-repository.js';
import { createAtomicFactExtractor } from './src/memory/extractors/atomic-fact-extractor.js';
import { createEpisodeExtractor } from './src/memory/extractors/episode-extractor.js';
import { createStateChangeExtractor } from './src/memory/extractors/state-change-extractor.js';
import { createMemoryStore } from './src/memory/memory-store.js';
import { createMemoryPipeline } from './src/memory/memory-pipeline.js';
import { createSourceLedger } from './src/memory/source-ledger.js';
import { createProviderRegistry } from './src/providers/provider-registry.js';
import { createSillyTavernProvider } from './src/providers/sillytavern-provider.js';
import { createOpenAICompatibleProvider } from './src/providers/openai-compatible-provider.js';
import { createHighlighter } from './src/ui/highlighting.js';
import { createNotificationCenter } from './src/ui/notification-center.js';
import { createPopupCoordinator } from './src/ui/popup-coordinator.js';

const logger = createLogger({ moduleName: MODULE_NAME });
const settings = createSettings();
const state = createNemoLoreState({ logger });
const lifecycle = createLifecycle({ logger, state });

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
const memoryPipeline = createMemoryPipeline({
    store: memoryStore,
    sourceLedger,
    logger,
});

const memoryExtractors = Object.freeze({
    episode: createEpisodeExtractor({ generation: providers, logger }),
    atomicFact: createAtomicFactExtractor({ generation: providers, logger }),
    stateChange: createStateChangeExtractor({ generation: providers, logger }),
});

memoryPipeline.registerExtractor('episode', memoryExtractors.episode);
memoryPipeline.registerExtractor('atomic-fact', memoryExtractors.atomicFact);
memoryPipeline.registerExtractor('state-change', memoryExtractors.stateChange);

const nounDetector = createNounDetector({ settings, logger });
const highlighter = createHighlighter({ settings, state, logger });
const notifications = createNotificationCenter({ logger });
const popups = createPopupCoordinator({ state, logger });

/**
 * Temporary compatibility container exposed during the modular migration.
 *
 * New modules should receive dependencies explicitly. The global bridge exists
 * only so legacy index.js can be migrated incrementally without a flag-day
 * rewrite of the extension.
 */
globalThis.NemoLore = Object.freeze({
    logger,
    settings,
    state,
    lifecycle,
    providers: Object.freeze({
        registry: providers,
        createSillyTavernProvider,
        createOpenAICompatibleProvider,
    }),
    memory: Object.freeze({
        sourceLedger,
        store: memoryStore,
        pipeline: memoryPipeline,
        extractors: memoryExtractors,
    }),
    services: Object.freeze({
        worldInfo,
        lorebooks,
        generation: providers,
        memory: memoryPipeline,
        nounDetector,
        highlighter,
        notifications,
        popups,
    }),
});

lifecycle.start();

try {
    await import('./index.js');
    lifecycle.markLegacyLoaded();
    lifecycle.markReady();
    logger.info('Legacy compatibility module loaded through modular bootstrap.');
} catch (error) {
    lifecycle.fail(error);
    throw error;
}
