export function createLoreHelperWorkflow({ lore }) {
    if (!lore?.generate) throw new TypeError('Lore workflow requires lore generation service.');
    return async function run(payload = {}) {
        const messages = payload.messages ?? payload.context?.messages ?? [];
        const input = payload.input ?? messages.map(message => `${message.name ?? (message.is_user ? 'User' : 'Assistant')}: ${message.mes ?? message.content ?? ''}`).join('\n');
        return lore.generate({ ...payload, input });
    };
}
