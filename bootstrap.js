import { MODULE_NAME } from './src/core/constants.js';
import { createLogger } from './src/core/logger.js';
import { createSettings } from './src/core/settings.js';
import { createNemoLoreState } from './src/core/state.js';
import { createLifecycle } from './src/core/lifecycle.js';
import { createNounDetector } from './src/lore/noun-detector.js';
import { createHighlighter } from './src/ui/highlighting.js';

const logger = createLogger({ moduleName: MODULE_NAME });
const settings = createSettings();
const state = createNemoLoreState({ logger });
const lifecycle = createLifecycle({ logger, state });
const nounDetector = createNounDetector({ settings, logger });
const highlighter = createHighlighter({ settings, state, logger });

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
    services: Object.freeze({
        nounDetector,
        highlighter,
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
