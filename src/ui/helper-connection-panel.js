import { SAVED_HELPER_PROVIDER } from '../integrations/sillytavern-helper-connections.js';

const MANUAL = 'manual';
const CURRENT = 'current';
const CUSTOM_MODEL = '__custom_model__';
const ENDPOINTS = [
    ['OpenAI', 'https://api.openai.com/v1/chat/completions'],
    ['OpenRouter', 'https://openrouter.ai/api/v1/chat/completions'],
    ['Mistral AI', 'https://api.mistral.ai/v1/chat/completions'],
    ['Groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['DeepSeek', 'https://api.deepseek.com/chat/completions'],
    ['xAI', 'https://api.x.ai/v1/chat/completions'],
];

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function field(parent, label, tag = 'select', type = 'text') {
    const row = element('label', null, 'nemolore-helper-field');
    row.append(element('span', label));
    const input = element(tag, null, 'text_pole');
    if (tag === 'input') input.type = type;
    row.append(input);
    parent.append(row);
    return input;
}

function options(select, entries, selected) {
    select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
    select.value = selected;
}

export function createHelperConnectionPanel({ settings, connections, update } = {}) {
    const root = element('section', null, 'nemolore-helper-connection');
    root.append(element('h4', 'Helper connection'));
    const enabledLabel = element('label', null, 'checkbox_label');
    const enabled = element('input');
    enabled.type = 'checkbox';
    enabledLabel.append(enabled, element('span', 'Enable helper agents'));
    root.append(enabledLabel);
    enabled.addEventListener('change', () => update({ enableHelperAgents: enabled.checked }));
    const provider = field(root, 'Provider');
    const native = element('div');
    const model = field(native, 'Model');
    const customModel = field(native, 'Model ID', 'input');
    customModel.placeholder = 'Enter the exact model ID';
    const refresh = element('button', 'Refresh models', 'menu_button');
    refresh.type = 'button';
    native.append(refresh);
    root.append(native);
    const manual = element('div');
    const endpointPreset = field(manual, 'Endpoint preset');
    options(endpointPreset, [['', 'Custom URL'], ...ENDPOINTS.map(([label, url]) => [url, label])], '');
    const endpoint = field(manual, 'Chat-completions URL', 'input', 'url');
    endpoint.placeholder = 'https://…/v1/chat/completions';
    const apiKey = field(manual, 'API key (if required)', 'input', 'password');
    apiKey.autocomplete = 'new-password';
    const manualModel = field(manual, 'Model ID', 'input');
    manual.append(element('small', 'For saved SillyTavern credentials, choose that provider above. Manual keys are saved in NemoLore settings.'));
    root.append(manual);
    const status = element('p', null, 'nemolore-helper-status');
    status.setAttribute('role', 'status');
    root.append(status);
    let editingCustom = false;
    let refreshId = 0;
    let refreshController = null;
    let refreshMessage = '';
    let disposed = false;

    function selection() {
        if (settings.helperAgentProvider === SAVED_HELPER_PROVIDER) return settings.helperConnectionSource;
        if (settings.helperAgentProvider === 'async') return MANUAL;
        if (!settings.helperAgentProvider || settings.helperAgentProvider === 'sillytavern') return CURRENT;
        return `legacy:${settings.helperAgentProvider}`;
    }

    function sync() {
        if (disposed) return;
        const selected = selection();
        const available = connections?.sources() ?? [];
        const entries = [[CURRENT, 'Use current chat connection'], ...available.map(source => [source.id, source.label]), [MANUAL, 'Manual OpenAI-compatible endpoint']];
        if (!entries.some(([id]) => id === selected)) entries.push([selected, `Existing route: ${settings.helperConnectionSource || settings.helperAgentProvider}`]);
        options(provider, entries, selected);
        enabled.checked = Boolean(settings.enableHelperAgents);
        native.hidden = !available.some(source => source.id === selected);
        manual.hidden = selected !== MANUAL;
        if (!native.hidden) {
            const models = connections.models(selected);
            const saved = settings.helperConnectionModel || '';
            options(model, [['', 'Choose a model…'], ...models.map(item => [item.id, item.label]), [CUSTOM_MODEL, 'Enter another model ID…']], editingCustom ? CUSTOM_MODEL : saved);
            customModel.parentElement.hidden = !editingCustom;
            customModel.value = saved;
            const description = connections.describe(selected);
            refresh.textContent = description.canRefresh ? 'Refresh models' : 'Reload SillyTavern model list';
            status.textContent = `${description.endpoint}. ${description.credentials} ${refreshMessage || 'Models come from SillyTavern’s catalogue; availability depends on your account.'}`;
        } else if (selected === MANUAL) {
            endpoint.value = settings.asyncApiEndpoint || '';
            apiKey.value = settings.asyncApiKey || '';
            manualModel.value = settings.asyncApiModel || '';
            endpointPreset.value = ENDPOINTS.some(([, url]) => url === endpoint.value) ? endpoint.value : '';
            status.textContent = 'Choose an endpoint preset or enter a full URL, then a model. Changes save automatically.';
        } else {
            status.textContent = selected === CURRENT ? 'Helpers use the active SillyTavern connection and model. Changes save automatically.' : 'This existing provider route is preserved. Choose an available provider above to replace it.';
        }
    }

    provider.addEventListener('change', () => {
        refreshController?.abort();
        refreshId++;
        refresh.disabled = false;
        refreshMessage = '';
        editingCustom = false;
        if (provider.value === CURRENT) update({ helperAgentProvider: 'sillytavern' });
        else if (provider.value === MANUAL) update({ helperAgentProvider: 'async', enableAsyncApi: true });
        else if (!provider.value.startsWith('legacy:')) update({
            helperAgentProvider: SAVED_HELPER_PROVIDER,
            helperConnectionSource: provider.value,
            helperConnectionModel: connections.defaultModel(provider.value),
        });
        sync();
        if (!native.hidden && connections.describe(settings.helperConnectionSource).canRefresh) void refreshModels();
    });
    model.addEventListener('change', () => {
        editingCustom = model.value === CUSTOM_MODEL;
        if (!editingCustom) update({ helperConnectionModel: model.value });
        sync();
        if (editingCustom) customModel.focus();
    });
    customModel.addEventListener('change', () => {
        const value = customModel.value.trim();
        if (!value) return;
        editingCustom = false;
        update({ helperConnectionModel: value });
        sync();
    });
    async function refreshModels() {
        refreshController?.abort();
        refreshController = new AbortController();
        const id = ++refreshId;
        const source = settings.helperConnectionSource;
        refresh.disabled = true;
        refreshMessage = 'Loading models…';
        sync();
        try {
            await connections.refreshModels(source, refreshController.signal);
            if (disposed || id !== refreshId) return;
            refreshMessage = 'Model list updated. Your selected model is unchanged.';
        } catch (error) {
            if (disposed || id !== refreshId) return;
            refreshMessage = error.message;
        } finally {
            if (!disposed && id === refreshId) {
                refresh.disabled = false;
                sync();
            }
        }
    }
    refresh.addEventListener('click', () => void refreshModels());
    function setEndpoint(value) {
        const changed = value !== settings.asyncApiEndpoint;
        update({ asyncApiEndpoint: value, ...(changed ? { asyncApiKey: '' } : {}) });
        sync();
    }
    endpointPreset.addEventListener('change', () => {
        if (endpointPreset.value) setEndpoint(endpointPreset.value);
        else endpoint.focus();
    });
    endpoint.addEventListener('change', () => setEndpoint(endpoint.value.trim()));
    apiKey.addEventListener('change', () => update({ asyncApiKey: apiKey.value }));
    manualModel.addEventListener('change', () => update({ asyncApiModel: manualModel.value.trim() }));
    sync();
    return {
        element: root, sync,
        dispose() { disposed = true; refreshId++; refreshController?.abort(); root.remove(); },
    };
}
