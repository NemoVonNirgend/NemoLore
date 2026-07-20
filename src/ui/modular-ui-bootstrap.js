const DEFAULT_EXTENSION_PATH = 'third-party/NemoLore';

function defaultMount(html) {
    const container = document.querySelector('#extensions_settings2');
    if (!container) throw new Error('SillyTavern extension settings container was not found.');
    container.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById('nemo-ext-nemolore');
    const host = root?.querySelector('[data-nemolore-modular-host]');
    if (!root || !host) throw new Error('NemoLore modular settings template is missing its host.');
    return { root, host };
}

export function createModularUiBootstrap({
    renderTemplate,
    settingsController,
    extensionPath = DEFAULT_EXTENSION_PATH,
    mount = defaultMount,
    logger,
} = {}) {
    if (typeof renderTemplate !== 'function') throw new TypeError('Modular UI bootstrap requires renderTemplate().');
    if (!settingsController?.install) throw new TypeError('Modular UI bootstrap requires a settings controller.');
    let mounted = null;

    async function install() {
        if (mounted?.root?.isConnected !== false && mounted) return false;
        const html = await renderTemplate(extensionPath, 'settings');
        mounted = mount(html);
        if (!mounted?.host) throw new Error('Unable to mount NemoLore modular settings.');
        if (!settingsController.install(mounted.host)) throw new Error('Unable to install NemoLore modular settings controls.');
        logger?.info('Installed standalone NemoLore modular UI.');
        return true;
    }

    function uninstall() {
        settingsController.uninstall?.();
        mounted?.root?.remove?.();
        mounted = null;
    }

    return Object.freeze({ install, uninstall, get element() { return mounted?.root ?? null; } });
}
