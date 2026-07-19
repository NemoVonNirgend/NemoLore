import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildLorebookName,
    createLorebookRepository,
} from '../src/lore/lorebook-repository.js';

function createState() {
    return {
        raw: {
            lifecycle: {
                currentChatLorebook: null,
            },
        },
    };
}

test('buildLorebookName sanitizes chat identifiers', () => {
    assert.equal(
        buildLorebookName('chat/name with spaces', 1234),
        '_NemoLore_chat_name_with_spaces_1234',
    );
});

test('ensureForChat reuses an associated lorebook', async () => {
    const metadata = {
        nemolore: { lorebook: 'ExistingBook' },
    };
    let creates = 0;

    const repository = createLorebookRepository({
        adapter: {
            create: async () => { creates += 1; },
        },
        metadata,
        saveMetadata: async () => {},
        metadataKey: 'world_info',
        state: createState(),
        clock: { now: () => 100 },
    });

    assert.equal(await repository.ensureForChat('chat-1'), 'ExistingBook');
    assert.equal(creates, 0);
});

test('ensureForChat creates and associates a new lorebook', async () => {
    const metadata = {};
    const state = createState();
    const created = [];
    let saves = 0;

    const repository = createLorebookRepository({
        adapter: {
            create: async name => created.push(name),
        },
        metadata,
        saveMetadata: async () => { saves += 1; },
        metadataKey: 'world_info',
        state,
        clock: { now: () => 500 },
    });

    const name = await repository.ensureForChat('chat/1');

    assert.equal(name, '_NemoLore_chat_1_500');
    assert.deepEqual(created, [name]);
    assert.equal(metadata.world_info, name);
    assert.equal(metadata.nemolore.lorebook, name);
    assert.equal(metadata.nemolore.created_by, 'NemoLore');
    assert.equal(state.raw.lifecycle.currentChatLorebook, name);
    assert.equal(saves, 1);
});

test('entry operations delegate to the adapter', async () => {
    const calls = [];
    const metadata = { world_info: 'Book' };

    const repository = createLorebookRepository({
        adapter: {
            addEntry: async (...args) => calls.push(['add', ...args]),
            updateEntry: async (...args) => calls.push(['update', ...args]),
            removeEntry: async (...args) => calls.push(['remove', ...args]),
        },
        metadata,
        saveMetadata: async () => {},
        metadataKey: 'world_info',
        state: createState(),
    });

    await repository.createEntry({ key: ['Marcus'] });
    await repository.updateEntry(7, { content: 'Updated' });
    await repository.removeEntry(7);

    assert.deepEqual(calls, [
        ['add', 'Book', { key: ['Marcus'] }],
        ['update', 'Book', 7, { content: 'Updated' }],
        ['remove', 'Book', 7],
    ]);
});
