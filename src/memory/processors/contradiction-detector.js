import { MEMORY_STATUS, isLivingMemoryType } from '../memory-types.js';

function normalize(value) {
    return String(value ?? '').trim().toLowerCase();
}

function livingStateKey(memory) {
    const data = memory.data ?? {};
    const subject = normalize(data.subject ?? memory.entityIds?.[0] ?? memory.entities?.[0]);
    const field = normalize(data.field);
    if (!subject || !field) return null;
    return `${memory.type}:${subject}:${field}`;
}

function atomicKey(memory) {
    if (memory.type !== 'atomic') return null;
    const data = memory.data ?? {};
    const subject = normalize(data.subject);
    const predicate = normalize(data.predicate);
    if (!subject || !predicate) return null;
    return `${subject}:${predicate}`;
}

function valuesConflict(left, right) {
    const a = left?.data ?? {};
    const b = right?.data ?? {};

    if (isLivingMemoryType(left.type) && left.type === right.type) {
        return normalize(a.newValue) !== normalize(b.newValue);
    }

    if (left.type === 'atomic' && right.type === 'atomic') {
        return normalize(a.object) !== normalize(b.object);
    }

    return false;
}

export function createContradictionDetector({ logger } = {}) {
    return async function detectContradictions(candidate, { store, shouldCommit }) {
        const stateKey = livingStateKey(candidate);
        const factKey = atomicKey(candidate);
        if (!stateKey && !factKey) return candidate;

        const matches = store.query({
            type: candidate.type,
            predicate: record => {
                if (stateKey) return livingStateKey(record) === stateKey;
                return atomicKey(record) === factKey;
            },
        });

        const contradiction = matches.find(record => valuesConflict(candidate, record));
        if (!contradiction) return candidate;

        if (isLivingMemoryType(candidate.type)) {
            if (shouldCommit && !shouldCommit()) return candidate;
            const updated = store.update(contradiction.id, {
                status: MEMORY_STATUS.SUPERSEDED,
                metadata: {
                    contradictionReason: 'newer-state-observed',
                    supersededAt: new Date().toISOString(),
                },
            });

            logger?.debug('Superseded contradicted living memory.', {
                existingId: updated.id,
                type: candidate.type,
            });

            return {
                ...candidate,
                supersedes: contradiction.id,
                metadata: {
                    ...(candidate.metadata ?? {}),
                    contradictionWith: contradiction.id,
                    contradictionPolicy: 'supersede-existing',
                },
            };
        }

        logger?.warn('Flagged contradictory atomic memory.', {
            existingId: contradiction.id,
            subject: candidate.data?.subject,
            predicate: candidate.data?.predicate,
        });

        return {
            ...candidate,
            tags: [...new Set([...(candidate.tags ?? []), 'contradiction'])],
            metadata: {
                ...(candidate.metadata ?? {}),
                contradictionWith: contradiction.id,
                contradictionPolicy: 'preserve-both',
                requiresReview: true,
            },
        };
    };
}
