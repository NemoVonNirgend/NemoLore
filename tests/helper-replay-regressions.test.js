import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelperAgentRegistry } from '../src/agents/helper-agent-registry.js';
import { createHelperAgentRuntime } from '../src/agents/helper-agent-runtime.js';
import { createHelperSchedulingPolicy } from '../src/agents/helper-scheduling-policy.js';
import { createMemoryHelperAgent, createCallbackHelperAgent } from '../src/agents/builtin-helper-agents.js';
import { createPostReplyDispatcher } from '../src/agents/post-reply-dispatcher.js';
import { createSillyTavernPostReplyListener } from '../src/integrations/sillytavern-post-reply-listener.js';
import { createHelperSourceInvalidator } from '../src/integrations/sillytavern-helper-source-invalidator.js';
import { createMemoryPipeline } from '../src/memory/memory-pipeline.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createMemoryPersistence } from '../src/memory/memory-persistence.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import { createSummaryService } from '../src/summary/summary-service.js';
import { createSummaryStore } from '../src/summary/summary-store.js';
import { createSummaryHelperWorkflow } from '../src/summary/summary-helper-workflow.js';
import { createSummaryInputBuilder } from '../src/summary/summary-input-builder.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createResilientGenerationRouter } from '../src/providers/resilient-generation-router.js';
import { createHelperSourceGuard } from '../src/core/helper-source-guard.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function events() {
    const handlers = new Map();
    return {
        on(name, callback) { const set = handlers.get(name) ?? new Set(); set.add(callback); handlers.set(name, set); },
        off(name, callback) { handlers.get(name)?.delete(callback); },
        emit(name, ...args) { return [...(handlers.get(name) ?? [])].map(callback => callback(...args)); },
        size: () => [...handlers.values()].reduce((total, set) => total + set.size, 0),
    };
}
function messages(suffix = '') {
    return [
        { is_user: false, mes: 'The station is quiet.', send_date: 'greeting' },
        { is_user: true, mes: 'Where is the key?', send_date: `user${suffix}` },
        { is_user: false, mes: 'Marcus left the key under the altar.', send_date: `reply${suffix}` },
    ];
}
function settings() {
    return { enableHelperAgents: true, helperMemoryAfterReply: true, helperSummaryAfterReply: true, helperLoreAfterReply: true,
        helperMaxCallsPerReply: 3, helperSummaryMinMessages: 0, helperLoreMinMessages: 0, helperLoreRequireSignal: false,
        summaryChunkSize: 0, loreUpdateStrategy: 'aggressive', helperRetryCount: 0, helperRequestTimeoutMs: 1000 };
}

test('delete/resend invalidates completed derived context and allows one replacement batch without replay growth', async () => {
    const chat = messages();
    const eventSource = events();
    const config = settings();
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    const pipeline = createMemoryPipeline({ sourceLedger, store });
    let extractionCalls = 0;
    for (const name of ['episode', 'atomic-fact', 'state-change']) pipeline.registerExtractor(name, {
        extract: async () => { extractionCalls++; return { type: 'atomic', content: `The key is under the altar (${name}).` }; },
    });
    const summaryStore = createSummaryStore({ metadata: {}, saveMetadata: async () => {} });
    const summaries = [];
    const summary = createSummaryService({
        settings: config, store: summaryStore, getActiveChatId: () => 'chat', getContext: () => ({ chat }),
        generation: { generate: async request => { summaries.push(request.prompt); return { text: 'Marcus hid the key.' }; } },
    });
    const registry = createHelperAgentRegistry();
    registry.register('memory', createMemoryHelperAgent({ pipeline, getActiveChatId: () => 'chat', getContext: () => ({ chat }) }));
    registry.register('summary', createCallbackHelperAgent({ handler: createSummaryHelperWorkflow({ summary, inputBuilder: createSummaryInputBuilder({ settings: config }) }) }));
    registry.register('lore', { run: async () => ({ skipped: true }) });
    const runtime = createHelperAgentRuntime({ registry, concurrency: 3 });
    const policy = createHelperSchedulingPolicy({ settings: config });
    const dispatcher = createPostReplyDispatcher({ runtime, settings: config, policy });
    const listener = createSillyTavernPostReplyListener({
        eventSource, messageReceivedEvent: 'received', messageDeletedEvent: 'deleted',
        messageEditedEvent: 'edited', messageSwipedEvent: 'swiped', chatChangedEvent: 'chat',
        getContext: () => ({ chat }), getChatId: () => 'chat', dispatcher,
        onSourcesChanged: createHelperSourceInvalidator({ runtime, scheduling: policy, sourceLedger, pipeline,
            persistence: { activeChatId: 'chat' }, summaryStore, contextBridge: { clear() {} } }),
    });
    listener.install();
    for (let iteration = 0; iteration < 3; iteration++) {
        eventSource.emit('received', 2, 'normal');
        eventSource.emit('received', 2, 'normal');
        await tick();
        assert.equal(extractionCalls, (iteration + 1) * 3);
        assert.equal(store.query().length, 3);
        assert.equal(summaries.length, iteration + 1);
        assert.equal(summaries.at(-1).match(/Marcus left the key/g)?.length, 1);
        assert.equal(summaries.at(-1).match(/Where is the key/g)?.length, 1);
        assert.ok(summaryStore.get('chat'));
        if (iteration < 2) {
            chat.splice(1);
            eventSource.emit('deleted', chat.length);
            await tick();
            assert.equal(store.query().length, 0);
            assert.equal(sourceLedger.list().length, 0);
            assert.equal(summaryStore.get('chat'), null);
            chat.push(...messages(String(iteration + 1)).slice(1));
        }
    }
    assert.equal(new Set(summaries.map(prompt => prompt.length)).size, 1, 'Retrying the same turn must not accumulate old summaries or transcript copies.');
    assert.equal(runtime.list().length, 9);
    listener.uninstall();
    assert.equal(eventSource.size(), 0);
});

