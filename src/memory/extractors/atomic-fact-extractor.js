import { MEMORY_TYPES } from '../memory-types.js';
import { createLlmExtractor, normalizeStrings, requireText } from './extractor-utils.js';

const SYSTEM_PROMPT = `Extract durable atomic facts from roleplay text. Return JSON only.
Use {"memories":[...]} where each memory has subject, predicate, object, content, entities, tags, importance, and confidence.
Prefer promises, preferences, possessions, discoveries, secrets, affiliations, and concrete biographical facts.
Each item must express one fact only. Do not infer beyond the source.`;

export function createAtomicFactExtractor({ generation, logger }) {
    return createLlmExtractor({
        name: 'atomic-fact',
        type: MEMORY_TYPES.ATOMIC,
        generation,
        logger,
        systemPrompt: SYSTEM_PROMPT,
        buildPrompt(input) {
            return `Extract durable single facts from the following roleplay context:\n\n${requireText(input, 'Atomic fact source text')}`;
        },
        mapCandidate(candidate) {
            const subject = requireText(candidate.subject, 'Atomic fact subject');
            const predicate = requireText(candidate.predicate, 'Atomic fact predicate');
            const object = requireText(candidate.object, 'Atomic fact object');
            const content = String(candidate.content ?? `${subject} ${predicate} ${object}.`).trim();
            const entities = normalizeStrings(candidate.entities ?? [subject]);

            return {
                title: `${subject}: ${predicate}`,
                content,
                entities,
                tags: normalizeStrings(['atomic-fact', ...(candidate.tags ?? [])]),
                importance: candidate.importance,
                confidence: candidate.confidence,
                data: { subject, predicate, object },
            };
        },
    });
}
