function normalizeMessages({ prompt, messages, systemPrompt }) {
    if (Array.isArray(messages) && messages.length > 0) {
        return messages.map(message => ({
            role: message.role,
            content: String(message.content ?? ''),
        }));
    }

    const normalized = [];
    if (systemPrompt) normalized.push({ role: 'system', content: String(systemPrompt) });
    if (prompt) normalized.push({ role: 'user', content: String(prompt) });
    return normalized;
}

export function createGenerationRequest(input = {}) {
    const messages = normalizeMessages(input);
    if (messages.length === 0) throw new TypeError('Generation requires a prompt or messages.');

    return Object.freeze({
        messages,
        model: input.model ?? null,
        maxTokens: input.maxTokens ?? null,
        temperature: input.temperature ?? null,
        stop: input.stop ?? null,
        prefill: input.prefill ?? '',
        metadata: Object.freeze({ ...(input.metadata ?? {}) }),
        signal: input.signal ?? null,
    });
}

export function assertGenerationProvider(provider, name = 'provider') {
    if (!provider || typeof provider.generate !== 'function') {
        throw new TypeError(`${name} must expose an async generate(request) function.`);
    }
    return provider;
}

export function normalizeGenerationResult(result, providerName) {
    const text = typeof result === 'string' ? result : result?.text;
    if (typeof text !== 'string') {
        throw new TypeError(`Generation provider ${providerName} returned no text.`);
    }

    return Object.freeze({
        text,
        provider: providerName,
        model: typeof result === 'object' ? result.model ?? null : null,
        usage: typeof result === 'object' ? result.usage ?? null : null,
        raw: typeof result === 'object' ? result.raw ?? result : result,
    });
}
