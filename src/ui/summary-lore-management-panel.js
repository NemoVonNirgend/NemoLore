import { createManagementPanelShell } from './management-panel-shell.js';
import { isActiveChatChangedError } from '../core/active-chat-guard.js';
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
    let panelChatId = null;

    const summary = createSummaryManagementService({
        store: nemo.summary.store,
        summary: nemo.summary.service,
        settings: nemo.settings,
        getChatId: () => nemo.memory.persistence.activeChatId,
        getContext: () => ({ chat: currentChatMessages() }),
        logger,
    });
    const lore = createLoreManagementService({
        lorebooks: nemo.lore.repository,
        generation: nemo.lore.generation,
        entityIndex: nemo.lore.generation.entityIndex,
        getChatId: () => nemo.memory.persistence.activeChatId,
        logger,
    });

    function handleActionError(label, error) {
        if (isActiveChatChangedError(error)) {
            logger?.warn('Closed stale summary/lore manager after the active chat changed.', {
                expectedChatId: error.expectedChatId,
                activeChatId: error.activeChatId,
            });
            close();
            return;
        }
        logger?.error('Summary/lore manager action failed.', { label, error });
    }

    function actionButton(label, handler) {
        return button(label, event => Promise.resolve()
            .then(() => handler(event))
            .catch(error => handleActionError(label, error)));
    }

    function close() {
        shell?.overlay.remove();
        shell = null;
        pendingPreview = null;
        panelChatId = null;
    }

    async function renderSummary() {
        shell.sidebar.replaceChildren();
        shell.detail.replaceChildren();
        const record = summary.current(panelChatId);
        const editor = textarea(record?.text ?? '', 14);
        const lineage = document.createElement('pre');
<<<<<<< HEAD
        lineage.textContent = JSON.stringify(summary.lineage(panelChatId), null, 2);
        shell.sidebar.append(precedence, actionButton('Apply precedence', () => summary.setPrecedence(precedence.value)));
=======
        lineage.textContent = JSON.stringify(summary.lineage(), null, 2);
        shell.sidebar.append('Modular summary context');
>>>>>>> dev/preset-architecture
        shell.detail.append(
            editor,
            actionButton('Save summary', async () => { await summary.edit(editor.value, { chatId: panelChatId }); await renderSummary(); }),
            actionButton('Regenerate from current chat', async () => { await summary.regenerate({ chatId: panelChatId, messages: currentChatMessages() }); await renderSummary(); }),
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
            for (const entry of await lore.list({ search: search.value, chatId: panelChatId })) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'menu_button nemolore-memory-item';
                row.textContent = `${entry.comment || entry.key?.[0] || entry.uid}${entry.protected ? ' 🔒' : ''}`;
                row.addEventListener('click', () => renderLoreDetail(entry));
                list.append(row);
            }
        };
        search.addEventListener('input', () => {
            void renderEntries().catch(error => handleActionError('Refresh lore entries', error));
        });
        const previewInput = textarea('', 6);
        previewInput.placeholder = 'Paste recent roleplay text to preview lore changes';
        shell.sidebar.append(search, list, previewInput, actionButton('Preview lore changes', async () => {
            pendingPreview = await lore.preview({ chatId: panelChatId, input: previewInput.value });
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
            actionButton(entry.protected ? 'Remove protection' : 'Protect manual entry', async () => { await lore.protect(entry.uid, !entry.protected, { chatId: panelChatId }); await renderLore(); }),
            duplicateIds,
            actionButton('Merge duplicates into this entry', async () => {
                const ids = duplicateIds.value.split(',').map(value => value.trim()).filter(Boolean);
                await lore.merge(entry.uid, ids, { chatId: panelChatId });
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
            actionButton('Apply approved changes', async () => { await lore.apply(pendingPreview, approved); pendingPreview = null; await renderLore(); }),
            actionButton('Reject preview', async () => { pendingPreview = null; await renderLore(); }),
        );
    }

    async function switchTab(tab) {
        activeTab = tab;
        if (tab === 'summary') await renderSummary();
        else await renderLore();
    }

    async function open() {
        if (shell?.overlay.isConnected) return shell.overlay;
        panelChatId = nemo.memory.persistence.activeChatId;
        shell = createManagementPanelShell({ id: 'nemolore-summary-lore-manager', title: 'NemoLore Summary & Lore Manager', onClose: close });
        const tabs = document.createElement('div');
        tabs.className = 'flex-container';
        tabs.append(actionButton('Summary', () => switchTab('summary')), actionButton('Lore', () => switchTab('lore')));
        shell.header.insertBefore(tabs, shell.close);
        document.body.append(shell.overlay);
        await switchTab(activeTab);
        return shell.overlay;
    }

    return Object.freeze({ open, close, get element() { return shell?.overlay ?? null; } });
}
