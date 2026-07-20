import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernPreferenceListener } from '../src/integrations/sillytavern-preference-listener.js';

function setup() {
    const listeners = new Map();
    const chat = [{ is_user: false, mes: 'first', swipes: ['first', 'second'], swipe_id: 0 }];
    const calls = [];
    const eventSource = {
        on(name, handler) { listeners.set(name, handler); },
        removeListener(name) { listeners.delete(name); },
    };
    const listener = createSillyTavernPreferenceListener({
        eventSource,
        events: { chatChanged: 'chat', messageSwiped: 'swipe', messageEdited: 'edit', userMessageRendered: 'user' },
        getContext: () => ({ chat, chatId: 'chat-1' }),
        getChatId: () => 'chat-1',
        collector: {
            recordSwipeChoice: value => { calls.push(['swipe', value]); return value; },
            recordEdit: value => { calls.push(['edit', value]); return value; },
        },
    });
    listener.install();
    return { chat, calls, listeners, listener };
}

test('preference listener compares swipes and edits against its prior snapshot', () => {
    const context = setup();
    context.chat[0].swipe_id = 1;
    context.chat[0].mes = 'second';
    context.listeners.get('swipe')(0);
    assert.equal(context.calls[0][0], 'swipe');
    assert.equal(context.calls[0][1].acceptedText, 'second');
    assert.equal(context.calls[0][1].rejectedText, 'first');

    context.chat[0].swipes[1] = 'second revised';
    context.chat[0].mes = 'second revised';
    context.listeners.get('edit')(0);
    assert.equal(context.calls[1][0], 'edit');
    assert.equal(context.calls[1][1].rejectedText, 'second');
});

test('continuation evidence is recorded once for the selected swipe', () => {
    const context = setup();
    context.chat.push({ is_user: true, mes: 'continue' });
    context.listeners.get('user')(1);
    context.listeners.get('user')(1);
    assert.equal(context.calls.length, 1);
    assert.equal(context.calls[0][1].acceptedText, 'first');
    assert.match(context.calls[0][1].rejectedText, /second/);
    context.listener.uninstall();
    assert.equal(context.listeners.size, 0);
});
