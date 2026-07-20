import test from 'node:test';
import assert from 'node:assert/strict';

import { createSillyTavernContextRequestFactory } from '../src/integrations/sillytavern-context-request-factory.js';

test('context requests follow the active profile retrieval and chunk policy', async () => {
    const settings = { summaryChunkSize: 4, memoryContextBudget: 1400, memoryCandidateLimit: 18 };
    const chat = Array.from({ length: 10 }, (_, index) => ({ mes: `Message ${index}`, name: index % 2 ? 'A' : 'B' }));
    const factory = createSillyTavernContextRequestFactory({
        settings,
        getChatId: () => 'chat',
        getContext: () => ({ chat }),
    });
    const result = await factory({ chat, contextSize: 16_000, type: 'normal' });
    assert.equal(result.postReply.sources.length, 4);
    assert.equal(result.contextRequest.memoryMaxTokens, 1400);
    assert.equal(result.contextRequest.memoryCandidateLimit, 18);

    settings.summaryChunkSize = 6;
    settings.memoryContextBudget = 2400;
    const updated = await factory({ chat, contextSize: 32_000, type: 'normal' });
    assert.equal(updated.postReply.sources.length, 6);
    assert.equal(updated.contextRequest.memoryMaxTokens, 2400);
});
