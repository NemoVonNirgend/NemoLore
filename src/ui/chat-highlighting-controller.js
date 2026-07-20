export function createChatHighlightingController({
    eventSource,
    messageEvent,
    chatEvents = [],
    nounDetector,
    highlighter,
    queryMessages = () => [...document.querySelectorAll('#chat .mes_text')],
    schedule = queueMicrotask,
    logger,
} = {}) {
    if (!eventSource?.on) throw new TypeError('Chat highlighting requires an event source.');
    if (!nounDetector?.detect || !highlighter?.highlight) throw new TypeError('Chat highlighting requires noun detection and highlighting services.');
    let installed = false;
    let scheduled = false;

    function refresh() {
        scheduled = false;
        let highlighted = 0;
        for (const element of queryMessages()) {
            const nouns = nounDetector.detect(element.textContent ?? '');
            if (nouns.length && highlighter.highlight(element, nouns)) highlighted += 1;
        }
        logger?.debug('Refreshed modular chat highlighting.', { highlighted });
        return highlighted;
    }

    function requestRefresh() {
        if (scheduled) return false;
        scheduled = true;
        schedule(refresh);
        return true;
    }

    function install() {
        if (installed) return false;
        if (messageEvent) eventSource.on(messageEvent, requestRefresh);
        for (const event of chatEvents.filter(Boolean)) eventSource.on(event, requestRefresh);
        installed = true;
        requestRefresh();
        return true;
    }

    function uninstall() {
        if (!installed) return false;
        if (messageEvent) {
            eventSource.removeListener?.(messageEvent, requestRefresh);
            eventSource.off?.(messageEvent, requestRefresh);
        }
        for (const event of chatEvents.filter(Boolean)) {
            eventSource.removeListener?.(event, requestRefresh);
            eventSource.off?.(event, requestRefresh);
        }
        installed = false;
        return true;
    }

    return Object.freeze({ install, uninstall, refresh, requestRefresh, get installed() { return installed; } });
}
