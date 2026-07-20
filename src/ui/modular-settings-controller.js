const FIELDS = Object.freeze({
    enableHelperAgents: { type: 'checkbox', label: 'Enable parallel helper agents' },
    helperAgentConcurrency: { type: 'number', label: 'Concurrent helper jobs', min: 1, max: 6 },
    helperAgentProvider: { type: 'text', label: 'Shared helper provider' },
    helperMemoryProvider: { type: 'text', label: 'Memory provider override' },
    helperSummaryProvider: { type: 'text', label: 'Summary provider override' },
    helperLoreProvider: { type: 'text', label: 'Lore provider override' },
    helperFallbackProvider: { type: 'text', label: 'Fallback provider' },
    helperMemoryAfterReply: { type: 'checkbox', label: 'Run memory after replies' },
    helperSummaryAfterReply: { type: 'checkbox', label: 'Run summary after replies' },
    helperLoreAfterReply: { type: 'checkbox', label: 'Run lore after replies' },
    helperMaxCallsPerReply: { type: 'number', label: 'Maximum helper calls per reply', min: 0, max: 3 },
    helperSummaryMinMessages: { type: 'number', label: 'Summary minimum messages', min: 0, max: 1000 },
    helperLoreMinMessages: { type: 'number', label: 'Lore minimum messages', min: 0, max: 1000 },
    helperLoreRequireSignal: { type: 'checkbox', label: 'Require a lore-worthy signal' },
    helperRequestTimeoutMs: { type: 'number', label: 'Helper request timeout (ms)', min: 1000, max: 300000 },
    helperRetryCount: { type: 'number', label: 'Retry count', min: 0, max: 5 },
    summaryEngineMode: {
        type: 'select',
        label: 'Summary engine (reload required)',
        options: ['legacy', 'modular'],
    },
    loreEngineMode: {
        type: 'select',
        label: 'Automatic lore engine (reload required)',
        options: ['legacy', 'modular'],
    },
    summaryInputMaxMessages: { type: 'number', label: 'Summary input window', min: 2, max: 500 },
    enableSummaryContext: { type: 'checkbox', label: 'Inject conversation summary' },
    summaryContextPrecedence: {
        type: 'select',
        label: 'Summary precedence',
        options: ['new-first', 'legacy-first', 'new-only', 'legacy-only'],
    },
    enableObservability: { type: 'checkbox', label: 'Enable observability history' },
});

function createControl(key, definition, settings, onChange) {
    const row = document.createElement('div');
    row.className = 'flex-container';
    const label = document.createElement('label');
    label.htmlFor = `nemolore_modular_${key}`;
    label.textContent = definition.label;

    let input;
    if (definition.type === 'select') {
        input = document.createElement('select');
        for (const value of definition.options) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            input.append(option);
        }
    } else {
        input = document.createElement('input');
        input.type = definition.type;
        if (definition.min != null) input.min = String(definition.min);
        if (definition.max != null) input.max = String(definition.max);
    }

    input.id = `nemolore_modular_${key}`;
    input.classList.add('text_pole');
    if (definition.type === 'checkbox') {
        input.checked = Boolean(settings[key]);
        label.classList.add('checkbox_label');
        label.prepend(input);
    } else {
        input.value = settings[key] ?? '';
        row.append(label, input);
    }
    if (definition.type === 'checkbox') row.append(label);

    input.addEventListener('change', () => {
        const value = definition.type === 'checkbox'
            ? input.checked
            : definition.type === 'number'
                ? Number(input.value)
                : input.value;
        onChange(key, value);
    });
    return row;
}

export function createModularSettingsController({ settings, save, observability, providerRouter, logger } = {}) {
    let root = null;
    let summaryDisplay = null;

    async function installSummaryDisplay() {
        if (summaryDisplay || !globalThis.NemoLore?.summary?.store) return false;
        const { createSummaryDisplayController } = await import('./summary-display-controller.js');
        summaryDisplay = createSummaryDisplayController({
            summaryStore: globalThis.NemoLore.summary.store,
            settings,
            getChatId: () => globalThis.NemoLore?.memory?.persistence?.activeChatId ?? null,
            logger,
        });
        return summaryDisplay.install();
    }

    function install(container = document.querySelector('#nemo-ext-nemolore .inline-drawer-content')) {
        if (!container || root?.isConnected) return false;
        root = document.createElement('div');
        root.className = 'inline-drawer nemolore-modular-settings';

        const header = document.createElement('div');
        header.className = 'inline-drawer-toggle inline-drawer-header';
        const title = document.createElement('b');
        title.textContent = 'Parallel Helpers & Context';
        header.append(title);

        const body = document.createElement('div');
        body.className = 'inline-drawer-content';
        const onChange = (key, value) => {
            settings[key] = value;
            save?.(settings);
            if (key.includes('Provider')) providerRouter?.resetCircuit?.();
            if (key === 'showSummariesInChat') summaryDisplay?.refresh?.();
        };
        for (const [key, definition] of Object.entries(FIELDS)) {
            body.append(createControl(key, definition, settings, onChange));
        }

        const actions = document.createElement('div');
        actions.className = 'flex-container';
        const inspect = document.createElement('button');
        inspect.type = 'button';
        inspect.className = 'menu_button';
        inspect.textContent = 'Open NemoLore Inspector';
        inspect.addEventListener('click', () => void observability?.openPanel?.());
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'menu_button';
        reset.textContent = 'Reset Provider Circuits';
        reset.addEventListener('click', () => providerRouter?.resetCircuit?.());
        actions.append(inspect, reset);
        body.append(actions);

        root.append(header, body);
        container.prepend(root);
        void installSummaryDisplay();
        logger?.debug('Installed modular NemoLore settings controls.');
        return true;
    }

    function uninstall() {
        summaryDisplay?.uninstall?.();
        summaryDisplay = null;
        root?.remove();
        root = null;
    }

    return Object.freeze({
        install,
        uninstall,
        installSummaryDisplay,
        get element() { return root; },
        get summaryDisplay() { return summaryDisplay; },
    });
}
