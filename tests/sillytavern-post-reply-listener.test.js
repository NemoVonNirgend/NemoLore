import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernPostReplyListener } from '../src/integrations/sillytavern-post-reply-listener.js';

test('dispatches helper work from a completed assistant message', () => {
    const handlers = new Map();
    const eventSource = {
        on(event, handler) { handlers.set(event, handler); },
        off(event) { handlers.delete(event); },
    };
    const dispatched = [];
    const chat = [
        { is_user: true, mes: 'Where is the key?', send_date: 'u1' },
        { is_user: false, mes: 'Marcus reveals it is under the altar.', send_date: 'a1' },
    ];

    const listener = createSillyTavernPostReplyListener({
        eventSource,
        messageReceivedEvent: 'message_received',
        getContext: () => ({ chat }),
        getChatId: () => 'chat-1',
        dispatcher: { dispatch(payload) { dispatched.push(payload); return ['job']; } },
    });

    assert.equal(listener.install(), true);
    const jobs = handlers.get('message_received')(1, 'normal');

    assert.deepEqual(jobs, ['job']);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].chatId, 'chat-1');
    assert.equal(dispatched[0].messageId, 'a1');
    assert.match(dispatched[0].input, /Where is the key/);
    assert.match(dispatched[0].input, /under the altar/);
    assert.deepEqual(dispatched[0].sources.map(source => source.role), ['user', 'assistant']);
    assert.equal(dispatched[0].messageCount, 2);
    assert.equal(dispatched[0].context.chatLength, 2);
    assert.equal(dispatched[0].context.generationType, 'normal');
});

test('ignores SillyTavern message events that are not generated replies', () => {
    const dispatched = [];
    const chat = [{ is_user: false, mes: 'Synthetic message' }];
    const listener = createSillyTavernPostReplyListener({
        eventSource: { on() {} },
        messageReceivedEvent: 'message_received',
        getContext: () => ({ chat }),
        dispatcher: { dispatch(payload) { dispatched.push(payload); } },
    });

    for (const type of ['first_message', 'command', 'extension']) {
        assert.deepEqual(listener.onMessageReceived(0, type), []);
    }
    assert.equal(dispatched.length, 0);
});

test('ignores user-message events', () => {
    const dispatched = [];
    const listener = createSillyTavernPostReplyListener({
        eventSource: { on() {} },
        messageReceivedEvent: 'message_received',
        getContext: () => ({ chat: [{ is_user: true, mes: 'Hello' }] }),
        dispatcher: { dispatch(payload) { dispatched.push(payload); } },
    });

    const result = listener.onMessageReceived(0);
    assert.deepEqual(result, []);
    assert.equal(dispatched.length, 0);
});
