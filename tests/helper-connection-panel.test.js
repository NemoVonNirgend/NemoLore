import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelperConnectionPanel } from '../src/ui/helper-connection-panel.js';
import { createSettings } from '../src/core/settings.js';

function fakeDom(t) {
    const previous = { document: globalThis.document, Option: globalThis.Option };
    function node(tag) {
        return {
            tagName: tag, children: [], listeners: {}, value: '', textContent: '', hidden: false,
            append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
            replaceChildren(...children) { this.children = []; this.append(...children); },
            addEventListener(event, handler) { this.listeners[event] = handler; },
            setAttribute() {}, focus() {}, remove() {},
            get options() { return this.children; },
            change(value) { this.value = value; this.listeners.change?.(); },
            click() { this.listeners.click?.(); },
        };
    }
    globalThis.document = { createElement: node };
    globalThis.Option = function (label, value) { return { textContent: label, value }; };
    t.after(() => { Object.assign(globalThis, previous); });
}

function walk(root) { return [root, ...(root.children ?? []).flatMap(child => walk(child))]; }
function visible(node) { return !node.hidden && (!node.parentElement || visible(node.parentElement)); }
function field(panel, label) {
    return walk(panel.element).find(node => node.tagName === 'label' && node.children[0]?.textContent === label && visible(node)).children[1];
}
function button(panel) { return walk(panel.element).find(node => node.tagName === 'button'); }
function status(panel) { return walk(panel.element).find(node => node.className === 'nemolore-helper-status').textContent; }
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(initial = {}, overrides = {}) {
    const settings = createSettings({ settingsSchemaVersion: 2, ...initial });
    const patches = [];
    const connections = {
        sources: () => [{ id: 'vertexai', label: 'Google Vertex AI' }, { id: 'groq', label: 'Groq' }],
        models: source => [{ id: `${source}-model`, label: `${source} model` }, ...(settings.helperConnectionModel ? [{ id: settings.helperConnectionModel, label: settings.helperConnectionModel }] : [])],
        defaultModel: source => `${source}-model`,
        describe: source => ({ endpoint: 'SillyTavern default endpoint', credentials: 'Using credentials saved in SillyTavern.', canRefresh: source !== 'vertexai' }),
        refreshModels: async () => [],
        ...overrides,
    };
    const panel = createHelperConnectionPanel({ settings, connections, update: patch => { patches.push(patch); Object.assign(settings, patch); } });
    return { settings, panel, patches, connections };
}

test('provider and model picks save a complete helper connection and restore after reload', t => {
    fakeDom(t);
    const { panel, settings, patches, connections } = fixture();
    field(panel, 'Provider').change('vertexai');
    assert.deepEqual(patches[0], { helperAgentProvider: 'st-saved', helperConnectionSource: 'vertexai', helperConnectionModel: 'vertexai-model' });
    assert.match(status(panel), /credentials saved in SillyTavern/);
    field(panel, 'Model').change('__custom_model__');
    assert.equal(field(panel, 'Model ID').parentElement.hidden, false);
    field(panel, 'Model ID').change('gemini-4-argon');
    const restored = createHelperConnectionPanel({ settings: createSettings(JSON.parse(JSON.stringify(settings))), connections, update() {} });
    assert.equal(field(restored, 'Provider').value, 'vertexai');
    assert.equal(field(restored, 'Model').value, 'gemini-4-argon');
    assert.equal(settings.asyncApiKey, '');
});

test('manual endpoint presets save the full URL and clear an old manual credential when the endpoint changes', t => {
    fakeDom(t);
    const { panel, settings } = fixture({ helperAgentProvider: 'async', enableAsyncApi: true, asyncApiEndpoint: 'https://old.invalid', asyncApiKey: 'old-key', asyncApiModel: 'old-model' });
    field(panel, 'Endpoint preset').change('https://api.groq.com/openai/v1/chat/completions');
    assert.equal(settings.asyncApiEndpoint, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(settings.asyncApiKey, '');
    field(panel, 'API key (if required)').change('new-key');
    field(panel, 'Chat-completions URL').change(settings.asyncApiEndpoint);
    assert.equal(settings.asyncApiKey, 'new-key');
    field(panel, 'Model ID').change('manual-model');
    assert.equal(settings.asyncApiModel, 'manual-model');
    field(panel, 'Provider').change('current');
    assert.equal(settings.helperAgentProvider, 'sillytavern');
    assert.equal(settings.asyncApiEndpoint, 'https://api.groq.com/openai/v1/chat/completions');
});

test('selecting a provider fetches models and ignores a stale response after switching providers', async t => {
    fakeDom(t);
    let complete;
    let requestSignal;
    const { panel, settings } = fixture({}, { refreshModels: (source, signal) => { requestSignal = signal; return new Promise(resolve => { complete = resolve; }); } });
    field(panel, 'Provider').change('groq');
    assert.match(status(panel), /Loading models/);
    assert.equal(button(panel).disabled, true);
    field(panel, 'Provider').change('vertexai');
    assert.equal(requestSignal.aborted, true);
    complete([]);
    await tick();
    assert.equal(field(panel, 'Provider').value, 'vertexai');
    assert.equal(settings.helperConnectionModel, 'vertexai-model');
    assert.doesNotMatch(status(panel), /Loading|updated/);
    assert.equal(button(panel).disabled, false);
});

test('refresh errors retain the chosen model and remain visible; disposal cancels in-flight listing', async t => {
    fakeDom(t);
    const { panel, settings, connections } = fixture({ helperAgentProvider: 'st-saved', helperConnectionSource: 'groq', helperConnectionModel: 'chosen-model' }, { refreshModels: async () => { throw new Error('Listing failed'); } });
    button(panel).click();
    await tick();
    assert.match(status(panel), /Listing failed/);
    assert.equal(settings.helperConnectionModel, 'chosen-model');
    let requestSignal;
    connections.refreshModels = (source, signal) => { requestSignal = signal; return new Promise(() => {}); };
    button(panel).click();
    panel.dispose();
    assert.equal(requestSignal.aborted, true);
});

test('legacy and unavailable routes are preserved until a replacement is selected', t => {
    fakeDom(t);
    for (const initial of [
        { helperAgentProvider: 'custom-plugin' },
        { helperAgentProvider: 'st-saved', helperConnectionSource: 'removed-source', helperConnectionModel: 'saved-model' },
    ]) {
        const { panel, patches } = fixture(initial);
        assert.match(status(panel), /preserved/);
        assert.equal(patches.length, 0);
        field(panel, 'Provider').change('vertexai');
        assert.equal(patches[0].helperAgentProvider, 'st-saved');
    }
});
