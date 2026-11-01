import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryDisplayController } from '../src/ui/summary-display-controller.js';

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

function installFakeDocument({ messageCount = 1, withMessageBlock = true } = {}) {
    const previous = globalThis.document;
    const chatRoot = createElement('div');
    const messages = Array.from({ length: messageCount }, (_, index) => {
        const message = createElement('div');
        message.className = 'mes';
        message.attributes.set('mesid', String(index + 1));
        const avatar = createElement('div');
        const messageBlock = createElement('div');
        messageBlock.className = 'mes_block';
        const messageText = createElement('div');
        messageText.className = 'mes_text';
        messageText.textContent = 'Original narration';
        const workbench = createElement('details');
        workbench.textContent = 'Nemo workbench';
        messageBlock.append(messageText, workbench);
        message.append(avatar);
        if (withMessageBlock) message.append(messageBlock);
        message.querySelector = selector => selector === '.mes_block' && withMessageBlock ? messageBlock : null;
        chatRoot.append(message);
        return { message, messageBlock, messageText, workbench };
    });
    chatRoot.querySelectorAll = selector => selector === '.mes' ? messages.map(item => item.message) : [];
    chatRoot.querySelector = selector => selector === '.mes:last-child' ? messages.at(-1)?.message ?? null : null;
    globalThis.document = {
        createElement,
        querySelector: selector => selector === '#chat' ? chatRoot : null,
    };
    return {
        chatRoot,
        messages,
        ...messages[0],
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
        assert.deepEqual(dom.messageBlock.children, [dom.messageText, dom.workbench, controller.element],
            'old summary element should be removed without changing the narration or workbench');
    } finally {
        dom.restore();
    }
});

test('summary stays below source message content without adding a flex column or entering narration', () => {
    const dom = installFakeDocument({ messageCount: 2 });
    try {
        const controller = createSummaryDisplayController({
            summaryStore: createSummaryStore(records()),
            settings: { showSummariesInChat: true },
            getChatId: () => 'chat-a',
        });
        const messageChildren = [...dom.message.children];

        controller.install();

        assert.deepEqual(dom.message.children, messageChildren, 'summary must not become a third message flex item');
        assert.deepEqual(dom.messageBlock.children, [dom.messageText, dom.workbench, controller.element]);
        assert.equal(dom.messageText.textContent, 'Original narration');
        assert.equal(dom.messageText.children.length, 0, 'summary must remain outside story content');
        assert.equal(dom.messages[1].messageBlock.children.length, 2, 'summary should attach to the source range');
        assert.ok(!controller.element.className.split(/\s+/).includes('mes_narration'), 'summary must not inherit host narration layout rules');

        controller.uninstall();
        assert.deepEqual(dom.messageBlock.children, [dom.messageText, dom.workbench]);
        assert.deepEqual(dom.message.children, messageChildren);
    } finally {
        dom.restore();
    }
});

test('summary uses the last message body when the source message is not rendered', () => {
    const dom = installFakeDocument({ messageCount: 2 });
    try {
        const controller = createSummaryDisplayController({
            summaryStore: createSummaryStore(records()),
            settings: { showSummariesInChat: true },
        });

        assert.equal(controller.render({ chatId: 'chat-a', text: 'Older summary', sourceRange: { end: 99 } }), true);
        assert.equal(controller.element.parentNode, dom.messages[1].messageBlock);
        assert.equal(dom.messages[1].message.children.length, 2);
    } finally {
        dom.restore();
    }
});

test('summary falls back to the chat container when there is no message body', () => {
    for (const options of [{ messageCount: 0 }, { withMessageBlock: false }]) {
        const dom = installFakeDocument(options);
        try {
            const controller = createSummaryDisplayController({
                summaryStore: createSummaryStore(records()),
                settings: { showSummariesInChat: true },
            });
            const chatChildren = [...dom.chatRoot.children];

            assert.equal(controller.render(records().get('chat-a')), true);
            assert.equal(controller.element.parentNode, dom.chatRoot);
            if (dom.message) assert.equal(dom.message.children.length, 1, 'summary must never join the avatar row');

            controller.remove();
            assert.deepEqual(dom.chatRoot.children, chatChildren);
        } finally {
            dom.restore();
        }
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
