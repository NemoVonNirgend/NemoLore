import { createManagementPanelShell } from './management-panel-shell.js';

function element(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text != null) value.textContent = String(text);
    return value;
}

function button(label, action) {
    const value = element('button', 'menu_button', label);
    value.type = 'button';
    value.addEventListener('click', action);
    return value;
}

function downloadJson(filename, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

export function createPreferenceManagementPanel({ store, management, inference, logger } = {}) {
    if (!store?.list || !management?.accept) throw new TypeError('Preference panel requires preference store and management services.');
    let shell = null;
    let unsubscribe = null;
    let selectedId = null;

    function renderList() {
        if (!shell) return;
        shell.sidebar.replaceChildren();
        const introduction = element('p', '', 'Only accepted preferences are injected. Candidates and evidence remain inactive until you review them.');
        const add = button('Add explicit preference', () => {
            const content = globalThis.prompt?.('Preference instruction:')?.trim();
            if (!content) return;
            const record = store.save({ content, status: 'candidate', metadata: { origin: 'explicit-ui' } });
            selectedId = record.id;
            render();
        });
        const infer = button('Find repeated candidates', () => {
            inference?.generate?.();
            render();
        });
        const exportButton = button('Export JSON', () => {
            downloadJson(`nemolore-preferences-${new Date().toISOString().slice(0, 10)}.json`, management.exportData());
        });
        const list = element('div', 'nemolore-memory-list');
        const records = store.list().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        for (const record of records) {
            const row = button(`${record.status}: ${record.content}`, () => { selectedId = record.id; renderDetails(); });
            row.classList.add('nemolore-memory-item');
            if (record.id === selectedId) row.dataset.selected = 'true';
            list.append(row);
        }
        if (!records.length) list.append(element('p', '', 'No preference candidates yet.'));
        shell.sidebar.append(introduction, add, infer, exportButton, list);
    }

    function renderDetails() {
        if (!shell) return;
        shell.detail.replaceChildren();
        const record = selectedId ? store.get(selectedId) : null;
        if (!record) {
            shell.detail.append(element('p', '', 'Select a preference to review its evidence and status.'));
            return;
        }
        const editor = document.createElement('textarea');
        editor.className = 'text_pole textarea_compact';
        editor.value = record.content;
        editor.rows = 5;
        const metadata = element('p', 'nemolore-memory-meta', `${record.scope} · confidence ${record.confidence.toFixed(2)} · ${record.evidenceIds.length} evidence item(s)`);
        const actions = element('div', 'flex-container');
        actions.append(
            button('Save', () => { management.edit(record.id, { content: editor.value }); render(); }),
            button('Accept', () => { management.accept(record.id); render(); }),
            button('Reject', () => { management.reject(record.id); render(); }),
            button(record.status === 'disabled' ? 'Restore' : 'Disable', () => {
                record.status === 'disabled' ? management.restore(record.id) : management.disable(record.id);
                render();
            }),
            button('Delete', () => {
                if (globalThis.confirm?.('Permanently delete this preference?') === false) return;
                management.remove(record.id);
                selectedId = null;
                render();
            }),
        );
        const evidence = element('section', 'nemolore-inspector-section');
        evidence.append(element('h3', '', 'Evidence'));
        for (const id of record.evidenceIds) {
            const item = store.getEvidence(id);
            if (!item) continue;
            const card = element('article', 'nemolore-inspector-item');
            card.append(element('strong', '', `${item.source}: ${item.summary}`));
            if (item.acceptedText) card.append(element('p', '', `Accepted: ${item.acceptedText}`));
            if (item.rejectedText) card.append(element('p', '', `Rejected/removed: ${item.rejectedText}`));
            card.append(button('Remove evidence', () => {
                if (globalThis.confirm?.('Remove this evidence item?') === false) return;
                management.removeEvidence(item.id);
                render();
            }));
            evidence.append(card);
        }
        if (!record.evidenceIds.length) evidence.append(element('p', '', 'This candidate has no inferred evidence.'));
        shell.detail.append(element('h2', '', 'Preference Review'), editor, metadata, actions, evidence);
    }

    function render() { renderList(); renderDetails(); }
    function close() {
        unsubscribe?.();
        unsubscribe = null;
        shell?.overlay.remove();
        shell = null;
        selectedId = null;
    }
    function open() {
        if (shell?.overlay.isConnected) return shell.overlay;
        shell = createManagementPanelShell({ id: 'nemolore-preference-manager', title: 'Reviewed Preferences', onClose: close });
        document.body.append(shell.overlay);
        unsubscribe = store.subscribe(() => render());
        render();
        logger?.debug('Opened preference manager.');
        return shell.overlay;
    }
    return Object.freeze({
        open,
        close,
        render,
        get isOpen() { return Boolean(shell?.overlay.isConnected); },
    });
}
