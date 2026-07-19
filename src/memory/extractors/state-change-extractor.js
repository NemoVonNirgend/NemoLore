import { MEMORY_TYPES } from '../memory-types.js';
import { createLlmExtractor, normalizeStrings, requireText } from './extractor-utils.js';

const TYPE_MAP = Object.freeze({
    relationship: MEMORY_TYPES.RELATIONSHIP,
    entity: MEMORY_TYPES.ENTITY,
    world: MEMORY_TYPES.WORLD_STATE,
    'world-state': MEMORY_TYPES.WORLD_STATE,
});

const SYSTEM_PROMPT = `Extract living state changes from roleplay text. Return JSON only.
Use {"memories":[...]} where each memory has stateType, subject, field, previousValue, newValue, reason, entities, importance, and confidence.
Allowed stateType values: relationship, entity, world-state.
Capture changes such as trust shifts, injuries, location, possession, faction status, current goals, and unresolved conditions.
Do not emit unchanged facts or speculative changes.`;

export function createStateChangeExtractor({ generation, logger }) {
    const base = createLlmExtractor({
        name: 'state-change',
        type: MEMORY_TYPES.WORLD_STATE,
        generation,
        logger,
        systemPrompt: SYSTEM_PROMPT,
        buildPrompt(input) {
            return `Extract explicit state changes from the following roleplay context:\n\n${requireText(input, 'State-change source text')}`;
        },
        mapCandidate(candidate) {
            const stateType = String(candidate.stateType ?? 'world-state').trim().toLowerCase();
            const type = TYPE_MAP[stateType];
            if (!type) throw new TypeError(`Unsupported state change type: ${stateType}`);

            const subject = requireText(candidate.subject, 'State-change subject');
            const field = requireText(candidate.field, 'State-change field');
            const newValue = candidate.newValue;
            if (newValue === undefined || newValue === null || newValue === '') {
                throw new TypeError('State-change newValue is required.');
            }

            const entities = normalizeStrings(candidate.entities ?? [subject]);
            const reason = String(candidate.reason ?? '').trim() || null;

            return {
                type,
                title: `${subject}: ${field}`,
                content: reason
                    ? `${subject}'s ${field} changed to ${String(newValue)} because ${reason}.`
                    : `${subject}'s ${field} changed to ${String(newValue)}.`,
                entities,
                tags: ['state-change', field],
                importance: candidate.importance,
                confidence: candidate.confidence,
                data: {
                    stateType,
                    subject,
                    field,
                    previousValue: candidate.previousValue ?? null,
                    newValue,
                    reason,
                },
            };
        },
    });

    return async function extract(input, context = {}) {
        const candidates = await base(input, context);
        return candidates.map(candidate => ({ ...candidate, type: candidate.data.stateType === 'relationship'
            ? MEMORY_TYPES.RELATIONSHIP
            : candidate.data.stateType === 'entity'
                ? MEMORY_TYPES.ENTITY
                : MEMORY_TYPES.WORLD_STATE }));
    };
}
