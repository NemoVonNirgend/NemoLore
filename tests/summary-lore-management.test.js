import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryManagementService } from '../src/summary/summary-management-service.js';
import { createLoreManagementService } from '../src/lore/lore-management-service.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createLoreEntityIndex } from '../src/lore/lore-entity-index.js';
import { createKeyedLock } from '../src/core/keyed-lock.js';

function summaryStore() {
    const values = new Map();
    return {
        get: id => values.get(String(id)) ?? null,
        async save(id, value) {
            const record = { chatId: String(id), createdAt: values.get(String(id))?.createdAt ?? 1, updatedAt: 2, ...value };
            values.set(String(id), record);
            return record;
        },
    };
}

function loreRepository(entries = {}) {
    const book = { entries: structuredClone(entries) };
    const calls = [];
    let nextUid = 100;
    return {
        book,
        calls,
        async ensureForChat() { return 'Book'; },
        async load() { return structuredClone(book); },
        async createEntry(value) {
            const uid = nextUid++;
            book.entries[uid] = { uid, ...value };
            calls.push(['create', uid, value]);
            return book.entries[uid];
        },
        async updateEntry(uid, patch) {
            book.entries[uid] = { ...book.entries[uid], ...patch, uid };
            calls.push(['update', uid, patch]);
            return book.entries[uid];
        },
        async removeEntry(uid) {
            delete book.entries[uid];
            calls.push(['remove', uid]);
            return true;
        },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function isActiveChatChanged(error) {
    return error?.code === 'NEMOLORE_ACTIVE_CHAT_CHANGED';
}

test('summary manager edits records and persists precedence', async () => {
    const store = summaryStore();
    await store.save('chat', { text: 'Old', sourceMessageIds: ['1'], sourceRange: { start: 0, end: 1 }, metadata: {} });
    const settings = { summaryContextPrecedence: 'new-first' };
    let persisted = null;
    const manager = createSummaryManagementService({
        store,
        settings,
        saveSettings: value => { persisted = { ...value }; },
        getChatId: () => 'chat',
    });
    const edited = await manager.edit('New text');
    assert.equal(edited.text, 'New text');
    assert.equal(edited.metadata.manuallyEdited, true);
    manager.setPrecedence('legacy-first');
    assert.equal(settings.summaryContextPrecedence, 'legacy-first');
    assert.equal(persisted.summaryContextPrecedence, 'legacy-first');
    assert.deepEqual(manager.lineage().sourceRange, { start: 0, end: 1 });
});

test('manual summary regeneration records its origin', async () => {
    const store = summaryStore();
    const manager = createSummaryManagementService({
        store,
        summary: {
            async summarize(payload) {
                return store.save(payload.chatId, { text: 'Regenerated', sourceMessageIds: ['1'], metadata: payload.metadata });
            },
        },
        settings: {},
        getChatId: () => 'chat',
        getContext: () => ({ chat: [{ id: '1', mes: 'Hello' }] }),
    });
    const result = await manager.regenerate();
    assert.equal(result.metadata.manualRegeneration, true);
});

test('summary manager rejects edits and regeneration from a stale panel chat', async () => {
    let activeChatId = 'chat-a';
    let saves = 0;
    let summaryCalls = 0;
    const store = {
        get: () => null,
        async save() {
            saves += 1;
            return {};
        },
    };
    const manager = createSummaryManagementService({
        store,
        summary: {
            async summarize() {
                summaryCalls += 1;
                return {};
            },
        },
        settings: {},
        getChatId: () => activeChatId,
        getContext: () => {
            activeChatId = 'chat-b';
            return { chat: [{ id: '1', mes: 'Chat A' }] };
        },
    });

    activeChatId = 'chat-b';
    await assert.rejects(manager.edit('Stale', { chatId: 'chat-a' }), isActiveChatChanged);
    assert.equal(saves, 0);

    activeChatId = 'chat-a';
    await assert.rejects(manager.regenerate({ chatId: 'chat-a' }), isActiveChatChanged);
    assert.equal(summaryCalls, 0);
});

test('lore manager protects entries and merges duplicates', async () => {
    const repository = loreRepository({
        1: { uid: 1, key: ['Marcus'], comment: 'Marcus', content: 'Primary' },
        2: { uid: 2, key: ['Marcus Hale'], comment: 'Marcus Hale', content: 'Duplicate' },
    });
    const manager = createLoreManagementService({
        lorebooks: repository,
        generation: { preview() {}, apply() {} },
        entityIndex: createLoreEntityIndex(),
    });
    await manager.protect(1, true);
    assert.equal(repository.book.entries[1].extensions.nemolore.protected, true);
    await manager.merge(1, [1, 2]);
    assert.match(repository.book.entries[1].content, /Primary/);
    assert.match(repository.book.entries[1].content, /Duplicate/);
    assert.deepEqual(repository.book.entries[1].extensions.nemolore.mergedFrom, ['2']);
    assert.equal(repository.book.entries[2], undefined);
});

test('lore manager rejects protect and merge writes when their panel chat changes', async () => {
    for (const action of ['protect', 'merge']) {
        let activeChatId = 'chat-a';
        const started = deferred();
        const release = deferred();
        const writes = [];
        const books = {
            'Book A': { entries: {
                1: { uid: 1, key: ['Marcus'], content: 'Primary' },
                2: { uid: 2, key: ['Marcus Hale'], content: 'Duplicate' },
            } },
            'Book B': { entries: {} },
        };
        const repository = {
            getAssociatedName: () => activeChatId === 'chat-a' ? 'Book A' : 'Book B',
            async load(name) {
                started.resolve();
                await release.promise;
                return structuredClone(books[name]);
            },
            async updateEntry(uid, patch, name) {
                writes.push(['update', name, uid, patch]);
                return patch;
            },
            async removeEntry(uid, name) {
                writes.push(['remove', name, uid]);
                return true;
            },
        };
        const manager = createLoreManagementService({
            lorebooks: repository,
            generation: { preview() {}, apply() {} },
            entityIndex: createLoreEntityIndex(),
            getChatId: () => activeChatId,
        });

        const pending = action === 'protect'
            ? manager.protect(1, true, { chatId: 'chat-a' })
            : manager.merge(1, [2], { chatId: 'chat-a' });
        await started.promise;
        activeChatId = 'chat-b';
        release.resolve();

        await assert.rejects(pending, isActiveChatChanged, action);
        assert.deepEqual(writes, [], action);
    }
});

test('lore manager rejects stale previews and preview approval', async () => {
    let activeChatId = 'chat-a';
    let applyCalls = 0;
    const previewStarted = deferred();
    const releasePreview = deferred();
    const manager = createLoreManagementService({
        lorebooks: { async load() { return { entries: {} }; } },
        generation: {
            async preview(payload) {
                previewStarted.resolve();
                await releasePreview.promise;
                return { chatId: payload.chatId, operations: [] };
            },
            async apply() {
                applyCalls += 1;
                return {};
            },
        },
        entityIndex: createLoreEntityIndex(),
        getChatId: () => activeChatId,
    });

    const pendingPreview = manager.preview({ chatId: 'chat-a', input: 'Recent chat.' });
    await previewStarted.promise;
    activeChatId = 'chat-b';
    releasePreview.resolve();
    await assert.rejects(pendingPreview, isActiveChatChanged);

    await assert.rejects(
        manager.apply({ chatId: 'chat-a', operations: [] }, []),
        isActiveChatChanged,
    );
    assert.equal(applyCalls, 0);
});

test('lore manager lists normalized identities for entries', async () => {
    const repository = loreRepository({
        1: { uid: 1, key: ['Marcus_Hale'], comment: 'Marcus Hale', content: 'A scout' },
    });
    const manager = createLoreManagementService({
        lorebooks: repository,
        generation: { preview() {}, apply() {} },
        entityIndex: createLoreEntityIndex(),
    });

    const entries = await manager.list({ search: 'scout' });

    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].normalizedIdentities, ['marcus hale', 'marcus hale']);
});

