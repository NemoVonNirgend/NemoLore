import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceContextContributor } from '../src/preferences/preference-context-contributor.js';
import { createPreferenceCandidateInference } from '../src/preferences/preference-candidate-inference.js';
import { createPreferenceEvidenceCollector } from '../src/preferences/preference-evidence-collector.js';
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

test('evidence collection is opt-in, bounded, and never creates an active preference', () => {
    const context = setup();
    context.settings.enablePreferenceInference = false;
    const collector = createPreferenceEvidenceCollector({ store: context.store, settings: context.settings });
    assert.equal(collector.recordEdit({ acceptedText: 'new', rejectedText: 'old' }), null);

    context.settings.enablePreferenceInference = true;
    const evidence = collector.recordEdit({
        acceptedText: 'A'.repeat(3_000),
        rejectedText: 'B'.repeat(3_000),
        summary: 'User edited an assistant response.',
        chatId: 'chat',
        messageId: 9,
    });
    assert.equal(evidence.acceptedText.length, 2_000);
    assert.equal(evidence.rejectedText.length, 2_000);
    assert.equal(context.store.list().length, 0);
    assert.equal(context.store.listEvidence().length, 1);
});

test('collector ignores unchanged or empty comparisons', () => {
    const context = setup();
    context.settings.enablePreferenceInference = true;
    const collector = createPreferenceEvidenceCollector({ store: context.store, settings: context.settings });
    assert.equal(collector.recordSwipeChoice({ acceptedText: 'same', rejectedText: 'same' }), null);
    assert.equal(collector.recordProblemLine({}), null);
    assert.equal(context.store.listEvidence().length, 0);
});

test('manual inference requires repeated evidence and creates inactive candidates only', async () => {
    const context = setup();
    for (let index = 0; index < 3; index += 1) {
        context.store.addEvidence({
            source: 'swipe-choice',
            summary: 'Repeated rejected prose pattern.',
            acceptedText: `Mara answered directly ${index}.`,
            rejectedText: `Mara tilted her head softly before answering ${index}.`,
        });
    }
    const inference = createPreferenceCandidateInference({ store: context.store, settings: { preferenceInferenceThreshold: 3 } });
    const candidates = inference.generate();
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every(candidate => candidate.status === PREFERENCE_STATUS.CANDIDATE));
    assert.ok(candidates.every(candidate => candidate.evidenceIds.length === 3));
    const contributor = createPreferenceContextContributor({ store: context.store, settings: context.settings });
    assert.deepEqual(await contributor.contribute(), []);
    assert.deepEqual(inference.generate(), []);
});

test('preferences and evidence can be exported and explicitly removed', () => {
    const context = setup();
    const evidence = context.store.addEvidence({ source: 'edit', summary: 'User removed filler.' });
    const record = context.store.save({ content: 'Avoid filler.', evidenceIds: [evidence.id] });
    const exported = context.management.exportData();
    assert.equal(exported.version, 1);
    assert.equal(exported.records[0].id, record.id);
    assert.equal(exported.evidence[0].id, evidence.id);

    assert.equal(context.management.removeEvidence(evidence.id), true);
    assert.deepEqual(context.store.get(record.id).evidenceIds, []);
    assert.equal(context.management.remove(record.id), true);
    assert.equal(context.store.get(record.id), null);
});

test('storage limits prune oldest inactive and unlinked data without deleting accepted history', () => {
    const context = setup();
    context.settings.preferenceRecordLimit = 20;
    context.settings.preferenceEvidenceLimit = 50;
    context.store.save({ id: 'accepted', content: 'Keep this.', status: 'accepted', updatedAt: '2020-01-01T00:00:00Z' });
    for (let index = 0; index < 25; index += 1) {
        context.store.save({ id: `candidate-${index}`, content: `Candidate ${index}`, updatedAt: `2021-01-${String(index + 1).padStart(2, '0')}T00:00:00Z` });
    }
    const linked = context.store.addEvidence({ id: 'linked', source: 'edit', summary: 'Linked evidence.', createdAt: '2020-01-01T00:00:00Z' });
    context.store.save({ id: 'linked-record', content: 'Linked candidate.', evidenceIds: [linked.id] });
    for (let index = 0; index < 55; index += 1) {
        context.store.addEvidence({ id: `evidence-${index}`, source: 'edit', summary: `Evidence ${index}`, createdAt: `2021-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z` });
    }

    assert.ok(context.store.list().length <= 20);
    assert.ok(context.store.get('accepted'));
    assert.ok(context.store.listEvidence().length <= 50);
    assert.ok(context.store.getEvidence('linked'));
});
