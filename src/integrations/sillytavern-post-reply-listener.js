function resolveMessageIndex(eventArgs, chat) {
    for (const value of eventArgs) {
        if (Number.isInteger(value) && value >= 0 && value < chat.length) return value;
        if (Number.isInteger(value?.messageId) && value.messageId >= 0 && value.messageId < chat.length) return value.messageId;
        if (Number.isInteger(value?.index) && value.index >= 0 && value.index < chat.length) return value.index;
    }
    return chat.length - 1;
}

function findPreviousUserMessage(chat, assistantIndex) {
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        if (chat[index]?.is_user) return { index, message: chat[index] };
    }
    return null;
}

export function createSillyTavernPostReplyListener({
    eventSource,
    messageReceivedEvent,
    getContext,
    getChatId,
    dispatcher,
    logger,
} = {}) {
    if (!eventSource?.on) throw new TypeError('Post-reply listener requires an event source.');
    if (!messageReceivedEvent) throw new TypeError('Post-reply listener requires a message-received event name.');
    if (typeof getContext !== 'function') throw new TypeError('Post-reply listener requires getContext().');
    if (!dispatcher?.dispatch) throw new TypeError('Post-reply listener requires a dispatcher.');

    let installed = false;

    function onMessageReceived(...eventArgs) {
        try {
            const context = getContext();
            const chat = context?.chat ?? [];
            if (!chat.length) return [];

            const assistantIndex = resolveMessageIndex(eventArgs, chat);
            const assistantMessage = chat[assistantIndex];
            if (!assistantMessage || assistantMessage.is_user) return [];

            const previousUser = findPreviousUserMessage(chat, assistantIndex);
            const chatId = getChatId?.() ?? context?.chatId ?? null;
            const messageId = assistantMessage.send_date ?? assistantMessage.extra?.id ?? assistantIndex;
            const messages = [previousUser?.message, assistantMessage].filter(Boolean);
            const sources = [
                previousUser && {
                    chatId,
                    messageId: String(previousUser.message.send_date ?? previousUser.index),
                    messageIndex: previousUser.index,
                    role: 'user',
                    text: previousUser.message.mes ?? '',
                },
                {
                    chatId,
                    messageId: String(messageId),
                    messageIndex: assistantIndex,
                    role: 'assistant',
                    text: assistantMessage.mes ?? '',
                },
            ].filter(Boolean);

            return dispatcher.dispatch({
                chatId,
                messageId: String(messageId),
                messageCount: assistantIndex + 1,
                input: sources.map(source => `${source.role}: ${source.text}`).join('\n\n'),
                messages,
                sources,
                context: {
                    chat: chat.slice(0, assistantIndex + 1),
                    chatLength: assistantIndex + 1,
                    messages,
                    assistantIndex,
                    userIndex: previousUser?.index ?? null,
                    assistantMessage,
                    userMessage: previousUser?.message ?? null,
                },
            });
        } catch (error) {
            logger?.error('Post-reply helper dispatch failed.', error);
            return [];
        }
    }

    function install() {
        if (installed) return false;
        eventSource.on(messageReceivedEvent, onMessageReceived);
        installed = true;
        return true;
    }

    function uninstall() {
        if (!installed) return false;
        eventSource.removeListener?.(messageReceivedEvent, onMessageReceived);
        eventSource.off?.(messageReceivedEvent, onMessageReceived);
        installed = false;
        return true;
    }

    return Object.freeze({ install, uninstall, onMessageReceived, get installed() { return installed; } });
}
