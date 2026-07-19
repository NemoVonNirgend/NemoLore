import test from 'node:test';
import assert from 'node:assert/strict';

import { createNounDetector } from '../src/lore/noun-detector.js';

const settings = {
    nounMinLength: 3,
    excludeCommonWords: true,
};

const logger = {
    debug() {},
    warn() {},
    error() {},
};

const detector = createNounDetector({ settings, logger });

test('detects named characters and locations', () => {
    const nouns = detector.detect('Professor Vale entered the Tower of London with Mara Voss.');

    assert.ok(nouns.includes('Professor Vale'));
    assert.ok(nouns.includes('Tower of London'));
    assert.ok(nouns.includes('Mara Voss'));
});

test('removes formatting before detection', () => {
    const nouns = detector.detect('**Captain Rowan** opened the door to *Blackwood Manor*.');

    assert.ok(nouns.includes('Captain Rowan'));
    assert.ok(nouns.includes('Blackwood Manor'));
});

test('prefers compound names over contained words', () => {
    const nouns = detector.detect('Mara Voss met Mara near the Blackwood Market.');

    assert.ok(nouns.includes('Mara Voss'));
    assert.equal(nouns.includes('Mara'), false);
});

test('filters dates and common connective words', () => {
    const nouns = detector.detect('On Monday in January 2026, they went there.');

    assert.equal(nouns.includes('Monday'), false);
    assert.equal(nouns.includes('January'), false);
    assert.equal(nouns.includes('2026'), false);
});
