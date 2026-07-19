export function createContextPackage(result) {
    const byPosition = Object.fromEntries(
        Object.entries(result.grouped ?? {}).map(([position, entries]) => [
            position,
            entries.map(entry => entry.content).join('\n\n'),
        ]),
    );

    const messages = result.selected.map(entry => Object.freeze({
        role: entry.role,
        content: entry.content,
        name: entry.source,
        metadata: {
            contributionId: entry.id,
            position: entry.position,
            priority: entry.priority,
            ...entry.metadata,
        },
    }));

    return Object.freeze({
        text: result.selected.map(entry => entry.content).join('\n\n'),
        byPosition: Object.freeze(byPosition),
        messages: Object.freeze(messages),
        selected: result.selected,
        omitted: result.omitted,
        errors: result.errors,
        usedTokens: result.usedTokens,
        maxTokens: result.maxTokens,
    });
}
