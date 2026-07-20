function ensureStyles() {
    if (document.getElementById('nemolore-management-styles')) return;
    const style = document.createElement('style');
    style.id = 'nemolore-management-styles';
    style.textContent = `
        .nemolore-management-panel {
            position: fixed;
            inset: 5vh 5vw;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            max-width: none;
            max-height: none;
            overflow: hidden;
        }
        .nemolore-management-header {
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid var(--SmartThemeBorderColor, #666);
        }
        .nemolore-management-body {
            display: grid;
            grid-template-columns: minmax(240px, 34%) minmax(0, 1fr);
            gap: 12px;
            min-height: 0;
            flex: 1;
            padding: 12px;
        }
        .nemolore-management-sidebar,
        .nemolore-management-detail {
            min-height: 0;
            overflow: auto;
        }
        .nemolore-management-sidebar {
            display: flex;
            flex-direction: column;
            gap: 8px;
            border-right: 1px solid var(--SmartThemeBorderColor, #666);
            padding-right: 12px;
        }
        .nemolore-memory-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .nemolore-memory-item {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
            gap: 3px;
        }
        .nemolore-memory-item[data-selected='true'] {
            outline: 2px solid var(--SmartThemeQuoteColor, currentColor);
        }
        .nemolore-management-detail {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .nemolore-management-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .nemolore-management-field textarea {
            width: 100%;
            resize: vertical;
        }
        .nemolore-memory-provenance {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            padding: 10px;
            border: 1px solid var(--SmartThemeBorderColor, #666);
            border-radius: 6px;
        }
        @media (max-width: 760px) {
            .nemolore-management-panel { inset: 2vh 2vw; }
            .nemolore-management-body { grid-template-columns: 1fr; }
            .nemolore-management-sidebar {
                border-right: 0;
                border-bottom: 1px solid var(--SmartThemeBorderColor, #666);
                padding-right: 0;
                padding-bottom: 12px;
                max-height: 42vh;
            }
        }
    `;
    document.head.append(style);
}

export function createManagementPanelShell({ id, title, onClose } = {}) {
    ensureStyles();
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'popup nemolore-management-panel';

    const header = document.createElement('div');
    header.className = 'nemolore-management-header flex-container';
    const heading = document.createElement('h3');
    heading.textContent = title ?? 'NemoLore Manager';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'menu_button';
    close.textContent = 'Close';
    close.addEventListener('click', () => onClose?.());
    header.append(heading, close);

    const body = document.createElement('div');
    body.className = 'nemolore-management-body';
    const sidebar = document.createElement('section');
    sidebar.className = 'nemolore-management-sidebar';
    const detail = document.createElement('section');
    detail.className = 'nemolore-management-detail';
    body.append(sidebar, detail);
    overlay.append(header, body);

    return Object.freeze({ overlay, header, body, sidebar, detail, close });
}
