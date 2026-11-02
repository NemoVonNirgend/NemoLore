import { messageIdentity, messageRevision } from '../core/helper-source-guard.js';

const NON_REPLY_MESSAGE_TYPES = new Set([
    'first_message',
    'command',
    'extension',
    'image',
    'image_generation',
    'tool',
    'tool_call',
    'function',
    'function_call',
    'quiet',
    'summary',
    'summarize',
    'helper',
    'memory',
    'impersonate',
]);

const NON_REPLY_TYPE_FRAGMENTS = Object.freeze([
    'image',
    'tool',
    'function',
    'extension',
    'background',
    'caption',
    'helper',
    'summary',
    'memory',
]);

function resolveMessageIndex(eventArgs, chat) {
    for (const value of eventArgs) {
        const index = typeof value === 'number' ? value : typeof value?.messageId === 'number' ? value.messageId : value?.index;
        if (typeof index === 'number') return Number.isInteger(index) && index >= 0 && index < chat.length ? index : -1;
    }
    return chat.length - 1;
}

function resolveMessageType(eventArgs) {
    for (const value of eventArgs) {
        const type = typeof value === 'string'
            ? value
            : value?.generationType ?? value?.type;
        if (typeof type === 'string' && type.trim()) return type.trim().toLowerCase();
    }
    return null;
}

function hasNonReplyType(type) {
    if (!type) return false;
    if (NON_REPLY_MESSAGE_TYPES.has(type)) return true;
    return NON_REPLY_TYPE_FRAGMENTS.some(fragment => type.includes(fragment));
}

function isGeneratedMediaMessage(message) {
    if (!message) return false;

    const extra = message.extra ?? {};
    const metadataType = String(
        extra.generationType
        ?? extra.generation_type
        ?? extra.type
        ?? extra.messageType
        ?? extra.message_type
        ?? '',
    ).toLowerCase();

    if (hasNonReplyType(metadataType)) return true;

    if (
        extra.image
        || extra.inline_image
        || extra.image_swipes
        || extra.media
        || extra.media_url
        || extra.tool_call
        || extra.tool_calls
        || extra.function_call
        || extra.extension
    ) {
        return true;
    }

    const text = String(message.mes ?? '').trim();
    if (!text) return true;

    // Image-generation extensions commonly emit a message containing only an
    // image, media wrapper, or generated-file link. Those are UI artifacts,
    // not prose replies and must never become preference/slop evidence.
    const withoutMedia = text
        .replace(/!\[[^\]]*]\([^)]*\)/g, '')
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<video\b[\s\S]*?<\/video>/gi, '')
        .replace(/<audio\b[\s\S]*?<\/audio>/gi, '')
        .replace(/\[(?:image|img|video|audio|media)[^\]]*]/gi, '')
        .trim();

    return withoutMedia.length === 0;
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
    messageDeletedEvent,
    messageEditedEvent,
    messageSwipedEvent,
    chatChangedEvent,
    chatLoadedEvent,
    getContext,
    getChatId,
    dispatcher,
    onSourcesChanged,
    logger,
} = {}) {
    if (!eventSource?.on) throw new TypeError('Post-reply listener requires an event source.');
    if (!messageReceivedEvent) throw new TypeError('Post-reply listener requires a message-received event name.');
    if (typeof getContext !== 'function') throw new TypeError('Post-reply listener requires getContext().');
    if (!dispatcher?.dispatch) throw new TypeError('Post-reply listener requires a dispatcher.');

    let installed = false;
    let observedChatId = null;
    let observed = [];
    const mutationEvents = [...new Set([messageDeletedEvent, messageEditedEvent, messageSwipedEvent, chatChangedEvent, chatLoadedEvent].filter(Boolean))];

    function reconcile(context = getContext()) {
        const chatId = String(getChatId?.() ?? context?.chatId ?? '');
        const next = (context?.chat ?? []).map((message, index) => `${messageIdentity(message, index)}:${messageRevision(message)}`);
        let changed = 0;
        while (changed < observed.length && observed[changed] === next[changed]) changed++;
        const replaced = observedChatId === chatId && changed < observed.length;
        observedChatId = chatId;
        observed = next;
        if (replaced) {
            return Promise.resolve(onSourcesChanged?.({ chatId, firstChangedIndex: changed }))
                .catch(error => logger?.error('Unable to invalidate changed helper sources.', error));
        }
    }

    function onMessagesChanged() {
        try { return reconcile(); } catch (error) { logger?.error('Unable to reconcile helper sources.', error); }
    }

    function onMessageReceived(...eventArgs) {
        try {
            const messageType = resolveMessageType(eventArgs);
            if (hasNonReplyType(messageType)) return [];

            const context = getContext();
            const chat = context?.chat ?? [];
            if (!chat.length) return [];

            const assistantIndex = resolveMessageIndex(eventArgs, chat);
            const assistantMessage = chat[assistantIndex];
            if (!assistantMessage || assistantMessage.is_user || assistantMessage.is_system || isGeneratedMediaMessage(assistantMessage)) return [];
            reconcile(context);

            const previousUser = findPreviousUserMessage(chat, assistantIndex);
            const chatId = getChatId?.() ?? context?.chatId ?? null;
            const messageId = messageIdentity(assistantMessage, assistantIndex);
            const messages = [previousUser?.message, assistantMessage].filter(Boolean);
            const sources = [
                previousUser && {
                    chatId,
                    messageId: String(previousUser.message.send_date ?? previousUser.index),
                    messageIndex: previousUser.index,
                    role: 'user',
                    text: previousUser.message.mes ?? '',
                    hash: messageRevision(previousUser.message),
                },
                {
                    chatId,
                    messageId: String(messageId),
                    messageIndex: assistantIndex,
                    role: 'assistant',
                    text: assistantMessage.mes ?? '',
                    hash: messageRevision(assistantMessage),
                },
            ].filter(Boolean);

            return dispatcher.dispatch({
                chatId,
                messageId: String(messageId),
                revisionKey: `${assistantIndex}:${previousUser ? messageRevision(previousUser.message) : ''}:${messageRevision(assistantMessage)}`,
                messageCount: chat.length,
                input: sources.map(source => `${source.role}: ${source.text}`).join('\n\n'),
                messages,
                sources,
                context: {
                    chat: chat.slice(0, assistantIndex + 1),
                    chatLength: assistantIndex + 1,
                    messages,
                    generationType: messageType,
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
        for (const event of mutationEvents) eventSource.on(event, onMessagesChanged);
        reconcile();
        installed = true;
        return true;
    }

    function uninstall() {
        if (!installed) return false;
        eventSource.removeListener?.(messageReceivedEvent, onMessageReceived);
        eventSource.off?.(messageReceivedEvent, onMessageReceived);
        for (const event of mutationEvents) {
            if (typeof eventSource.removeListener === 'function') eventSource.removeListener(event, onMessagesChanged);
            else eventSource.off?.(event, onMessagesChanged);
        }
        observedChatId = null;
        observed = [];
        installed = false;
        return true;
    }

    return Object.freeze({ install, uninstall, onMessageReceived, onMessagesChanged, get installed() { return installed; } });
}
