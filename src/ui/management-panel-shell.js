export function createManagementPanelShell({ id, title, onClose } = {}) {
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
