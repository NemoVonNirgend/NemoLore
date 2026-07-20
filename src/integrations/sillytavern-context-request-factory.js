function messageId(message, index) {
    return String(message?.mesid ?? message?.id ?? index);
}

function messageText(message) {
    return String(message?.mes ?? message?.content ?? '').trim();
}

export function createSillyTavernContextRequestFactory({ getChatId, getContext, recentMessageCount = 8 } = {}) {
    return async function build({ chat, contextSize, type } = {}) {
        const context = getContext?.() ?? {};
        const contextChat = Array.isArray(context.chat) ? context.chat : null;
        const messages = Array.isArray(chat) ? chat : (contextChat ?? []);
        const messageCount = contextChat?.length ?? messages.length;
        const recent = messages.slice(-recentMessageCount);
        const chatId = getChatId?.() ?? context.chatId ?? null;
        const normalizedChatId = String(chatId ?? 'unknown-chat');
        const latest = recent.at(-1);
        const input = recent.map(messageText).filter(Boolean).join('\n\n');
        const sources = recent.map((message, offset) => ({
            chatId: normalizedChatId,
            messageId: messageId(message, messages.length - recent.length + offset),
            content: messageText(message),
            role: message?.is_user ? 'user' : 'assistant',
        }));

        const entityIds = [...new Set(recent
            .map(message => String(message?.name ?? '').trim())
            .filter(Boolean))];

        return {
            contextRequest: {
                chatId: normalizedChatId,
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
                chatId: normalizedChatId,
                messageId: messageId(latest, messages.length - 1),
                messageCount,
                input,
                sources,
                context: { generationType: type, entityIds, chatLength: messageCount },
            },
        };
    };
}
