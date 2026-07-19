function messageId(message, index) {
    return String(message?.mesid ?? message?.id ?? index);
}

function messageText(message) {
    return String(message?.mes ?? message?.content ?? '').trim();
}

export function createSillyTavernContextRequestFactory({ getChatId, getContext, recentMessageCount = 8 } = {}) {
    return async function build({ chat, contextSize, type } = {}) {
        const context = getContext?.() ?? {};
        const messages = Array.isArray(chat) ? chat : (context.chat ?? []);
        const recent = messages.slice(-recentMessageCount);
        const chatId = getChatId?.() ?? context.chatId ?? null;
        const latest = recent.at(-1);
        const input = recent.map(messageText).filter(Boolean).join('\n\n');
        const sources = recent.map((message, offset) => ({
            chatId: String(chatId ?? 'unknown-chat'),
            messageId: messageId(message, messages.length - recent.length + offset),
            content: messageText(message),
            role: message?.is_user ? 'user' : 'assistant',
        }));

        const entityIds = [...new Set(recent
            .map(message => String(message?.name ?? '').trim())
            .filter(Boolean))];

        return {
            contextRequest: {
                text: messageText(latest),
                prompt: messageText(latest),
                entityIds,
                maxTokens: Math.max(0, Math.floor(Number(contextSize ?? 0) * 0.12)),
                generationType: type,
            },
            contextOptions: {
                maxTokens: Math.max(500, Math.min(2400, Math.floor(Number(contextSize ?? 8000) * 0.12))),
            },
            postReply: {
                chatId: String(chatId ?? 'unknown-chat'),
                messageId: messageId(latest, messages.length - 1),
                input,
                sources,
                context: { generationType: type, entityIds },
            },
        };
    };
}
