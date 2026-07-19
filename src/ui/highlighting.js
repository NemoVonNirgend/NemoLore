function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isValidGeneratedHtml(html, logger) {
    try {
        const openSpans = (html.match(/<span[^>]*>/g) ?? []).length;
        const closeSpans = (html.match(/<\/span>/g) ?? []).length;
        const hasUnclosedQuotes = /data-noun="[^"]*</.test(html);
        const hasNestedSpans = /data-noun="[^"]*<span/.test(html);

        if (openSpans !== closeSpans || hasUnclosedQuotes || hasNestedSpans) {
            logger.warn('Rejected malformed highlighted HTML.');
            return false;
        }

        return true;
    } catch (error) {
        logger.error('Unable to validate highlighted HTML.', error);
        return false;
    }
}

export function createHighlighter({ settings, state, logger }) {
    function highlight(element, nouns) {
        if (!settings.highlightNouns || !element || element.hasAttribute('data-nemolore-processed')) {
            return false;
        }

        let html = element.innerHTML;
        const originalHtml = html;
        let changed = false;

        for (const noun of [...nouns].sort((a, b) => b.length - a.length)) {
            if (html.includes(`data-noun="${noun}"`)) continue;

            const regex = new RegExp(`\\b(${escapeRegExp(noun)})\\b`, 'gi');
            let matchCount = 0;

            const nextHtml = html.replace(regex, (match) => {
                matchCount += 1;
                return `<span class="nemolore-highlighted-noun" data-noun="${noun}" role="button" tabindex="0" aria-label="Lorebook entry for ${noun}. Press Enter to view, or hold on mobile." title="Click for lorebook info, hold on mobile">${match}</span>`;
            });

            if (matchCount > 0) {
                html = nextHtml;
                changed = true;
            }
        }

        element.setAttribute('data-nemolore-processed', 'true');

        if (!changed) return false;
        if (!isValidGeneratedHtml(html, logger)) {
            element.innerHTML = originalHtml;
            return false;
        }

        element.innerHTML = html;
        for (const noun of nouns) state.highlightedNouns.add(noun);
        logger.debug('Applied noun highlighting.', { count: nouns.length });
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
