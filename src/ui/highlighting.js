function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeNouns(nouns) {
    const uniqueNouns = new Map();

    for (const value of nouns ?? []) {
        const noun = String(value).trim();
        const normalized = noun.toLowerCase();
        if (noun && !uniqueNouns.has(normalized)) uniqueNouns.set(normalized, noun);
    }

    return [...uniqueNouns.values()].sort((a, b) => b.length - a.length);
}

/**
 * Splits a text node into plain and highlighted segments in one matching pass.
 * Longer nouns win when candidates overlap, and the canonical noun is retained
 * for data attributes even when the visible match uses different casing.
 */
export function segmentHighlightedText(text, nouns) {
    const candidates = normalizeNouns(nouns);
    if (!text || candidates.length === 0) return [{ text: text ?? '' }];

    const nounByNormalizedValue = new Map(candidates.map(noun => [noun.toLowerCase(), noun]));
    const matcher = new RegExp(`\\b(${candidates.map(escapeRegExp).join('|')})\\b`, 'gi');
    const segments = [];
    let cursor = 0;

    for (const match of text.matchAll(matcher)) {
        const index = match.index ?? 0;
        if (index > cursor) segments.push({ text: text.slice(cursor, index) });

        segments.push({
            text: match[0],
            noun: nounByNormalizedValue.get(match[0].toLowerCase()) ?? match[0],
        });
        cursor = index + match[0].length;
    }

    if (cursor === 0) return [{ text }];
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments;
}

const SKIPPED_TEXT_CONTAINERS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);

function collectTextNodes(element) {
    const textNodes = [];

    function visit(parent) {
        for (const child of Array.from(parent.childNodes ?? [])) {
            if (child.nodeType === 3) {
                if (child.textContent) textNodes.push(child);
                continue;
            }

            if (child.nodeType !== 1
                || SKIPPED_TEXT_CONTAINERS.has(child.tagName)
                || child.classList?.contains('nemolore-highlighted-noun')) {
                continue;
            }

            visit(child);
        }
    }

    visit(element);
    return textNodes;
}

/**
 * Highlights only existing DOM text nodes. Markup and attributes are never
 * serialized or passed back through the noun matcher.
 */
export function highlightTextSegments(element, nouns) {
    const documentRef = element?.ownerDocument ?? globalThis.document;
    if (!element || !documentRef) return Object.freeze({ changed: false, count: 0 });

    let count = 0;
    const matchedNouns = new Set();

    for (const textNode of collectTextNodes(element)) {
        const segments = segmentHighlightedText(textNode.textContent ?? '', nouns);
        if (!segments.some(segment => segment.noun)) continue;

        const fragment = documentRef.createDocumentFragment();
        for (const segment of segments) {
            if (!segment.noun) {
                fragment.append(documentRef.createTextNode(segment.text));
                continue;
            }

            const span = documentRef.createElement('span');
            span.classList.add('nemolore-highlighted-noun');
            span.dataset.noun = segment.noun;
            span.setAttribute('role', 'button');
            span.setAttribute('tabindex', '0');
            span.setAttribute('aria-label', `Lorebook entry for ${segment.noun}. Press Enter to view, or hold on mobile.`);
            span.setAttribute('title', 'Click for lorebook info, hold on mobile');
            span.textContent = segment.text;
            fragment.append(span);
            matchedNouns.add(segment.noun);
            count += 1;
        }

        textNode.replaceWith(fragment);
    }

    return Object.freeze({ changed: count > 0, count, nouns: Object.freeze([...matchedNouns]) });
}

export function createHighlighter({ settings, state, logger }) {
    const highlightedNouns = state.raw.collections.highlightedNouns;

    function highlight(element, nouns) {
        if (!settings.highlightNouns || !element || element.hasAttribute('data-nemolore-processed')) {
            return false;
        }

        const result = highlightTextSegments(element, nouns);
        element.setAttribute('data-nemolore-processed', 'true');

        if (!result.changed) return false;

        for (const noun of nouns) highlightedNouns.add(noun);
        logger.debug('Applied noun highlighting.', { count: result.count });
        return true;
    }

    function clear(element) {
        if (!element) return;

        for (const span of element.querySelectorAll('.nemolore-highlighted-noun')) {
            span.replaceWith(document.createTextNode(span.textContent ?? ''));
        }

        element.removeAttribute('data-nemolore-processed');
        element.normalize();
    }

    return Object.freeze({ highlight, clear });
}
