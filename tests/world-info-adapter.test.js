import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldInfoAdapter } from '../src/integrations/world-info-adapter.js';

function setup(createEntry) {
    const books = new Map([['book', { entries: {} }]]);
    const saves = [];
    const adapter = createWorldInfoAdapter({
        createWorld: async name => books.set(name, { entries: {} }),
        deleteWorld: async name => books.delete(name),
        loadWorld: async name => books.get(name),
        saveWorld: async (name, data) => { books.set(name, data); saves.push(name); },
        createEntry,
    });
    return { adapter, books, saves };
}

test('supports current SillyTavern createWorldInfoEntry(name, data) signature', async () => {
    const calls = [];
    const { adapter, books } = setup((name, data) => {
        calls.push(name);
        const entry = { uid: 0 };
        data.entries[0] = entry;
        return entry;
    });

    const entry = await adapter.addEntry('book', { content: 'Moonwell' });
    assert.deepEqual(calls, ['book']);
    assert.equal(entry.content, 'Moonwell');
    assert.equal(books.get('book').entries[0].content, 'Moonwell');
});

test('retains compatibility with one-argument entry factories', async () => {
    const { adapter } = setup(data => {
        const entry = { uid: 1 };
        data.entries[1] = entry;
        return entry;
    });
    assert.equal((await adapter.addEntry('book', { content: 'Compass' })).content, 'Compass');
});

test('commit guards prevent stale world-info writes', async () => {
    const { adapter, books, saves } = setup((name, data) => {
        const entry = { uid: 0 };
        data.entries[0] = entry;
        return entry;
    });
    let active = true;
    const shouldCommit = () => active;
    active = false;

    assert.equal(await adapter.addEntry('book', { content: 'stale' }, { shouldCommit }), null);
    assert.equal(await adapter.updateEntry('book', 0, { content: 'stale' }, { shouldCommit }), null);
    assert.equal(await adapter.removeEntry('book', 0, { shouldCommit }), false);
    assert.deepEqual(books.get('book').entries, {});
    assert.deepEqual(saves, []);
});
