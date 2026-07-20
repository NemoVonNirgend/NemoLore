export const PREFERENCE_STATUS = Object.freeze({
    CANDIDATE: 'candidate',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    DISABLED: 'disabled',
});

const VALID_STATUS = new Set(Object.values(PREFERENCE_STATUS));
const VALID_SCOPE = new Set(['global', 'persona']);

function idFactory() {
    return globalThis.crypto?.randomUUID?.() ?? `preference-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPreferenceRecord(input, { now = () => new Date().toISOString(), createId = idFactory } = {}) {
    const content = String(input?.content ?? '').trim();
    if (!content) throw new TypeError('Preference content is required.');
    const status = input.status ?? PREFERENCE_STATUS.CANDIDATE;
    if (!VALID_STATUS.has(status)) throw new TypeError(`Unknown preference status: ${status}`);
    const scope = input.scope ?? 'global';
    if (!VALID_SCOPE.has(scope)) throw new TypeError(`Unknown preference scope: ${scope}`);
    const personaId = String(input.personaId ?? '').trim();
    if (scope === 'persona' && !personaId) throw new TypeError('Persona preferences require personaId.');
    const timestamp = input.createdAt ?? now();
    return Object.freeze({
        id: input.id ?? createId(),
        content,
        status,
        scope,
        personaId: scope === 'persona' ? personaId : null,
        confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 0.5))),
        priority: Math.min(1, Math.max(0, Number(input.priority ?? 0.5))),
        tags: [...new Set((input.tags ?? []).map(String).map(value => value.trim()).filter(Boolean))],
        evidenceIds: [...new Set((input.evidenceIds ?? []).map(String).filter(Boolean))],
        createdAt: timestamp,
        updatedAt: input.updatedAt ?? timestamp,
        reviewedAt: input.reviewedAt ?? null,
        metadata: structuredClone(input.metadata ?? {}),
    });
}

export function revisePreferenceRecord(record, patch, options = {}) {
    return createPreferenceRecord({
        ...record,
        ...patch,
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: options.now?.() ?? new Date().toISOString(),
        metadata: { ...record.metadata, ...(patch.metadata ?? {}) },
    }, options);
}
