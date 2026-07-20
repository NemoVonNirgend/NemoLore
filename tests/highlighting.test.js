import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createHighlighter, highlightTextSegments, segmentHighlightedText } from '../src/ui/highlighting.js';

class FakeNode {
    constructor(nodeType, ownerDocument) {
        this.nodeType = nodeType;
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
    }

    replaceWith(replacement) {
        const index = this.parentNode.childNodes.indexOf(this);
        const replacements = replacement.nodeType === 11 ? [...replacement.childNodes] : [replacement];
        this.parentNode.childNodes.splice(index, 1, ...replacements);
        for (const node of replacements) node.parentNode = this.parentNode;
        this.parentNode = null;
    }
}

class FakeText extends FakeNode {
    constructor(text, ownerDocument) {
        super(3, ownerDocument);
        this.value = text;
    }

    get textContent() {
        return this.value;
    }

    set textContent(value) {
        this.value = value;
    }
}

class FakeParent extends FakeNode {
    constructor(nodeType, ownerDocument) {
        super(nodeType, ownerDocument);
        this.childNodes = [];
    }

    append(node) {
        this.childNodes.push(node);
        node.parentNode = this;
    }

    get textContent() {
        return this.childNodes.map(node => node.textContent).join('');
    }
}

class FakeElement extends FakeParent {
    constructor(tagName, ownerDocument) {
        super(1, ownerDocument);
        this.tagName = tagName.toUpperCase();
        this.attributes = new Map();
        this.dataset = {};
        const classes = new Set();
        this.classList = {
            add: value => classes.add(value),
            contains: value => classes.has(value),
        };
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    get textContent() {
        return super.textContent;
    }

    set textContent(value) {
        this.childNodes = [this.ownerDocument.createTextNode(value)];
        this.childNodes[0].parentNode = this;
    }
}

class FakeFragment extends FakeParent {
    constructor(ownerDocument) {
        super(11, ownerDocument);
    }
}

class FakeDocument {
    createTextNode(text) {
        return new FakeText(text, this);
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    createDocumentFragment() {
        return new FakeFragment(this);
    }
}

function findElements(root, predicate) {
    const matches = [];
    for (const child of root.childNodes ?? []) {
        if (child.nodeType !== 1) continue;
        if (predicate(child)) matches.push(child);
        matches.push(...findElements(child, predicate));
    }
    return matches;
}

test('segments overlapping nouns once with longer matches first', () => {
    const segments = segmentHighlightedText('Mara Voss met Mara.', ['Mara', 'Mara Voss']);

    assert.deepEqual(segments, [
        { text: 'Mara Voss', noun: 'Mara Voss' },
        { text: ' met ' },
        { text: 'Mara', noun: 'Mara' },
        { text: '.' },
    ]);
});

test('highlights text nodes without matching generated attributes or changing markup attributes', () => {
    const document = new FakeDocument();
    const root = document.createElement('div');
    root.setAttribute('data-description', 'Lorebook entry for Seraphina');
    root.append(document.createTextNode('Seraphina met Lorebook.'));

    const result = highlightTextSegments(root, ['Seraphina', 'Lorebook']);
    const highlights = findElements(root, element => element.classList.contains('nemolore-highlighted-noun'));

    assert.equal(result.changed, true);
    assert.equal(result.count, 2);
    assert.equal(root.getAttribute('data-description'), 'Lorebook entry for Seraphina');
    assert.deepEqual(highlights.map(element => element.dataset.noun), ['Seraphina', 'Lorebook']);
    assert.equal(highlights[0].getAttribute('aria-label'), 'Lorebook entry for Seraphina. Press Enter to view, or hold on mobile.');
    assert.equal(findElements(highlights[0], element => element.classList.contains('nemolore-highlighted-noun')).length, 0);
});

test('preserves nested markup and skips existing highlight spans', () => {
    const document = new FakeDocument();
    const root = document.createElement('div');
    const emphasis = document.createElement('em');
    emphasis.append(document.createTextNode('Seraphina'));
    const existing = document.createElement('span');
    existing.classList.add('nemolore-highlighted-noun');
    existing.dataset.noun = 'Lorebook';
    existing.append(document.createTextNode('Lorebook'));
    root.append(emphasis);
    root.append(document.createTextNode(' found the '));
    root.append(existing);

    const result = highlightTextSegments(root, ['Seraphina', 'Lorebook']);
    const highlights = findElements(root, element => element.classList.contains('nemolore-highlighted-noun'));

    assert.equal(result.count, 1);
    assert.equal(root.childNodes[0], emphasis);
    assert.equal(root.childNodes.at(-1), existing);
    assert.deepEqual(highlights.map(element => element.dataset.noun), ['Seraphina', 'Lorebook']);
});

test('modular highlighter uses the safe text-node pass', () => {
    const document = new FakeDocument();
    const root = document.createElement('div');
    root.append(document.createTextNode('Seraphina opened the Lorebook.'));
    const highlightedNouns = new Set();
    const highlighter = createHighlighter({
        settings: { highlightNouns: true },
        state: { raw: { collections: { highlightedNouns } } },
        logger: { debug() {} },
    });

    assert.equal(highlighter.highlight(root, ['Seraphina', 'Lorebook']), true);
    assert.equal(root.getAttribute('data-nemolore-processed'), 'true');
    assert.deepEqual([...highlightedNouns], ['Seraphina', 'Lorebook']);
    assert.equal(findElements(root, element => element.classList.contains('nemolore-highlighted-noun')).length, 2);
});

test('legacy highlighter delegates to the shared safe text-node pass', async () => {
    const source = await readFile('index.js', 'utf8');
    const start = source.indexOf('static highlightNouns(element, nouns)');
    const end = source.indexOf('// Lorebook management', start);
    const implementation = source.slice(start, end);

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.match(implementation, /highlightTextSegments\(element, nouns\)/);
    assert.doesNotMatch(implementation, /element\.innerHTML|Generated invalid HTML/);
});
