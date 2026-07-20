function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
}

function addDefinition(list, label, value) {
    list.append(makeElement('dt', '', label), makeElement('dd', '', value));
}

export function createObservabilityPanel({ observability, logger } = {}) {
    if (!observability?.snapshot) throw new TypeError('Observability panel requires an observability service.');
    let root = null;

    function render() {
        if (!root) return null;
        const data = observability.snapshot();
        root.replaceChildren();

        const header = makeElement('header', 'nemolore-inspector-header');
        const closeButton = makeElement('button', 'menu_button', 'Close');
        closeButton.addEventListener('click', close);
        header.append(makeElement('h2', '', 'NemoLore Inspector'), closeButton);
        root.append(header);

        const overview = makeElement('dl', 'nemolore-inspector-overview');
        addDefinition(overview, 'Chat', data.chatId ?? '(none)');
        addDefinition(overview, 'Context', data.context ? `${data.context.usedTokens}/${data.context.maxTokens} tokens` : 'Not yet built');
        addDefinition(overview, 'Memories', `${data.memory.active} active / ${data.memory.total} total`);
        addDefinition(overview, 'Preferences', `${data.preferences.accepted} accepted, ${data.preferences.candidates} awaiting review, ${data.preferences.evidence} evidence items`);
        if (data.semanticMemory) {
            const semantic = data.semanticMemory;
            const status = !semantic.enabled ? 'Disabled by profile'
                : !semantic.available ? `Unavailable: ${semantic.unavailableReason ?? 'configure Vector Storage'}`
                    : `${semantic.indexedCount}/${semantic.activeMemoryCount} indexed${semantic.dirtyCount ? `, ${semantic.dirtyCount} pending` : ''}`;
            addDefinition(overview, 'Semantic memory', status);
            addDefinition(overview, 'Embedding source', semantic.source ? `${semantic.source}${semantic.model ? ` · ${semantic.model}` : ''}` : 'None');
            if (semantic.lastError) addDefinition(overview, 'Semantic error', semantic.lastError);
            const rebuild = makeElement('button', 'menu_button', semantic.syncing ? 'Rebuilding…' : 'Rebuild Semantic Index');
            rebuild.disabled = semantic.syncing || !semantic.enabled || !semantic.available || !semantic.activeChatId;
            rebuild.addEventListener('click', async () => {
                rebuild.disabled = true;
                rebuild.textContent = 'Rebuilding…';
                await observability.rebuildSemanticIndex?.();
                render();
            });
            overview.append(makeElement('dt', '', 'Recovery'), makeElement('dd', '', ''));
            overview.lastElementChild.append(rebuild);
        }
        addDefinition(overview, 'Summary', data.summary?.text ? 'Available' : 'None');
        addDefinition(overview, 'Lorebook', data.lorebook ?? 'None');
        addDefinition(overview, 'Helpers', `${data.helpers.runtime?.running ?? 0} running, ${data.helpers.runtime?.queued ?? 0} queued`);
        root.append(overview);

        const contributions = makeElement('section', 'nemolore-inspector-section');
        contributions.append(makeElement('h3', '', 'Context Contributions'));
        for (const item of data.context?.selected ?? []) {
            contributions.append(makeElement('div', 'nemolore-inspector-item', `${item.source}: ${item.title || item.id} (${item.estimatedTokens ?? '?'} tokens)`));
        }
        for (const item of data.context?.omitted ?? []) {
            contributions.append(makeElement('div', 'nemolore-inspector-item nemolore-inspector-omitted', `Omitted ${item.source}: ${item.title || item.id} · ${item.omissionReason ?? 'unknown'}`));
        }
        if (!(data.context?.selected?.length || data.context?.omitted?.length)) contributions.append(makeElement('p', '', 'No context package has been built yet.'));
        root.append(contributions);

        const jobs = makeElement('section', 'nemolore-inspector-section');
        jobs.append(makeElement('h3', '', 'Helper Jobs'));
        for (const job of data.helpers.jobs.slice(-20).reverse()) jobs.append(makeElement('div', 'nemolore-inspector-item', `${job.agent}: ${job.status}`));
        if (!data.helpers.jobs.length) jobs.append(makeElement('p', '', 'No helper jobs recorded.'));
        root.append(jobs);
        return data;
    }

    function open() {
        if (root) {
            render();
            return root;
        }
        root = makeElement('aside', 'nemolore-inspector-panel');
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'NemoLore Inspector');
        document.body.append(root);
        render();
        logger?.debug('Opened NemoLore inspector.');
        return root;
    }

    function close() {
        root?.remove();
        root = null;
    }

    return Object.freeze({ open, close, render, get isOpen() { return Boolean(root); } });
}
