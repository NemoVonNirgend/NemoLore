import { createManagementPanelShell } from './management-panel-shell.js';
import { createSummaryManagementService } from '../summary/summary-management-service.js';
import { createLoreManagementService } from '../lore/lore-management-service.js';

function currentChatMessages() {
    return [...document.querySelectorAll('#chat .mes')].map((element, index) => ({
        id: element.getAttribute('mesid') ?? String(index),
        is_user: element.classList.contains('user_mes'),
        mes: element.querySelector('.mes_text')?.textContent ?? '',
    })).filter(message => message.mes.trim());
}

function button(label, handler) {
    const value = document.createElement('button');
    value.type = 'button';
    value.className = 'menu_button';
    value.textContent = label;
    value.addEventListener('click', handler);
    return value;
}

function textarea(value = '', rows = 10) {
    const input = document.createElement('textarea');
    input.className = 'text_pole';
    input.rows = rows;
    input.value = value;
    return input;
}

export function createSummaryLoreManagementPanel({ nemo = globalThis.NemoLore, logger } = {}) {
    let shell = null;
    let activeTab = 'summary';
    let pendingPreview = null;

    const summary = createSummaryManagementService({
        store: nemo.summary.store,
        summary: nemo.summary.service,
        settings: nemo.settings,
        saveSettings: updated => nemo.settingsController?.set?.('summaryContextPrecedence', updated.summaryContextPrecedence),
        getChatId: () => nemo.memory.persistence.activeChatId,
        getContext: () => ({ chat: currentChatMessages() }),
        logger,
    });
    const lore = createLoreManagementService({
        lorebooks: nemo.lore.repository,
        generation: nemo.lore.generation,
        entityIndex: nemo.lore.generation.entityIndex,
        logger,
    });

    function close() {
        shell?.overlay.remove();
        shell = null;
        pendingPreview = null;
    }

    async function renderSummary() {
        shell.sidebar.replaceChildren();
        shell.detail.replaceChildren();
        const record = summary.current();
        const editor = textarea(record?.text ?? '', 14);
        const precedence = document.createElement('select');
        precedence.className = 'text_pole';
        for (const value of ['new-first', 'legacy-first', 'new-only', 'legacy-only']) {
            precedence.append(new Option(value, value, false, nemo.settings.summaryContextPrecedence === value));
        }
        const lineage = document.createElement('pre');
        lineage.textContent = JSON.stringify(summary.lineage(), null, 2);
        shell.sidebar.append(precedence, button('Apply precedence', () => summary.setPrecedence(precedence.value)));
        shell.detail.append(
            editor,
            button('Save summary', async () => { await summary.edit(editor.value); await renderSummary(); }),
            button('Regenerate from current chat', async () => { await summary.regenerate({ messages: currentChatMessages() }); await renderSummary(); }),
            lineage,
        );
    }

    async function renderLore() {
        shell.sidebar.replaceChildren();
        shell.detail.replaceChildren();
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'text_pole';
        search.placeholder = 'Search lore entries';
        const list = document.createElement('div');
        const renderEntries = async () => {
            list.replaceChildren();
            for (const entry of await lore.list({ search: search.value })) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'menu_button nemolore-memory-item';
                row.textContent = `${entry.comment || entry.key?.[0] || entry.uid}${entry.protected ? ' 🔒' : ''}`;
                row.addEventListener('click', () => renderLoreDetail(entry));
                list.append(row);
            }
        };
        search.addEventListener('input', () => void renderEntries());
        const previewInput = textarea('', 6);
        previewInput.placeholder = 'Paste recent roleplay text to preview lore changes';
        shell.sidebar.append(search, list, previewInput, button('Preview lore changes', async () => {
            pendingPreview = await lore.preview({ chatId: nemo.memory.persistence.activeChatId, input: previewInput.value });
            renderPreview();
        }));
        await renderEntries();
    }

    function renderLoreDetail(entry) {
        shell.detail.replaceChildren();
        const title = document.createElement('h3');
        title.textContent = entry.comment || entry.key?.[0] || String(entry.uid);
        const content = document.createElement('pre');
        content.textContent = entry.content ?? '';
        const identities = document.createElement('pre');
        identities.textContent = JSON.stringify({ uid: entry.uid, keys: entry.key, normalizedIdentities: entry.normalizedIdentities, protected: entry.protected }, null, 2);
        const duplicateIds = document.createElement('input');
        duplicateIds.type = 'text';
        duplicateIds.className = 'text_pole';
        duplicateIds.placeholder = 'Duplicate UIDs, comma separated';
        shell.detail.append(
            title,
            content,
            identities,
            button(entry.protected ? 'Remove protection' : 'Protect manual entry', async () => { await lore.protect(entry.uid, !entry.protected); await renderLore(); }),
            duplicateIds,
            button('Merge duplicates into this entry', async () => {
                const ids = duplicateIds.value.split(',').map(value => value.trim()).filter(Boolean);
                await lore.merge(entry.uid, ids);
                await renderLore();
            }),
        );
    }

    function renderPreview() {
        shell.detail.replaceChildren();
        if (!pendingPreview) return;
        const approved = [];
        pendingPreview.operations.forEach((operation, index) => {
            const row = document.createElement('label');
            row.className = 'checkbox_label nemolore-lore-preview-operation';
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = operation.action !== 'noop' && !operation.protected;
            check.addEventListener('change', () => {
                if (check.checked && !approved.includes(index)) approved.push(index);
                else if (!check.checked) {
                    const position = approved.indexOf(index);
                    if (position >= 0) approved.splice(position, 1);
                }
            });
            if (check.checked) approved.push(index);
            const text = document.createElement('span');
            text.textContent = `${operation.action.toUpperCase()}: ${operation.title || operation.key}${operation.protected ? ' [PROTECTED]' : ''}\n${operation.content}`;
            row.append(check, text);
            shell.detail.append(row);
        });
        shell.detail.append(
            button('Apply approved changes', async () => { await lore.apply(pendingPreview, approved); pendingPreview = null; await renderLore(); }),
            button('Reject preview', () => { pendingPreview = null; void renderLore(); }),
        );
    }

    async function switchTab(tab) {
        activeTab = tab;
        if (tab === 'summary') await renderSummary();
        else await renderLore();
    }

    async function open() {
        if (shell?.overlay.isConnected) return shell.overlay;
        shell = createManagementPanelShell({ id: 'nemolore-summary-lore-manager', title: 'NemoLore Summary & Lore Manager', onClose: close });
        const tabs = document.createElement('div');
        tabs.className = 'flex-container';
        tabs.append(button('Summary', () => void switchTab('summary')), button('Lore', () => void switchTab('lore')));
        shell.header.insertBefore(tabs, shell.close);
        document.body.append(shell.overlay);
        await switchTab(activeTab);
        return shell.overlay;
    }

    return Object.freeze({ open, close, get element() { return shell?.overlay ?? null; } });
}