test('lore manager lists no entries when the current chat has no associated lorebook', async () => {
    let loads = 0;
    const manager = createLoreManagementService({
        lorebooks: {
            getAssociatedName: () => null,
            async load() {
                loads += 1;
                throw new Error('No lorebook is associated with the current chat.');
            },
        },
        generation: { preview() {}, apply() {} },
        entityIndex: createLoreEntityIndex(),
    });

    assert.deepEqual(await manager.list(), []);
    assert.equal(loads, 0);
});

test('lore manager does not hide failures while loading an associated lorebook', async () => {
    const loadFailure = new Error('Lorebook storage is unavailable.');
    const manager = createLoreManagementService({
        lorebooks: {
            getAssociatedName: () => 'Book',
            async load() { throw loadFailure; },
        },
        generation: { preview() {}, apply() {} },
        entityIndex: createLoreEntityIndex(),
    });

    await assert.rejects(manager.list(), error => error === loadFailure);
});

test('protected lore entries refuse automatic generated updates', async () => {
    const repository = loreRepository({
        7: { uid: 7, key: ['Marcus'], comment: 'Marcus', content: 'Manual', extensions: { nemolore: { protected: true } } },
    });
    const service = createLoreGenerationService({
        generation: { async generate() { return { text: JSON.stringify({ entries: [{ action: 'update', key: 'Marcus', title: 'Marcus', content: 'Overwrite', keywords: ['Marcus'] }] }) }; } },
        lorebooks: repository,
        lock: createKeyedLock(),
        entityIndex: createLoreEntityIndex(),
    });
    const result = await service.generate({ chatId: 'chat', input: 'Marcus changed.' });
    assert.equal(result.applied[0].reason, 'protected-entry');
    assert.equal(repository.book.entries[7].content, 'Manual');
});

