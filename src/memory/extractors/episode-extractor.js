import { MEMORY_TYPES } from '../memory-types.js';
import { createLlmExtractor, normalizeStrings, requireText } from './extractor-utils.js';

const SYSTEM_PROMPT = `Extract durable scene memories from roleplay text. Return JSON only.
Use {"memories":[...]} where each memory has title, summary, participants, location, outcome, unresolvedThreads, importance, and confidence.
Do not invent facts. Omit trivial beats, prose flourishes, and repeated information.`;

export function createEpisodeExtractor({ generation, logger }) {
    return createLlmExtractor({
        name: 'episode',
        type: MEMORY_TYPES.EPISODE,
        generation,
        logger,
        systemPrompt: SYSTEM_PROMPT,
        buildPrompt(input) {
            return `Extract meaningful bounded scenes or events from the following roleplay context:\n\n${requireText(input, 'Episode source text')}`;
        },
        mapCandidate(candidate) {
            const summary = requireText(candidate.summary ?? candidate.content, 'Episode summary');
            const title = String(candidate.title ?? 'Untitled episode').trim();
            const participants = normalizeStrings(candidate.participants ?? candidate.entities);
            const unresolvedThreads = normalizeStrings(candidate.unresolvedThreads);

            return {
                title,
                content: summary,
                entities: participants,
                tags: ['episode', ...unresolvedThreads.map(() => 'unresolved-thread')],
                importance: candidate.importance,
                confidence: candidate.confidence,
                data: {
                    participants,
                    location: String(candidate.location ?? '').trim() || null,
                    outcome: String(candidate.outcome ?? '').trim() || null,
                    unresolvedThreads,
                },
            };
        },
    });
}
