import { MEMORY_STATUS, MEMORY_TYPES } from '../memory-types.js';

function groupKey(record) {
    return record.entityIds[0] ? `entity:${record.entityIds[0].toLowerCase()}`
        : record.tags[0] ? `tag:${record.tags[0].toLowerCase()}`
            : 'ungrouped';
}

function compare(left, right) {
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEpisodePromotionService({ store, settings, logger } = {}) {
    if (!store?.query || !store?.save || !store?.update) throw new TypeError('Episode promotion requires a mutable memory store.');

    function run() {
        const threshold = Math.max(0, Number(settings?.episodePromotionThreshold ?? 0));
        if (!threshold) return { enabled: false, episodes: [], archived: [] };
        const sourceMode = settings?.episodePromotionSourceMode === 'retain' ? 'retain' : 'archive';
        const groups = new Map();
        for (const record of store.query({ type: MEMORY_TYPES.ATOMIC, status: MEMORY_STATUS.ACTIVE })) {
            if (record.metadata?.promotedToEpisode || record.metadata?.consolidatedInto) continue;
            const key = groupKey(record);
            if (key === 'ungrouped') continue;
            const group = groups.get(key) ?? [];
            group.push(record);
            groups.set(key, group);
        }

        const episodes = [];
        const archived = [];
        for (const [key, unsorted] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
            const members = unsorted.sort(compare).slice(0, threshold);
            if (members.length < threshold) continue;
            const episode = store.save({
                type: MEMORY_TYPES.EPISODE,
                title: `Developments: ${key.replace(/^[^:]+:/, '')}`,
                content: members.map(record => `- ${record.content}`).join('\n'),
                sourceIds: [...new Set(members.flatMap(record => record.sourceIds))],
                entityIds: [...new Set(members.flatMap(record => record.entityIds))],
                tags: [...new Set([...members.flatMap(record => record.tags), 'episode', 'promoted'])],
                importance: Math.max(...members.map(record => record.importance)),
                confidence: Math.min(...members.map(record => record.confidence)),
                metadata: {
                    episodePromotion: {
                        version: 1,
                        groupKey: key,
                        memberIds: members.map(record => record.id),
                        memberStatuses: Object.fromEntries(members.map(record => [record.id, record.status])),
                        sourceMode,
                    },
                },
            });
            episodes.push(episode.id);
            for (const member of members) {
                store.update(member.id, {
                    status: sourceMode === 'archive' ? MEMORY_STATUS.ARCHIVED : member.status,
                    metadata: { promotedToEpisode: episode.id },
                });
                if (sourceMode === 'archive') archived.push(member.id);
            }
        }
        logger?.debug('Promoted atomic memories into episodes.', { episodes: episodes.length, archived: archived.length, sourceMode });
        return { enabled: true, episodes, archived };
    }

    function restore(episodeId) {
        const episode = store.get(episodeId);
        const promotion = episode?.metadata?.episodePromotion;
        if (episode?.type !== MEMORY_TYPES.EPISODE || !Array.isArray(promotion?.memberIds)) return false;
        for (const id of promotion.memberIds) {
            const member = store.get(id);
            if (!member) continue;
            store.update(id, {
                status: promotion.memberStatuses?.[id] ?? MEMORY_STATUS.ACTIVE,
                metadata: { promotedToEpisode: null },
            });
        }
        store.update(episodeId, { status: MEMORY_STATUS.ARCHIVED, metadata: { episodePromotionRestored: true } });
        return true;
    }

    return Object.freeze({ run, restore });
}
