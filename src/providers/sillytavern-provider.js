function messagesToPrompt(messages) {
    return messages
        .map(message => `${message.role.toUpperCase()}:\n${message.content}`)
        .join('\n\n');
}

export function createSillyTavernProvider({ generate, logger }) {
    if (typeof generate !== 'function') {
        throw new TypeError('SillyTavern provider requires a generate function.');
    }

    return Object.freeze({
        async generate(request) {
            const prompt = messagesToPrompt(request.messages);
            const output = await generate({
                prompt,
                messages: request.messages,
                model: request.model,
                maxTokens: request.maxTokens,
                temperature: request.temperature,
                stop: request.stop,
                prefill: request.prefill,
                signal: request.signal,
                metadata: request.metadata,
            });

            const text = typeof output === 'string'
                ? output
                : output?.text ?? output?.content ?? output?.message?.content;

            if (typeof text !== 'string') {
                logger?.error('SillyTavern generation returned an unsupported response.', output);
                throw new TypeError('SillyTavern generation returned no text.');
            }

            return {
                text: request.prefill && text.startsWith(request.prefill)
                    ? text.slice(request.prefill.length)
                    : text,
                model: request.model,
                raw: output,
            };
        },
    });
}
