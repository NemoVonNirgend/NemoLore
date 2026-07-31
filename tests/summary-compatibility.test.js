import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextExclusionPolicy } from '../src/context/context-exclusion-policy.js';
import { createPostReplyDispatcher } from '../src/agents/post-reply-dispatcher.js';
import { createSillyTavernContextExclusionInterceptor } from '../src/integrations/sillytavern-context-exclusion-interceptor.js';
import { createSummaryCompatibilityCoordinator } from '../src/summary/summary-compatibility-coordinator.js';
import { createSummaryInputBuilder } from '../src/summary/summary-input-builder.js';

test('modular cutover permanently suppresses legacy automatic execution', () => {
    const extensionSettings = { nemolore: { enableSummarization: true, autoSummarize: true, marker: 'keep' } };
    const coordinator = createSummaryCompatibilityCoordinator({
        settings: { summaryEngineMode: 'modular', enableHelperAgents: true, helperSummaryAfterReply: true },
        extensionSettings,
    });

    assert.equal(coordinator.prepareLegacyImport(), true);
    assert.equal(extensionSettings.nemolore.enableSummarization, false);
    assert.equal(extensionSettings.nemolore.autoSummarize, false);
    assert.equal(coordinator.shouldRunModularSummary(), true);
    assert.equal(coordinator.restorePersistedSettings(), false);
    assert.equal(extensionSettings.nemolore.enableSummarization, false);
    assert.equal(coordinator.restorePending, false);
    assert.equal(coordinator.restoreNow(), false);
    assert.equal(extensionSettings.nemolore.enableSummarization, false);
    assert.equal(extensionSettings.nemolore.marker, 'keep');
});

test('legacy engine flags are treated as migrated modular settings', () => {
    const extensionSettings = { nemolore: { enableSummarization: true } };
    const coordinator = createSummaryCompatibilityCoordinator({ settings: { summaryEngineMode: 'legacy' }, extensionSettings });
    assert.equal(coordinator.prepareLegacyImport(), true);
    assert.equal(extensionSettings.nemolore.enableSummarization, false);
    assert.equal(coordinator.mode(), 'modular');
});

test('summary input builder selects a bounded trailing message window', () => {
    const builder = createSummaryInputBuilder({ settings: { summaryInputMaxMessages: 3, enablePairedSummarization: true } });
    const chat = Array.from({ length: 6 }, (_, index) => ({ id: index, is_user: index % 2 === 0, mes: `message ${index}` }));
    const result = builder.build({ chat, assistantIndex: 5 });
    assert.deepEqual(result.messages.map(message => message.id), ['3', '4', '5']);
    assert.deepEqual(result.sourceRange, { start: 3, end: 5 });
    assert.equal(result.paired, true);
});

test('context exclusion retains only the running window when a summary exists', () => {
    const policy = createContextExclusionPolicy({ settings: { hideMessagesWhenThreshold: true, runningMemorySize: 2 } });
    const result = policy.apply(['a', 'b', 'c', 'd'], { summaryAvailable: true });
    assert.deepEqual(result.visible, ['c', 'd']);
    assert.deepEqual(result.hidden, ['a', 'b']);
    assert.equal(result.hiddenCount, 2);
});

test('context exclusion interceptor always uses the modular policy', async () => {
    const seen = [];
    const next = async chat => { seen.push(chat); return 'ok'; };
    const policy = createContextExclusionPolicy({ settings: { hideMessagesWhenThreshold: true, runningMemorySize: 2 } });
    const summaryStore = { get: () => ({ text: 'summary' }) };
    const modular = createSillyTavernContextExclusionInterceptor({ policy, summaryStore, getChatId: () => 'chat', compatibility: { mode: () => 'modular' }, next });
    const legacy = createSillyTavernContextExclusionInterceptor({ policy, summaryStore, getChatId: () => 'chat', compatibility: { mode: () => 'legacy' }, next });
    await modular([1, 2, 3, 4]);
    await legacy([1, 2, 3, 4]);
    assert.deepEqual(seen[0], [3, 4]);
    assert.deepEqual(seen[1], [3, 4]);
});

test('modular interceptor marks hidden host messages without calling legacy code', async () => {
    let called = false;
    const chat = [{ extra: {} }, { extra: {} }, { extra: {} }];
    const intercept = createSillyTavernContextExclusionInterceptor({
        policy: createContextExclusionPolicy({ settings: { hideMessagesWhenThreshold: true, runningMemorySize: 1 } }),
        summaryStore: { get: () => ({ text: 'summary' }) },
        getChatId: () => 'chat',
        getContext: () => ({ symbols: { ignore: 'IGNORE' } }),
        next: () => { called = true; },
    });
    await intercept(chat);
    assert.equal(chat[0].extra.IGNORE, true);
    assert.equal(chat[1].extra.IGNORE, true);
    assert.equal(chat[2].extra.IGNORE, undefined);
    assert.equal(called, true);
});

test('retired legacy summary flags cannot prevent modular summary work', () => {
    let requests = null;
    const dispatcher = createPostReplyDispatcher({
        runtime: { enqueueMany(value) { requests = value; return value; } },
        settings: { enableHelperAgents: true, summaryEngineMode: 'legacy', helperMemoryAfterReply: true, helperSummaryAfterReply: true, helperLoreAfterReply: false },
        policy: { select: () => ({ selected: [{ workflow: 'memory' }, { workflow: 'summary' }], decisions: [] }) },
        providerRouter: { routeFor: () => 'async' },
    });
    dispatcher.dispatch({ chatId: 'chat', messageId: '1', input: 'text', sources: [], context: {} });
    assert.deepEqual(requests.map(request => request.agent), ['memory', 'summary']);
});
