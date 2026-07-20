import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    appendCoreMemoryContent,
    findCoreMemoryEntryUid,
    writeLegacyCoreMemory,
} from '../src/integrations/legacy-core-memory-world-info.js';

test('finds core memories safely when optional legacy fields are absent', () => {
    assert.equal(findCoreMemoryEntryUid({ entries: { 1: {}, 2: { key: ['core_memories'] } } }), '2');
    assert.equal(findCoreMemoryEntryUid({ entries: { 1: { content: '## Core Memories\n' } } }), '1');
    assert.equal(findCoreMemoryEntryUid({}), null);
});

test('inserts a memory before the trailing section marker', () => {
    assert.equal(
        appendCoreMemoryContent('Header\n---\nFooter', 'Memory\n'),
        'Header\nMemory\n---\nFooter',
    );
});

test('updates the loaded entry by uid and saves with the SillyTavern 1.18 contract', async () => {
    const entry = {
        uid: 7,
        comment: 'Core Memories',
        key: [],
        content: 'Header\n---\n',
    };
    const worldInfo = { entries: { 7: entry } };
    const calls = [];

    const result = await writeLegacyCoreMemory({
        lorebookName: 'Chat Lorebook',
        loadWorldInfo: async name => {
            calls.push(['load', name]);
            return worldInfo;
        },
        createWorldInfoEntry: () => assert.fail('must not create a duplicate entry'),
        saveWorldInfo: async (...args) => calls.push(['save', ...args]),
        entryTemplate: {},
        memoryText: 'Remember this\n',
    });

    assert.equal(result.entry, entry);
    assert.equal(result.worldInfo, worldInfo);
    assert.equal(entry.content, 'Header\nRemember this\n---\n');
    assert.deepEqual(calls, [
        ['load', 'Chat Lorebook'],
        ['save', 'Chat Lorebook', worldInfo, true],
    ]);
});

test('creates through name and loaded data before mutating and saving that data', async () => {
    const worldInfo = { entries: {} };
    const calls = [];

    const result = await writeLegacyCoreMemory({
        lorebookName: 'Chat Lorebook',
        loadWorldInfo: async name => {
            calls.push(['load', name]);
            return worldInfo;
        },
        createWorldInfoEntry: (name, data) => {
            calls.push(['create', name, data]);
            const entry = { uid: 3, content: '' };
            data.entries[3] = entry;
            return entry;
        },
        saveWorldInfo: async (...args) => calls.push(['save', ...args]),
        entryTemplate: {
            comment: 'Core Memories',
            key: ['core_memories'],
            content: '## Core Memories\n---\n',
        },
        memoryText: 'A lasting fact\n',
    });

    assert.equal(result.created, true);
    assert.equal(result.entry, worldInfo.entries[3]);
    assert.equal(worldInfo.entries[3].comment, 'Core Memories');
    assert.equal(worldInfo.entries[3].content, '## Core Memories\nA lasting fact\n---\n');
    assert.deepEqual(calls, [
        ['load', 'Chat Lorebook'],
        ['create', 'Chat Lorebook', worldInfo],
        ['save', 'Chat Lorebook', worldInfo, true],
    ]);
});

test('rejects missing chat lorebooks and failed world-info loads', async () => {
    await assert.rejects(
        () => writeLegacyCoreMemory({ lorebookName: '' }),
        /No chat lorebook/,
    );
    await assert.rejects(
        () => writeLegacyCoreMemory({
            lorebookName: 'Missing',
            loadWorldInfo: async () => null,
        }),
        /Could not load lorebook data/,
    );
});

test('legacy source no longer uses map or obsolete zero-argument world-info writes', async () => {
    const source = await readFile('index.js', 'utf8');

    assert.doesNotMatch(source, /world_names\.get\(/);
    assert.doesNotMatch(source, /createWorldInfoEntry\(\{/);
    assert.doesNotMatch(source, /saveWorldInfo\(\)/);
    assert.match(source, /writeLegacyCoreMemory\(\{/);
});
