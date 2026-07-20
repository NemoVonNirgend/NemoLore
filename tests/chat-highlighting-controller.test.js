import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatHighlightingController } from '../src/ui/chat-highlighting-controller.js';

test('chat highlighting refreshes existing and newly received messages', () => {
    const listeners = new Map();
    const elements = [{ textContent: 'Marcus entered Blackwell Station.' }];
    const highlighted = [];
    const controller = createChatHighlightingController({
        eventSource: {
            on(event, handler) { listeners.set(event, handler); },
            off(event) { listeners.delete(event); },
        },
        messageEvent: 'message',
        chatEvents: ['chat'],
        nounDetector: { detect: text => text.includes('Marcus') ? ['Marcus'] : [] },
        highlighter: { highlight(element, nouns) { highlighted.push([element, nouns]); return true; } },
        queryMessages: () => elements,
        schedule: callback => callback(),
    });

    assert.equal(controller.install(), true);
    assert.equal(highlighted.length, 1);
    elements.push({ textContent: 'Nothing notable.' });
    listeners.get('message')();
    assert.equal(highlighted.length, 2);
    assert.equal(controller.uninstall(), true);
    assert.equal(listeners.size, 0);
});