test('deleted replies cannot commit late memory, summary, or lore results even when the provider ignores cancellation', async () => {
    const chat = messages();
    const getContext = () => ({ chat });
    const payload = { chatId: 'chat', input: 'The key was hidden.', context: { chat: structuredClone(chat), assistantIndex: 2 },
        sources: [{ chatId: 'chat', messageId: 'reply', messageIndex: 2 }], messages: [{ id: 'reply', text: 'The key was hidden.' }] };
    const gate = deferred();
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    const pipeline = createMemoryPipeline({ store, sourceLedger });
    for (const name of ['episode', 'atomic-fact', 'state-change']) pipeline.registerExtractor(name, {
        async extract() { await gate.promise; return { type: 'atomic', content: 'Deleted reply must not survive.' }; },
    });
    const summaryStore = createSummaryStore({ metadata: {}, saveMetadata: async () => {} });
    const summary = createSummaryService({ store: summaryStore, getContext, getActiveChatId: () => 'chat',
        generation: { generate: async () => { await gate.promise; return { text: 'Deleted summary' }; } } });
    const writes = [];
    const lore = createLoreGenerationService({ getContext, getActiveChatId: () => 'chat',
        generation: { generate: async () => { await gate.promise; return { text: '{"entries":[{"key":"Deleted","content":"Deleted lore"}]}' }; } },
        lorebooks: { ensureForChat: async () => 'book', load: async () => ({ entries: {} }), createEntry: async value => { writes.push(value); return value; } },
        lock: { run: async (key, callback) => callback() },
    });
    const pending = [createMemoryHelperAgent({ pipeline, getContext, getActiveChatId: () => 'chat' }).run({ payload }), summary.summarize(payload), lore.generate(payload)];
    await tick();
    chat.splice(1);
    gate.resolve();
    for (const result of await Promise.all(pending)) assert.equal(result.skipped, true);
    assert.equal(store.size, 0);
    assert.equal(summaryStore.get('chat'), null);
    assert.equal(writes.length, 0);
});

test('deleted-source invalidation is persisted before a refresh and does not leave dangling source links', async () => {
    const metadata = {};
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    const persistence = createMemoryPersistence({ store, sourceLedger, metadata, saveMetadata: async () => {} });
    persistence.start('chat');
    const pipeline = createMemoryPipeline({ sourceLedger, store });
    pipeline.registerExtractor('test', { extract: async () => ({ type: 'atomic', content: 'Deleted source fact.' }) });
    await pipeline.ingest({ extractor: 'test', sources: [{ chatId: 'chat', messageId: 'reply', messageIndex: 2 }] });
    await persistence.flush();
    const invalidate = createHelperSourceInvalidator({ runtime: { invalidate: () => [] }, scheduling: { reset() {} },
        persistence, sourceLedger, pipeline, summaryStore: { get: () => null }, contextBridge: { clear() {} } });
    await invalidate({ chatId: 'chat', firstChangedIndex: 1 });
    const reloadedLedger = createSourceLedger();
    const reloadedStore = createMemoryStore({ sourceLedger: reloadedLedger });
    const reloaded = createMemoryPersistence({ store: reloadedStore, sourceLedger: reloadedLedger, metadata, saveMetadata: async () => {} });
    reloaded.start('chat');
    assert.equal(reloadedStore.query().length, 0);
    assert.equal(reloadedStore.list()[0].status, 'invalidated');
    assert.deepEqual(reloadedStore.list()[0].sourceIds, []);
    assert.deepEqual(reloadedLedger.list(), []);
    persistence.stop();
    reloaded.stop();
});

