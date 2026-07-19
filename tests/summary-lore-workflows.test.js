import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedLock } from '../src/core/keyed-lock.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createSummaryService } from '../src/summary/summary-service.js';
import { createSummaryStore } from '../src/summary/summary-store.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('summary and lore generation can overlap', async () => {
    let active = 0;
    let peak = 0;
    const generation = {
        async generate(request) {
            active += 1;
            peak = Math.max(peak, active);
            await delay(20);
            active -= 1;
            return request.metadata.task === 'summary'
                ? { text: 'They escaped the station.' }
                : { text: '{"entries":[{"action":"create","key":"Marcus","title":"Marcus","content":"Marcus escaped the station.","keywords":["Marcus"]}]}' };
        },
    };

    const metadata = {};
    const summary = createSummaryService({
        generation,
        store: createSummaryStore({ metadata, saveMetadata: async () => {} }),
        settings: { summaryMaxLength: 150 },
    });
    const lorebooks = {
        async ensureForChat() {},
        async load() { return { entries: {} }; },
        async createEntry(value) { return value; },
        async updateEntry(uid, value) { return { uid, ...value }; },
    };
    const lore = createLoreGenerationService({ generation, lorebooks, lock: createKeyedLock() });

    await Promise.all([
        summary.summarize({ chatId: 'chat', messages: [{ id: '1', is_user: true, mes: 'Run.' }] }),
        lore.generate({ chatId: 'chat', input: 'Marcus escaped.' }),
    ]);

    assert.equal(peak, 2);
    assert.equal(metadata.nemolore.summaries.chat.text, 'They escaped the station.');
});

test('same-key lore writes are serialized', async () => {
    const lock = createKeyedLock();
    let active = 0;
    let peak = 0;
    const values = await Promise.all([1, 2, 3].map(value => lock.run('Marcus', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(5);
        active -= 1;
        return value;
    })));

    assert.equal(peak, 1);
    assert.deepEqual(values, [1, 2, 3]);
});
