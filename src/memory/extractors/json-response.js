function stripCodeFence(value) {
    return value
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function findJsonBoundary(value) {
    const objectStart = value.indexOf('{');
    const arrayStart = value.indexOf('[');
    const starts = [objectStart, arrayStart].filter(index => index >= 0);
    if (starts.length === 0) return value;

    const start = Math.min(...starts);
    const objectEnd = value.lastIndexOf('}');
    const arrayEnd = value.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    return end >= start ? value.slice(start, end + 1) : value.slice(start);
}

export function parseJsonResponse(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError('Extractor response must contain JSON text.');
    }

    const cleaned = findJsonBoundary(stripCodeFence(value));

    try {
        return JSON.parse(cleaned);
    } catch (error) {
        throw new SyntaxError(`Unable to parse extractor JSON: ${error.message}`);
    }
}

export function normalizeCandidateArray(value) {
    const parsed = parseJsonResponse(value);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.memories)) return parsed.memories;
    if (Array.isArray(parsed.items)) return parsed.items;
    return [parsed];
}
