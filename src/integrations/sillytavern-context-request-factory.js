function messageId(message, index) {
    return String(message?.mesid ?? message?.id ?? index);
}

function messageText(message) {
    return String(message?.mes ?? message?.content ?? '').trim();
}

function normalizePersonaId(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

export function createSillyTavernContextRequestFactory({ getChatId, getContext, getPersonaId, settings, recentMessageCount = 8 } = {}) {
    return async function build({ chat, contextSize, type } = {}) {
        const context = getContext?.() ?? {};
<<<<<<< HEAD
        const contextChat = Array.isArray(context.chat) ? context.chat : null;
        const messages = Array.isArray(chat) ? chat : (contextChat ?? []);
        const messageCount = contextChat?.length ?? messages.length;
        const recent = messages.slice(-recentMessageCount);
        const chatId = getChatId?.() ?? context.chatId ?? null;
        const normalizedChatId = String(chatId ?? 'unknown-chat');
=======
        const personaId = normalizePersonaId(getPersonaId?.() ?? context.personaId ?? context.userPersonaId ?? context.user_avatar);
        const messages = Array.isArray(chat) ? chat : (context.chat ?? []);
        const configuredCount = Number(settings?.summaryChunkSize ?? recentMessageCount);
        const activeMessageCount = Math.max(2, Math.min(50, configuredCount > 0 ? configuredCount : recentMessageCount));
        const recent = messages.slice(-activeMessageCount);
        const chatId = getChatId?.() ?? context.chatId ?? null;
        const normalizedChatId = String(chatId ?? 'unknown-chat');
        const messageCount = Array.isArray(context.chat) ? context.chat.length : messages.length;
>>>>>>> dev/preset-architecture
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
                personaId,
                maxTokens: Math.max(0, Math.floor(Number(contextSize ?? 0) * 0.12)),
                memoryMaxTokens: Math.max(100, Number(settings?.memoryContextBudget ?? 1200)),
                memoryCandidateLimit: Math.max(1, Number(settings?.memoryCandidateLimit ?? 16)),
                generationType: type,
            },
            contextOptions: {
                maxTokens: Math.max(500, Math.min(
                    Number(settings?.memoryContextBudget ?? 2400),
                    Math.floor(Number(contextSize ?? 8000) * 0.12),
                )),
            },
            postReply: {
                chatId: normalizedChatId,
                messageId: messageId(latest, messages.length - 1),
                messageCount,
                input,
                sources,
<<<<<<< HEAD
                context: { generationType: type, entityIds, chatLength: messageCount },
=======
                context: { generationType: type, entityIds, personaId, chatLength: messageCount },
>>>>>>> dev/preset-architecture
            },
        };
    };
}
