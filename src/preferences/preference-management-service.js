import { PREFERENCE_STATUS } from './preference-record.js';

export function createPreferenceManagementService({ store, now = () => new Date().toISOString() } = {}) {
    if (!store?.list || !store?.update) throw new TypeError('Preference management requires a preference store.');
    const review = (id, status) => store.update(id, { status, reviewedAt: now() });
    return Object.freeze({
        list: filters => store.list().filter(item => (!filters?.status || item.status === filters.status)
            && (!filters?.scope || item.scope === filters.scope)
            && (!filters?.personaId || item.personaId === filters.personaId)),
        accept: id => review(id, PREFERENCE_STATUS.ACCEPTED),
        reject: id => review(id, PREFERENCE_STATUS.REJECTED),
        disable: id => review(id, PREFERENCE_STATUS.DISABLED),
        restore: id => review(id, PREFERENCE_STATUS.ACCEPTED),
        edit: (id, patch) => store.update(id, patch),
    });
}