test('protected lore entries cannot be overwritten through an explicit uid', async () => {
    const repository = loreRepository({
        7: { uid: 7, key: ['Marcus'], comment: 'Marcus', content: 'Manual', extensions: { nemolore: { protected: true } } },
    });
    const service = createLoreGenerationService({
        generation: {
            async generate() {
                return { text: JSON.stringify({ entries: [
                    { action: 'update', uid: 7, key: 'Unrelated Alias', title: 'Unrelated Alias', content: 'Overwrite', keywords: [] },
                ] }) };
            },
        },
        lorebooks: repository,
        lock: createKeyedLock(),
        entityIndex: createLoreEntityIndex(),
    });

    const result = await service.generate({ chatId: 'chat', input: 'Marcus changed.' });

    assert.equal(result.applied[0].reason, 'protected-entry');
    assert.equal(repository.book.entries[7].content, 'Manual');
});

test('lore aliases resolving to one uid serialize their updates', async () => {
    const repository = loreRepository({
        7: { uid: 7, key: ['Marcus', 'The Captain'], comment: 'Marcus', content: 'Original' },
    });
    const originalUpdate = repository.updateEntry;
    const firstUpdateStarted = deferred();
    const releaseFirstUpdate = deferred();
    let activeUpdates = 0;
    let maximumConcurrentUpdates = 0;
    let updateCalls = 0;
    repository.updateEntry = async (...args) => {
        updateCalls += 1;
        activeUpdates += 1;
        maximumConcurrentUpdates = Math.max(maximumConcurrentUpdates, activeUpdates);
        if (updateCalls === 1) {
            firstUpdateStarted.resolve();
            await releaseFirstUpdate.promise;
        }
        const value = await originalUpdate(...args);
        activeUpdates -= 1;
        return value;
    };
    const service = createLoreGenerationService({
        generation: {
            async generate() {
                return { text: JSON.stringify({ entries: [
                    { action: 'update', key: 'Marcus', title: 'Marcus', content: 'First update', keywords: [] },
                    { action: 'update', key: 'The Captain', title: 'The Captain', content: 'Second update', keywords: [] },
                ] }) };
            },
        },
        lorebooks: repository,
        lock: createKeyedLock(),
        entityIndex: createLoreEntityIndex(),
    });

    const pending = service.generate({ chatId: 'chat', input: 'Marcus changed.' });
    await firstUpdateStarted.promise;
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(maximumConcurrentUpdates, 1);
    releaseFirstUpdate.resolve();
    const result = await pending;

    assert.equal(result.applied.length, 2);
    assert.equal(updateCalls, 2);
    assert.equal(maximumConcurrentUpdates, 1);
});

test('lore preview applies only approved operations', async () => {
    const repository = loreRepository();
    const service = createLoreGenerationService({
        generation: { async generate() { return { text: JSON.stringify({ entries: [
            { action: 'create', key: 'Marcus', title: 'Marcus', content: 'One', keywords: ['Marcus'] },
            { action: 'create', key: 'Elena', title: 'Elena', content: 'Two', keywords: ['Elena'] },
        ] }) }; } },
        lorebooks: repository,
        lock: createKeyedLock(),
        entityIndex: createLoreEntityIndex(),
    });
    const preview = await service.preview({ chatId: 'chat', input: 'Two discoveries.' });
    const result = await service.apply(preview, { approvedIndexes: [1] });
    assert.equal(result.applied.find(item => item.key === 'Marcus').reason, 'not-approved');
    assert.equal(repository.calls.filter(call => call[0] === 'create').length, 1);
    assert.equal(repository.calls.find(call => call[0] === 'create')[2].comment, 'Elena');
});
