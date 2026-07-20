import { createManagementPanelShell } from './management-panel-shell.js';

function field(labelText, control) {
    const row = document.createElement('label');
    row.className = 'nemolore-management-field';
    const label = document.createElement('span');
    label.textContent = labelText;
    row.append(label, control);
    return row;
}

function textInput(value = '') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole';
    input.value = value;
    return input;
}

function numberInput(value = 0) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.className = 'text_pole';
    input.value = String(value ?? 0);
    return input;
}

export function createMemoryManagementPanel({ management, logger } = {}) {
    if (!management?.list) throw new TypeError('Memory panel requires memory management service.');

    let shell = null;
    let unsubscribe = null;
    let selectedId = null;
    const filters = { search: '', type: '', status: '', reviewOnly: false };

    function close() {
        unsubscribe?.();
        unsubscribe = null;
        shell?.overlay.remove();
        shell = null;
        selectedId = null;
    }

    function renderList() {
        if (!shell) return;
        const listRoot = shell.sidebar.querySelector('.nemolore-memory-list');
        listRoot.replaceChildren();
        const records = management.list(filters);
        for (const record of records) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu_button nemolore-memory-item';
            if (record.id === selectedId) button.dataset.selected = 'true';
            const title = document.createElement('strong');
            title.textContent = record.title || record.content?.slice(0, 60) || record.id;
            const meta = document.createElement('small');
            meta.textContent = `${record.type} · ${record.status} · importance ${Number(record.importance ?? 0).toFixed(2)}`;
            button.append(title, meta);
            button.addEventListener('click', () => {
                selectedId = record.id;
                renderList();
                renderDetail(record.id);
            });
            listRoot.append(button);
        }
        if (!records.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No memories match these filters.';
            listRoot.append(empty);
        }
    }

    function renderDetail(id = selectedId) {
        if (!shell) return;
        shell.detail.replaceChildren();
        const record = id ? management.get(id) : null;
        if (!record) {
            const empty = document.createElement('p');
            empty.textContent = 'Select a memory to inspect or edit.';
            shell.detail.append(empty);
            return;
        }

        const title = textInput(record.title ?? '');
        const content = document.createElement('textarea');
        content.className = 'text_pole';
        content.rows = 8;
        content.value = record.content ?? '';
        const tags = textInput((record.tags ?? []).join(', '));
        const entities = textInput((record.entityIds ?? []).join(', '));
        const importance = numberInput(record.importance);
        const confidence = numberInput(record.confidence);

        const heading = document.createElement('h3');
        heading.textContent = record.title || 'Memory detail';
        const facts = document.createElement('pre');
        facts.className = 'nemolore-memory-provenance';
        facts.textContent = JSON.stringify({
            id: record.id,
            type: record.type,
            status: record.status,
            revision: record.revision,
            sourceIds: record.sourceIds,
            supersedes: record.supersedes,
            supersededBy: record.supersededBy,
            metadata: record.metadata,
        }, null, 2);

        const actions = document.createElement('div');
        actions.className = 'flex-container nemolore-memory-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'menu_button';
        save.textContent = 'Save changes';
        save.addEventListener('click', () => {
            management.edit(record.id, {
                title: title.value,
                content: content.value,
                tags: tags.value,
                entityIds: entities.value,
                importance: Number(importance.value),
                confidence: Number(confidence.value),
            });
        });
        const invalidate = document.createElement('button');
        invalidate.type = 'button';
        invalidate.className = 'menu_button';
        invalidate.textContent = record.status === 'invalidated' ? 'Restore' : 'Invalidate';
        invalidate.addEventListener('click', () => record.status === 'invalidated'
            ? management.restore(record.id)
            : management.invalidate(record.id));
        const promote = document.createElement('button');
        promote.type = 'button';
        promote.className = 'menu_button';
        promote.textContent = record.type === 'core' ? 'Core memory' : 'Promote to core';
        promote.disabled = record.type === 'core';
        promote.addEventListener('click', () => management.promoteToCore(record.id));
        const reviewed = document.createElement('button');
        reviewed.type = 'button';
        reviewed.className = 'menu_button';
        reviewed.textContent = 'Mark reviewed';
        reviewed.addEventListener('click', () => management.markReviewed(record.id));
        actions.append(save, invalidate, promote, reviewed);

        shell.detail.append(
            heading,
            field('Title', title),
            field('Content', content),
            field('Tags', tags),
            field('Entities', entities),
            field('Importance', importance),
            field('Confidence', confidence),
            actions,
            facts,
        );
    }

    function open() {
        if (shell?.overlay.isConnected) return shell.overlay;
        shell = createManagementPanelShell({
            id: 'nemolore-memory-manager',
            title: 'NemoLore Memory Manager',
            onClose: close,
        });

        const search = textInput();
        search.placeholder = 'Search memories';
        search.addEventListener('input', () => { filters.search = search.value; renderList(); });
        const type = document.createElement('select');
        type.className = 'text_pole';
        type.append(new Option('All types', ''));
        for (const value of management.facets().types) type.append(new Option(value, value));
        type.addEventListener('change', () => { filters.type = type.value; renderList(); });
        const status = document.createElement('select');
        status.className = 'text_pole';
        status.append(new Option('All statuses', ''));
        for (const value of management.facets().statuses) status.append(new Option(value, value));
        status.addEventListener('change', () => { filters.status = status.value; renderList(); });
        const review = document.createElement('label');
        review.className = 'checkbox_label';
        const reviewInput = document.createElement('input');
        reviewInput.type = 'checkbox';
        reviewInput.addEventListener('change', () => { filters.reviewOnly = reviewInput.checked; renderList(); });
        review.append(reviewInput, ' Needs review only');
        const list = document.createElement('div');
        list.className = 'nemolore-memory-list';
        shell.sidebar.append(search, type, status, review, list);

        document.body.append(shell.overlay);
        unsubscribe = management.subscribe(() => {
            renderList();
            renderDetail();
        });
        renderList();
        renderDetail();
        logger?.debug('Opened memory management panel.');
        return shell.overlay;
    }

    return Object.freeze({ open, close, get element() { return shell?.overlay ?? null; } });
}
