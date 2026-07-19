export function createLifecycle({ logger, state }) {
    let phase = 'created';
    let failure = null;

    function transition(nextPhase) {
        phase = nextPhase;
        logger.debug(`Lifecycle entered ${nextPhase}.`);
    }

    return Object.freeze({
        start() {
            transition('starting');
            state.isInitialized = false;
        },

        markLegacyLoaded() {
            transition('legacy-loaded');
        },

        markReady() {
            transition('ready');
            state.isInitialized = true;
        },

        fail(error) {
            failure = error;
            transition('failed');
            logger.error('Extension startup failed.', error);
        },

        dispose() {
            state.reset();
            transition('disposed');
        },

        snapshot() {
            return Object.freeze({ phase, failure });
        },
    });
}
