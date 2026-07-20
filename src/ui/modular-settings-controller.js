import { PRESET_SETTING_KEYS, listPresets } from '../presets/preset-registry.js';
import { selectPreset, setPresetOverride } from '../core/settings.js';

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
    summaryInputMaxMessages: { type: 'number', label: 'Summary input window', min: 2, max: 500 },
    runningMemorySize: { type: 'number', label: 'Recent visible message window', min: 1, max: 1000 },
    summaryChunkSize: { type: 'number', label: 'Summary consolidation chunk size', min: 0, max: 100 },
    episodePromotionThreshold: { type: 'number', label: 'Episode promotion threshold', min: 0, max: 100 },
    episodePromotionSourceMode: { type: 'select', label: 'Promoted episode source records', options: ['archive', 'retain'] },
    enableSummaryContext: { type: 'checkbox', label: 'Inject conversation summary' },
    hideMessagesWhenThreshold: { type: 'checkbox', label: 'Hide messages outside the recent window' },
    enableCoreMemories: { type: 'checkbox', label: 'Enable core memories' },
    coreMemoryStartCount: { type: 'number', label: 'Core-memory promotion start', min: 1, max: 1000 },
    coreMemoryImportanceThreshold: { type: 'number', label: 'Core-memory importance threshold', min: 0, max: 1 },
    coreMemoryMaxPromotionsPerRun: { type: 'number', label: 'Core promotions per maintenance run', min: 1, max: 20 },
    enableVectorization: { type: 'checkbox', label: 'Enable semantic vector retrieval' },
    vectorSearchLimit: { type: 'number', label: 'Semantic retrieval result limit', min: 1, max: 50 },
    vectorSimilarityThreshold: { type: 'number', label: 'Semantic similarity threshold', min: 0.1, max: 1 },
    memoryAgingEnabled: { type: 'checkbox', label: 'Enable memory aging' },
    memoryAgingGraceMessages: { type: 'number', label: 'Memory aging grace (messages)', min: 0, max: 10000 },
    memoryAgingRate: { type: 'number', label: 'Memory aging rate', min: 0, max: 1 },
    memoryAgingFloor: { type: 'number', label: 'Memory aging retrieval floor', min: 0, max: 1 },
    memoryConsolidationEnabled: { type: 'checkbox', label: 'Enable memory consolidation' },
    memoryConsolidationMinRecords: { type: 'number', label: 'Records needed for consolidation', min: 2, max: 100 },
    memoryConsolidationBatchSize: { type: 'number', label: 'Consolidation batch size', min: 2, max: 100 },
    memoryConsolidationSourceMode: { type: 'select', label: 'Consolidated source records', options: ['archive', 'retain'] },
    memoryContextBudget: { type: 'number', label: 'Memory context token budget', min: 100, max: 20000 },
    memoryCandidateLimit: { type: 'number', label: 'Memory retrieval candidate limit', min: 1, max: 500 },
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
        for (const value of definition.options) input.append(new Option(value, value));
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
        row.append(label);
    } else {
        input.value = settings[key] ?? '';
        row.append(label, input);
    }
    input.addEventListener('change', () => {
        const value = definition.type === 'checkbox' ? input.checked : definition.type === 'number' ? Number(input.value) : input.value;
        onChange(key, value);
    });
    return { row, input };
}