test('a cancelled running job cannot emit success or remove the dedupe key of its replacement', async () => {
    const registry = createHelperAgentRegistry();
    const firstGate = deferred();
    const secondGate = deferred();
    let calls = 0;
    registry.register('memory', { async run() { await (++calls === 1 ? firstGate.promise : secondGate.promise); return true; } });
    const runtime = createHelperAgentRuntime({ registry, concurrency: 2 });
    const first = runtime.enqueue({ agent: 'memory', dedupeKey: 'turn' });
    await tick();
    runtime.invalidate(job => job.id === first.id);
    const second = runtime.enqueue({ agent: 'memory', dedupeKey: 'turn' });
    await tick();
    firstGate.resolve();
    await tick();
    assert.equal(runtime.get(first.id).status, 'cancelled');
    assert.equal(runtime.enqueue({ agent: 'memory', dedupeKey: 'turn' }).id, second.id);
    assert.equal(calls, 2);
    secondGate.resolve();
    await tick();
    assert.equal(runtime.get(second.id).status, 'succeeded');
});

test('stale receive events and synthetic helper/system messages never start helper batches', () => {
    const chat = messages();
    const calls = [];
    const listener = createSillyTavernPostReplyListener({ eventSource: events(), messageReceivedEvent: 'received',
        getContext: () => ({ chat }), getChatId: () => 'chat', dispatcher: { dispatch: payload => { calls.push(payload); return []; } } });
    for (const type of ['summary', 'memory', 'helper', 'background_helper', 'quiet']) listener.onMessageReceived(2, type);
    listener.onMessageReceived(100, 'normal');
    listener.onMessageReceived(-1, 'normal');
    chat[2].is_system = true;
    listener.onMessageReceived(2, 'normal');
    assert.equal(calls.length, 0);
});

test('source guards allow appended replies but reject edited, swiped, and recreated source turns', () => {
    const chat = messages();
    const guard = createHelperSourceGuard({ payload: { chatId: 'chat', context: { chat: structuredClone(chat) } }, getActiveChatId: () => 'chat', getContext: () => ({ chat }) });
    chat.push({ is_user: true, mes: 'Next turn', send_date: 'new' });
    assert.equal(guard(), true);
    chat[2].mes = 'A different swipe';
    assert.equal(guard(), false);
    chat[2].mes = messages()[2].mes;
    chat[2].send_date = 'replacement-date';
    assert.equal(guard(), false);
});

test('timeouts abort the original request before retrying and caller cancellation prevents retry/fallback', async () => {
    const signals = [];
    const registry = { activeProvider: 'primary', has: () => true, async generate(input) {
        signals.push(input.signal);
        if (signals.length === 1) return new Promise(() => {});
        assert.equal(signals[0].aborted, true);
        return { text: 'retry succeeded' };
    } };
    const router = createResilientGenerationRouter({ registry, settings: { helperRetryCount: 1, helperRequestTimeoutMs: 10 } });
    assert.equal((await router.generate({})).text, 'retry succeeded');
    assert.equal(signals.length, 2);
    const controller = new AbortController();
    let calls = 0;
    let signal;
    const cancelledRouter = createResilientGenerationRouter({ settings: { helperRetryCount: 2, helperFallbackProvider: 'fallback' },
        registry: { activeProvider: 'primary', has: () => true, generate(input) { calls++; signal = input.signal; return new Promise(() => {}); } } });
    const pending = cancelledRouter.generate({ signal: controller.signal });
    controller.abort(new Error('Source was deleted'));
    await assert.rejects(pending, /Source was deleted/);
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
});

test('summary helper includes normalized text and stored continuity once, without overriding an explicit reset', async () => {
    const store = createSummaryStore({ metadata: {}, saveMetadata: async () => {} });
    await store.save('chat', { text: 'Earlier continuity.' });
    const prompts = [];
    const summary = createSummaryService({ store, generation: { generate: async request => { prompts.push(request.prompt); return { text: 'Updated continuity.' }; } } });
    const workflow = createSummaryHelperWorkflow({ summary, inputBuilder: createSummaryInputBuilder({ settings: {} }) });
    const payload = { chatId: 'chat', context: { chat: messages() } };
    await workflow(payload);
    assert.equal(prompts[0].match(/Earlier continuity\./g)?.length, 1);
    assert.equal(prompts[0].match(/User: Where is the key\?/g)?.length, 1);
    assert.equal(prompts[0].match(/Assistant: Marcus left the key/g)?.length, 1);
    await workflow({ ...payload, previousSummary: '' });
    assert.doesNotMatch(prompts[1], /Existing continuity summary/);
});

test('rewinding one chat resets its cadence without resetting other chats', () => {
    const config = { ...settings(), summaryChunkSize: 8 };
    const policy = createHelperSchedulingPolicy({ settings: config });
    policy.select({ chatId: 'one', messageCount: 20 });
    policy.select({ chatId: 'two', messageCount: 20 });
    assert.equal(policy.evaluate('summary', { chatId: 'one', messageCount: 10 }).allowed, false);
    policy.reset('one');
    assert.equal(policy.evaluate('summary', { chatId: 'one', messageCount: 10 }).allowed, true);
    assert.equal(policy.evaluate('summary', { chatId: 'two', messageCount: 21 }).allowed, false);
});
