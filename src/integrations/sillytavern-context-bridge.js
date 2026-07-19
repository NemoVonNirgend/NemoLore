import { CONTEXT_POSITIONS } from '../context/context-contribution.js';

const DEFAULT_SLOTS = Object.freeze({
    [CONTEXT_POSITIONS.BEFORE_SYSTEM]: Object.freeze({ id: 'nemolore:before-system' }),
    [CONTEXT_POSITIONS.AFTER_SYSTEM]: Object.freeze({ id: 'nemolore:after-system' }),
    [CONTEXT_POSITIONS.BEFORE_CHAT]: Object.freeze({ id: 'nemolore:before-chat' }),
    [CONTEXT_POSITIONS.AFTER_CHAT]: Object.freeze({ id: 'nemolore:after-chat' }),
});

export function createSillyTavernContextBridge({
    injector,
    promptAdapter,
    slotConfig = {},
    logger,
} = {}) {
    if (!injector?.inject) throw new TypeError('SillyTavern context bridge requires an injector.');
    if (!promptAdapter?.write || !promptAdapter?.clear) {
        throw new TypeError('SillyTavern context bridge requires a prompt adapter.');
    }

    const slots = Object.freeze(Object.fromEntries(
        Object.entries(DEFAULT_SLOTS).map(([position, defaults]) => [
            position,
            Object.freeze({ ...defaults, ...(slotConfig[position] ?? {}) }),
        ]),
    ));

    let lastPackage = null;

    function syncPackage(contextPackage) {
        for (const [position, slot] of Object.entries(slots)) {
            const content = contextPackage.byPosition?.[position] ?? '';
            promptAdapter.write(slot.id, content, slot);
        }
        lastPackage = contextPackage;
        logger?.debug('Synchronized context package with SillyTavern.', {
            selected: contextPackage.selected?.length ?? 0,
            usedTokens: contextPackage.usedTokens ?? 0,
        });
        return contextPackage;
    }

    async function refresh(request = {}, options = {}) {
        const contextPackage = await injector.inject(request, options);
        return syncPackage(contextPackage);
    }

    function clear() {
        for (const slot of Object.values(slots)) promptAdapter.clear(slot.id, slot);
        lastPackage = null;
    }

    function inspect() {
        return lastPackage;
    }

    return Object.freeze({
        refresh,
        syncPackage,
        clear,
        inspect,
        slots,
    });
}
