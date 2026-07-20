import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceContextContributor } from '../src/preferences/preference-context-contributor.js';
import { createPreferenceManagementService } from '../src/preferences/preference-management-service.js';
import { PREFERENCE_STATUS } from '../src/preferences/preference-record.js';
import { createPreferenceStore } from '../src/preferences/preference-store.js';

function setup() {
    const settings = { preferenceRecords: [], preferenceEvidence: [], enablePreferenceMemory: true, preferenceContextBudget: 200 };
    let persists = 0;
    const store = createPreferenceStore({ settings, persist: () => { persists += 1; } });
    return { settings, store, management: createPreferenceManagementService({ store, now: () => '2026-07-20T12:00:00Z' }), get persists() { return persists; } };
}

test('preference candidates require explicit acceptance before context injection', async () => {
    const context = setup();
    const candidate = context.store.save({ content: 'Avoid repetitive rhetorical questions.', source: 'explicit' });
    const contributor = createPreferenceContextContributor({ store: context.store, settings: context.settings });
    assert.deepEqual(await contributor.contribute(), []);

    context.management.accept(candidate.id);
    const contribution = await contributor.contribute();
    assert.match(contribution.content, /Avoid repetitive rhetorical questions/);
    assert.equal(contribution.metadata.acceptedOnly, true);
    assert.deepEqual(contribution.metadata.preferenceIds, [candidate.id]);
});

test('preference review is reversible and preserves evidence provenance', async () => {
    const context = setup();
    const evidence = context.store.addEvidence({ source: 'edit', summary: 'User removed repeated stage directions.', chatId: 'chat', messageId: 4 });
    const candidate = context.store.save({ content: 'Use stage directions sparingly.', evidenceIds: [evidence.id], confidence: 0.8 });
    assert.equal(context.management.reject(candidate.id).status, PREFERENCE_STATUS.REJECTED);
    assert.equal(context.management.accept(candidate.id).status, PREFERENCE_STATUS.ACCEPTED);
    assert.deepEqual(context.store.get(candidate.id).evidenceIds, [evidence.id]);
    assert.equal(context.store.getEvidence(evidence.id).source, 'edit');
    assert.ok(context.persists >= 4);
});

test('persona preferences only inject for their matching persona', async () => {
    const context = setup();
    context.store.save({ content: 'Prefer terse narration.', status: 'accepted', scope: 'persona', personaId: 'minimalist' });
    const contributor = createPreferenceContextContributor({ store: context.store, settings: context.settings });
    assert.deepEqual(await contributor.contribute({ personaId: 'other' }), []);
    assert.match((await contributor.contribute({ personaId: 'minimalist' })).content, /terse narration/);
});

test('persona identifiers are normalized at storage and contribution boundaries', async () => {
    const context = setup();
    const record = context.store.save({
        content: 'Use scene breaks between locations.',
        status: 'accepted',
        scope: 'persona',
        personaId: '  director  ',
    });
    const contributor = createPreferenceContextContributor({ store: context.store, settings: context.settings });

    assert.equal(record.personaId, 'director');
    const contribution = await contributor.contribute({ personaId: ' director ' });
    assert.match(contribution.content, /scene breaks/);
    assert.equal(contribution.metadata.personaId, 'director');
});
