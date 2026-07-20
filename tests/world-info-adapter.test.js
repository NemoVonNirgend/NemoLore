import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldInfoAdapter } from '../src/integrations/world-info-adapter.js';

function createAdapter(createEntry) {
    const data = { entries: {} };
    const saves = [];
    const adapter = createWorldInfoAdapter({
        createWorld: async () => {},
        loadWorld: async () => data,
        saveWorld: async (...args) => saves.push(args),
        createEntry,
    });
    return { adapter, data, saves };
}

test('world-info adapter passes the lorebook name and data to the current SillyTavern entry API', async () => {
    const calls = [];
    const { adapter, data, saves } = createAdapter(function createEntry(name, bookData) {
        calls.push([name, bookData]);
        const entry = { uid: 0 };
        bookData.entries[0] = entry;
        return entry;
    });

    const entry = await adapter.addEntry('Book', { content: 'Marcus arrived.' });

    assert.deepEqual(calls, [['Book', data]]);
    assert.equal(data.entries[0], entry);
    assert.equal(entry.content, 'Marcus arrived.');
    assert.deepEqual(saves, [['Book', data, true]]);
});

test('world-info adapter preserves the legacy one-argument entry contract', async () => {
    const { adapter, data } = createAdapter(function createEntry(bookData) {
        const entry = { uid: 0 };
        bookData.entries[0] = entry;
        return entry;
    });

    const entry = await adapter.addEntry('Book', { key: ['Marcus'] });

    assert.equal(data.entries[0], entry);
    assert.deepEqual(entry.key, ['Marcus']);
});