export function createModularSettingsController({ settings, save, observability, providerRouter, onPolicyChange, logger } = {}) {
    let root = null;
    let summaryDisplay = null;
    let memoryPanel = null;
    let summaryLorePanel = null;
    let profileStatus = null;
    const controls = new Map();
    const presetButtons = new Map();

    function profileLabel() {
        const preset = listPresets().find(candidate => candidate.id === settings.preset);
        return `${preset?.name ?? settings.preset}${Object.keys(settings.presetOverrides ?? {}).length ? ' — Customized' : ''}`;
    }

    function syncUi() {
        if (profileStatus) profileStatus.textContent = `Active profile: ${profileLabel()}`;
        for (const [id, button] of presetButtons) {
            const selected = id === settings.preset;
            button.classList.toggle('nemolore-preset-card-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
        }
        for (const [key, { input, definition }] of controls) {
            if (definition.type === 'checkbox') input.checked = Boolean(settings[key]);
            else input.value = settings[key] ?? '';
        }
    }

    function setSetting(key, value) {
        if (PRESET_SETTING_KEYS.includes(key)) Object.assign(settings, setPresetOverride(settings, key, value));
        else settings[key] = value;
        save?.(settings);
        if (key.includes('Provider')) providerRouter?.resetCircuit?.();
        if (key === 'showSummariesInChat') summaryDisplay?.refresh?.();
        if (PRESET_SETTING_KEYS.includes(key)) onPolicyChange?.(settings);
        syncUi();
        return value;
    }

    function applyPreset(id) {
        Object.assign(settings, selectPreset(settings, id));
        save?.(settings);
        providerRouter?.resetCircuit?.();
        onPolicyChange?.(settings);
        syncUi();
        logger?.info('Selected NemoLore story profile.', { preset: id });
        return settings;
    }

    function createPresetCards() {
        const section = document.createElement('section');
        section.className = 'nemolore-preset-section';
        const introduction = document.createElement('p');
        introduction.textContent = 'Choose how NemoLore should remember this kind of story. The profile configures summaries, memories, retrieval, lore, and context automatically.';
        profileStatus = document.createElement('p');
        profileStatus.className = 'nemolore-preset-status';
        const grid = document.createElement('div');
        grid.className = 'nemolore-preset-grid';
        for (const preset of listPresets()) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'nemolore-preset-card';
            const heading = document.createElement('span');
            heading.className = 'nemolore-preset-card-title';
            heading.textContent = preset.name;
            if (preset.recommended) {
                const badge = document.createElement('small');
                badge.textContent = 'Recommended';
                heading.append(badge);
            }
            const description = document.createElement('span');
            description.className = 'nemolore-preset-card-description';
            description.textContent = preset.description;
            const features = document.createElement('span');
            features.className = 'nemolore-preset-card-features';
            features.textContent = preset.features.join(' · ');
            button.append(heading, description, features);
            button.addEventListener('click', () => applyPreset(preset.id));
            presetButtons.set(preset.id, button);
            grid.append(button);
        }
        section.append(introduction, profileStatus, grid);
        if (settings.presetMigration) {
            const migration = document.createElement('p');
            migration.className = 'nemolore-preset-migration';
            migration.textContent = `Existing settings were matched to ${profileLabel()} and migrated to the modular runtime. The previous policy is retained only in the migration audit record.`;
            section.append(migration);
        }
        return section;
    }

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

    async function openMemoryManager() {
        if (!globalThis.NemoLore?.memory?.store) return false;
        if (!memoryPanel) {
            const [{ createMemoryManagementService }, { createMemoryManagementPanel }] = await Promise.all([
                import('../memory/memory-management-service.js'),
                import('./memory-management-panel.js'),
            ]);
            memoryPanel = createMemoryManagementPanel({
                management: createMemoryManagementService({ store: globalThis.NemoLore.memory.store, logger }),
                logger,
            });
        }
        memoryPanel.open();
        return true;
    }

    async function openSummaryLoreManager() {
        if (!globalThis.NemoLore?.summary?.store || !globalThis.NemoLore?.lore?.repository) return false;
        if (!summaryLorePanel) {
            const { createSummaryLoreManagementPanel } = await import('./summary-lore-management-panel.js');
            summaryLorePanel = createSummaryLoreManagementPanel({ nemo: globalThis.NemoLore, logger });
        }
        await summaryLorePanel.open();
        return true;
    }

    function install(container = document.querySelector('#nemo-ext-nemolore .inline-drawer-content')) {
        if (!container || root?.isConnected) return false;
        root = document.createElement('div');
        root.className = 'inline-drawer nemolore-modular-settings';
        const header = document.createElement('div');
        header.className = 'inline-drawer-toggle inline-drawer-header';
        const title = document.createElement('b');
        title.textContent = 'NemoLore Story Profile';
        header.append(title);
        const body = document.createElement('div');
        body.className = 'inline-drawer-content';
        body.append(createPresetCards());

        const advanced = document.createElement('details');
        advanced.className = 'nemolore-preset-advanced';
        const advancedTitle = document.createElement('summary');
        advancedTitle.textContent = 'Advanced tuning';
        const advancedDescription = document.createElement('p');
        advancedDescription.textContent = 'Changing profile-controlled values creates a custom variant. Some scheduling changes require reloading SillyTavern.';
        advanced.append(advancedTitle, advancedDescription);
        for (const [key, definition] of Object.entries(FIELDS)) {
            const control = createControl(key, definition, settings, setSetting);
            controls.set(key, { input: control.input, definition });
            advanced.append(control.row);
        }
        body.append(advanced);

        const actions = document.createElement('div');
        actions.className = 'flex-container';
        const memories = document.createElement('button');
        memories.type = 'button';
        memories.className = 'menu_button';
        memories.textContent = 'Manage Memories';
        memories.addEventListener('click', () => void openMemoryManager());
        const summaryLore = document.createElement('button');
        summaryLore.type = 'button';
        summaryLore.className = 'menu_button';
        summaryLore.textContent = 'Manage Summary & Lore';
        summaryLore.addEventListener('click', () => void openSummaryLoreManager());
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
        actions.append(memories, summaryLore, inspect, reset);
        body.append(actions);
        root.append(header, body);
        container.prepend(root);
        syncUi();
        void installSummaryDisplay();
        logger?.debug('Installed modular NemoLore settings controls.');
        return true;
    }

    function uninstall() {
        summaryLorePanel?.close?.();
        summaryLorePanel = null;
        memoryPanel?.close?.();
        memoryPanel = null;
        summaryDisplay?.uninstall?.();
        summaryDisplay = null;
        root?.remove();
        root = null;
        profileStatus = null;
        controls.clear();
        presetButtons.clear();
    }

    return Object.freeze({
        install,
        uninstall,
        set: setSetting,
        selectPreset: applyPreset,
        installSummaryDisplay,
        openMemoryManager,
        openSummaryLoreManager,
        get element() { return root; },
        get summaryDisplay() { return summaryDisplay; },
        get memoryPanel() { return memoryPanel; },
        get summaryLorePanel() { return summaryLorePanel; },
    });
}
