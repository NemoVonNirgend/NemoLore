function buildHeaders(apiKey, extraHeaders = {}) {
    return {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...extraHeaders,
    };
}

export function createOpenAICompatibleProvider({
    endpoint,
    apiKey = '',
    model = '',
    fetchImpl = globalThis.fetch,
    headers = {},
}) {
    if (!endpoint) throw new TypeError('OpenAI-compatible provider requires an endpoint.');
    if (typeof fetchImpl !== 'function') throw new TypeError('OpenAI-compatible provider requires fetch.');

    return Object.freeze({
        async generate(request) {
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: buildHeaders(apiKey, headers),
                signal: request.signal,
                body: JSON.stringify({
                    model: request.model ?? model,
                    messages: request.messages,
                    ...(request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
                    ...(request.temperature != null ? { temperature: request.temperature } : {}),
                    ...(request.stop != null ? { stop: request.stop } : {}),
                }),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`Generation request failed (${response.status}): ${body || response.statusText}`);
            }

            const payload = await response.json();
            const text = payload?.choices?.[0]?.message?.content
                ?? payload?.choices?.[0]?.text
                ?? payload?.output_text;

            if (typeof text !== 'string') {
                throw new TypeError('OpenAI-compatible provider returned no text.');
            }

            return {
                text,
                model: payload.model ?? request.model ?? model,
                usage: payload.usage ?? null,
                raw: payload,
            };
        },
    });
}
