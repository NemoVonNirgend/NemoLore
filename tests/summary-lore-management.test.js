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
    await manager.merge(1, [2]);
    assert.match(repository.book.entries[1].content, /Primary/);
    assert.match(repository.book.entries[1].content, /Duplicate/);
    assert.equal(repository.book.entries[2], undefined);
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
