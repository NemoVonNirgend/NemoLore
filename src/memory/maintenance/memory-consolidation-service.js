import { MEMORY_STATUS, MEMORY_TYPES } from '../memory-types.js';

const ELIGIBLE_TYPES = new Set([MEMORY_TYPES.ATOMIC, MEMORY_TYPES.EPISODE]);

function groupKey(record) {
    return record.entityIds[0] ? `entity:${record.entityIds[0].toLowerCase()}`
        : record.tags[0] ? `tag:${record.tags[0].toLowerCase()}`
            : `type:${record.type}`;
}

function compareRecords(left, right) {
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function consolidatedContent(records) {
    return records.map(record => `- ${record.title ? `${record.title}: ` : ''}${record.content}`).join('\n');
}

export function createMemoryConsolidationService({ store, settings, logger } = {}) {
    if (!store?.query || !store?.save || !store?.update) {
        throw new TypeError('Memory consolidation requires a mutable memory store.');
    }

    function run() {
        if (!settings?.memoryConsolidationEnabled) return { enabled: false, consolidated: [], archived: [] };
        const minimum = Math.max(2, Number(settings.memoryConsolidationMinRecords ?? 6));
        const batchSize = Math.max(minimum, Number(settings.memoryConsolidationBatchSize ?? 8));
        const sourceMode = settings.memoryConsolidationSourceMode === 'retain' ? 'retain' : 'archive';
        const groups = new Map();

        for (const record of store.query({ status: MEMORY_STATUS.ACTIVE })) {
            if (!ELIGIBLE_TYPES.has(record.type) || record.metadata?.consolidatedInto || record.metadata?.promotedToEpisode) continue;
            const key = groupKey(record);
            const group = groups.get(key) ?? [];
            group.push(record);
            groups.set(key, group);
        }

        const consolidated = [];
        const archived = [];
        for (const [key, unsorted] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
            const records = unsorted.sort(compareRecords).slice(0, batchSize);
            if (records.length < minimum) continue;
            const sourceIds = [...new Set(records.flatMap(record => record.sourceIds))];
            const entityIds = [...new Set(records.flatMap(record => record.entityIds))];
            const tags = [...new Set([...records.flatMap(record => record.tags), 'consolidated'])];
            const result = store.save({
                type: MEMORY_TYPES.CONSOLIDATED,
                title: `Consolidated memory: ${key.replace(/^[^:]+:/, '')}`,
                content: consolidatedContent(records),
                sourceIds,
                entityIds,
                tags,
                importance: Math.max(...records.map(record => record.importance)),
                confidence: Math.min(...records.map(record => record.confidence)),
                metadata: {
                    consolidation: {
                        version: 1,
                        groupKey: key,
                        memberIds: records.map(record => record.id),
                        memberStatuses: Object.fromEntries(records.map(record => [record.id, record.status])),
                        sourceMode,
                    },
                },
            });
            consolidated.push(result.id);

            for (const record of records) {
                store.update(record.id, {
                    status: sourceMode === 'archive' ? MEMORY_STATUS.ARCHIVED : record.status,
                    metadata: { consolidatedInto: result.id },
                });
                if (sourceMode === 'archive') archived.push(record.id);
            }
        }

        logger?.debug('Consolidated memory records.', { consolidated: consolidated.length, archived: archived.length, sourceMode });
        return { enabled: true, consolidated, archived };
    }

    function restore(consolidatedId) {
        const record = store.get(consolidatedId);
        const members = record?.metadata?.consolidation?.memberIds;
        if (record?.type !== MEMORY_TYPES.CONSOLIDATED || !Array.isArray(members)) return false;
        const statuses = record.metadata.consolidation.memberStatuses ?? {};
        for (const id of members) {
            const member = store.get(id);
            if (!member) continue;
            store.update(id, {
                status: statuses[id] ?? MEMORY_STATUS.ACTIVE,
                metadata: { consolidatedInto: null },
            });
        }
        store.update(consolidatedId, {
            status: MEMORY_STATUS.ARCHIVED,
            metadata: { consolidationRestored: true },
        });
        return true;
    }

    return Object.freeze({ run, restore });
}
