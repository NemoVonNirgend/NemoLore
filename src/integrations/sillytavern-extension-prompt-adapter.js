const DEFAULT_SLOT_CONFIG = Object.freeze({
    position: 0,
    depth: 0,
    scan: false,
    role: 0,
});

export function createSillyTavernExtensionPromptAdapter({
    resolveContext,
    setExtensionPrompt,
    logger,
} = {}) {
    if (typeof resolveContext !== 'function') {
        throw new TypeError('SillyTavern prompt adapter requires resolveContext().');
    }

    function resolveWriter() {
        if (typeof setExtensionPrompt === 'function') return setExtensionPrompt;
        const context = resolveContext();
        if (typeof context?.setExtensionPrompt === 'function') {
            return context.setExtensionPrompt.bind(context);
        }
        throw new Error('SillyTavern setExtensionPrompt API is unavailable.');
    }

    function write(slotId, content, config = {}) {
        if (!slotId) throw new TypeError('Extension prompt slot id is required.');
        const writer = resolveWriter();
        const settings = { ...DEFAULT_SLOT_CONFIG, ...config };
        writer(
            slotId,
            String(content ?? ''),
            settings.position,
            settings.depth,
            settings.scan,
            settings.role,
        );
        logger?.debug('Updated SillyTavern extension prompt slot.', {
            slotId,
            hasContent: Boolean(String(content ?? '').trim()),
            position: settings.position,
            depth: settings.depth,
        });
    }

    function clear(slotId, config = {}) {
        write(slotId, '', config);
    }

    return Object.freeze({ write, clear });
}
