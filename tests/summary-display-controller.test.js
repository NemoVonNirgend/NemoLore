import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryDisplayController } from '../src/ui/summary-display-controller.js';
<<<<<<< HEAD
import { createModularSettingsController } from '../src/ui/modular-settings-controller.js';
=======
>>>>>>> dev/preset-architecture

function createElement(tagName) {
    return {
        tagName: String(tagName).toUpperCase(),
        className: '',
        dataset: {},
        textContent: '',
        children: [],
        parentNode: null,
        attributes: new Map(),
        append(...children) {
            for (const child of children) {
                child.parentNode = this;
                this.children.push(child);
            }
        },
        remove() {
            if (!this.parentNode) return;
            const index = this.parentNode.children.indexOf(this);
            if (index >= 0) this.parentNode.children.splice(index, 1);
            this.parentNode = null;
        },
        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        },
    };
}

function installFakeDocument() {
    const previous = globalThis.document;
    const chatRoot = createElement('div');
    const message = createElement('div');
    message.className = 'mes';
    message.attributes.set('mesid', '1');
    chatRoot.append(message);
    chatRoot.querySelectorAll = selector => selector === '.mes' ? [message] : [];
    chatRoot.querySelector = selector => selector === '.mes:last-child' ? message : null;
    globalThis.document = {
        createElement,
        querySelector: selector => selector === '#chat' ? chatRoot : null,
    };
    return {
        chatRoot,
        message,
        restore() {
            if (previous === undefined) delete globalThis.document;
            else globalThis.document = previous;
        },
    };
}

function createEventSource() {
    const listeners = new Map();
    return {
        on(event, listener) {
            const handlers = listeners.get(event) ?? [];
            handlers.push(listener);
            listeners.set(event, handlers);
        },
        off(event, listener) {
            listeners.set(event, (listeners.get(event) ?? []).filter(handler => handler !== listener));
        },
        emit(event, payload) {
            for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
        },
        count(event) {
            return (listeners.get(event) ?? []).length;
        },
    };
}

function createSummaryStore(records) {
    const listeners = new Set();
    let subscriptions = 0;
    let unsubscriptions = 0;
    return {
        get(chatId) {
            return records.get(String(chatId)) ?? null;
        },
        subscribe(listener) {
            subscriptions += 1;
            listeners.add(listener);
            return () => {
                if (listeners.delete(listener)) unsubscriptions += 1;
            };
        },
        emit(event, record) {
            for (const listener of listeners) listener(event, record);
        },
        inspect() {
            return { subscriptions, unsubscriptions, listeners: listeners.size };
        },
    };
}

function records() {
    return new Map([
        ['chat-a', { chatId: 'chat-a', text: 'Summary A', sourceRange: { end: 1 } }],
        ['chat-b', { chatId: 'chat-b', text: 'Summary B', sourceRange: { end: 1 } }],
    ]);
}

test('refreshes the rendered summary when SillyTavern changes chats', () => {
    const dom = installFakeDocument();
    try {
        let chatId = 'chat-a';
        const eventSource = createEventSource();
        const controller = createSummaryDisplayController({
            summaryStore: createSummaryStore(records()),
            settings: { showSummariesInChat: true },
            getChatId: () => chatId,
            eventSource,
            chatChangedEvent: 'chat-changed',
            chatLoadedEvent: 'chat-loaded',
        });

        assert.equal(controller.install(), true);
        assert.equal(controller.element.dataset.nemoloreSummary, 'chat-a');
        assert.equal(controller.element.children[1].textContent, 'Summary A');

        chatId = 'chat-b';
        eventSource.emit('chat-changed', chatId);

        assert.equal(controller.element.dataset.nemoloreSummary, 'chat-b');
        assert.equal(controller.element.children[1].textContent, 'Summary B');
        assert.equal(dom.message.children.length, 1, 'old summary element should be removed before rendering the new chat');
    } finally {
        dom.restore();
    }
});

test('installs and removes summary store and chat listeners idempotently', () => {
    const dom = installFakeDocument();
    try {
        const eventSource = createEventSource();
        const summaryStore = createSummaryStore(records());
        const controller = createSummaryDisplayController({
            summaryStore,
            settings: { showSummariesInChat: true },
            getChatId: () => 'chat-a',
            eventSource,
            chatChangedEvent: 'chat-changed',
            chatLoadedEvent: 'chat-loaded',
        });

        assert.equal(controller.install(), true);
        assert.equal(controller.install(), false);
        assert.deepEqual(summaryStore.inspect(), { subscriptions: 1, unsubscriptions: 0, listeners: 1 });
        assert.equal(eventSource.count('chat-changed'), 1);
        assert.equal(eventSource.count('chat-loaded'), 1);

        assert.equal(controller.uninstall(), true);
        assert.equal(controller.uninstall(), false);
        assert.deepEqual(summaryStore.inspect(), { subscriptions: 1, unsubscriptions: 1, listeners: 0 });
        assert.equal(eventSource.count('chat-changed'), 0);
        assert.equal(eventSource.count('chat-loaded'), 0);

        assert.equal(controller.install(), true);
        assert.equal(eventSource.count('chat-changed'), 1);
        assert.equal(eventSource.count('chat-loaded'), 1);
        assert.equal(controller.uninstall(), true);
    } finally {
        dom.restore();
    }
});
<<<<<<< HEAD

test('modular settings controller forwards host chat lifecycle integration', async () => {
    const dom = installFakeDocument();
    const previousNemoLore = globalThis.NemoLore;
    try {
        let chatId = 'chat-a';
        const eventSource = createEventSource();
        globalThis.NemoLore = { summary: { store: createSummaryStore(records()) } };
        const settingsController = createModularSettingsController({
            settings: { showSummariesInChat: true },
            getChatId: () => chatId,
            eventSource,
            chatChangedEvent: 'chat-changed',
            chatLoadedEvent: 'chat-loaded',
        });

        assert.equal(await settingsController.installSummaryDisplay(), true);
        chatId = 'chat-b';
        eventSource.emit('chat-loaded', { chatId });

        assert.equal(settingsController.summaryDisplay.element.dataset.nemoloreSummary, 'chat-b');
        settingsController.uninstall();
        assert.equal(eventSource.count('chat-changed'), 0);
        assert.equal(eventSource.count('chat-loaded'), 0);
    } finally {
        if (previousNemoLore === undefined) delete globalThis.NemoLore;
        else globalThis.NemoLore = previousNemoLore;
        dom.restore();
    }
});
=======
>>>>>>> dev/preset-architecture
