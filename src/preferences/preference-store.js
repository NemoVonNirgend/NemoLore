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
        prune();
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
        prune();
        return commit('evidence-saved', item);
    }

    function remove(id) {
        const record = records.get(id);
        if (!record) return false;
        records.delete(id);
        commit('removed', record);
        return true;
    }

    function removeEvidence(id) {
        const item = evidence.get(id);
        if (!item) return false;
        evidence.delete(id);
        for (const [recordId, record] of records) {
            if (!record.evidenceIds.includes(id)) continue;
            records.set(recordId, revisePreferenceRecord(record, { evidenceIds: record.evidenceIds.filter(value => value !== id) }));
        }
        commit('evidence-removed', item);
        return true;
    }

    function prune() {
        const recordLimit = Math.max(20, Number(settings.preferenceRecordLimit ?? 200));
        if (records.size > recordLimit) {
            const removable = [...records.values()]
                .filter(record => record.status !== 'accepted')
                .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
            while (records.size > recordLimit && removable.length) records.delete(removable.shift().id);
        }
        const evidenceLimit = Math.max(50, Number(settings.preferenceEvidenceLimit ?? 500));
        if (evidence.size > evidenceLimit) {
            const linked = new Set([...records.values()].flatMap(record => record.evidenceIds));
            const removable = [...evidence.values()]
                .filter(item => !linked.has(item.id))
                .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
            while (evidence.size > evidenceLimit && removable.length) evidence.delete(removable.shift().id);
        }
        return { records: records.size, evidence: evidence.size };
    }

    return Object.freeze({
        save,
        update,
        addEvidence,
        remove,
        removeEvidence,
        prune,
        get: id => records.get(id) ?? null,
        getEvidence: id => evidence.get(id) ?? null,
        list: () => [...records.values()],
        listEvidence: () => [...evidence.values()],
        exportData: () => structuredClone({ version: 1, records: [...records.values()], evidence: [...evidence.values()] }),
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    });
}
