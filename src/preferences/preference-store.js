import { createPreferenceEvidence } from './preference-evidence.js';
import { createPreferenceRecord, revisePreferenceRecord } from './preference-record.js';

export function createPreferenceStore({ settings, persist, logger } = {}) {
    if (!settings) throw new TypeError('Preference store requires settings.');
    const records = new Map((settings.preferenceRecords ?? []).map(value => {
        const record = createPreferenceRecord(value);
        return [record.id, record];
    }));
    const evidence = new Map((settings.preferenceEvidence ?? []).map(value => {
        const item = createPreferenceEvidence(value);
        return [item.id, item];
    }));
    const listeners = new Set();

    function commit(event, value) {
        settings.preferenceRecords = [...records.values()];
        settings.preferenceEvidence = [...evidence.values()];
        persist?.(settings);
        for (const listener of listeners) {
            try { listener(event, structuredClone(value)); } catch (error) { logger?.warn('Preference listener failed.', { error }); }
        }
        return value;
    }

    function save(input, options) {
        const record = createPreferenceRecord(input, options);
        records.set(record.id, record);
        return commit('saved', record);
    }

    function update(id, patch, options) {
        const current = records.get(id);
        if (!current) throw new Error(`Unknown preference: ${id}`);
        const record = revisePreferenceRecord(current, patch, options);
        records.set(id, record);
        return commit('updated', record);
    }

    function addEvidence(input, options) {
        const item = createPreferenceEvidence(input, options);
        evidence.set(item.id, item);
        return commit('evidence-saved', item);
    }

    return Object.freeze({
        save,
        update,
        addEvidence,
        get: id => records.get(id) ?? null,
        getEvidence: id => evidence.get(id) ?? null,
        list: () => [...records.values()],
        listEvidence: () => [...evidence.values()],
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    });
}
