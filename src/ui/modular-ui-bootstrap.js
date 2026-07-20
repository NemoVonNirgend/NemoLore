const DEFAULT_EXTENSION_PATH = 'third-party/NemoLore';
const DEFAULT_MOUNT_ATTEMPTS = 40;
const DEFAULT_RETRY_DELAY_MS = 50;

function defaultMount(html) {
    const container = document.querySelector('#extensions_settings2');
    if (!container) return null;

    let root = document.getElementById('nemo-ext-nemolore');
    if (!root) {
        container.insertAdjacentHTML('beforeend', html);
        root = document.getElementById('nemo-ext-nemolore');
    }
    if (!root) return null;

    const host = root.querySelector('[data-nemolore-modular-host]')
        ?? root.querySelector('.inline-drawer-content');
    if (!host) return null;
    return { root, host };
}

function defaultWait(delayMs) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

export function createModularUiBootstrap({
    renderTemplate,
    settingsController,
    extensionPath = DEFAULT_EXTENSION_PATH,
    mount = defaultMount,
    mountAttempts = DEFAULT_MOUNT_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    wait = defaultWait,
    logger,
} = {}) {
    if (typeof renderTemplate !== 'function') throw new TypeError('Modular UI bootstrap requires renderTemplate().');
    if (!settingsController?.install) throw new TypeError('Modular UI bootstrap requires a settings controller.');
    if (!Number.isInteger(mountAttempts) || mountAttempts < 1) throw new TypeError('Modular UI bootstrap requires at least one mount attempt.');
    if (typeof wait !== 'function') throw new TypeError('Modular UI bootstrap requires wait().');
    let mounted = null;

    async function install() {
        if (mounted?.root?.isConnected !== false && mounted) return false;
        const html = await renderTemplate(extensionPath, 'settings');

        for (let attempt = 1; attempt <= mountAttempts; attempt += 1) {
            mounted = mount(html);
            if (mounted?.host) break;
            mounted = null;
            if (attempt < mountAttempts) await wait(retryDelayMs);
        }

        if (!mounted?.host) {
            throw new Error(`Unable to mount NemoLore modular settings after ${mountAttempts} attempt${mountAttempts === 1 ? '' : 's'}.`);
        }
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
