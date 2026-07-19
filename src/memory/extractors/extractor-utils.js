import { MEMORY_TYPES } from '../memory-types.js';
import { normalizeCandidateArray } from './json-response.js';

function clamp(value, min = 0, max = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
}

export function createLlmExtractor({
    name,
    type,
    generation,
    systemPrompt,
    buildPrompt,
    mapCandidate,
    logger,
}) {
    if (!Object.values(MEMORY_TYPES).includes(type)) {
        throw new TypeError(`Unsupported memory type for ${name}: ${type}`);
    }

    return async function extract(input, context = {}) {
        const prompt = buildPrompt(input, context);
        const result = await generation.generate({
            systemPrompt,
            prompt,
            maxTokens: context.maxTokens ?? 1200,
            temperature: context.temperature ?? 0.2,
            metadata: { task: `memory-extraction:${name}` },
        }, context.generationOptions);

        const candidates = normalizeCandidateArray(result.text ?? result)
            .map((candidate, index) => mapCandidate(candidate, { input, context, index }))
            .filter(Boolean)
            .map(candidate => ({
                ...candidate,
                type,
                confidence: clamp(candidate.confidence ?? 0.7),
                importance: clamp(candidate.importance ?? 0.5),
            }));

        logger?.debug('Memory extraction completed.', { extractor: name, count: candidates.length });
        return candidates;
    };
}

export function normalizeStrings(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

export function requireText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new TypeError(`${label} is required.`);
    return text;
}
