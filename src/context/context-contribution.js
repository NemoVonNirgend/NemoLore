export const CONTEXT_ROLES = Object.freeze({
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant',
});

export const CONTEXT_POSITIONS = Object.freeze({
    BEFORE_SYSTEM: 'before-system',
    AFTER_SYSTEM: 'after-system',
    BEFORE_CHAT: 'before-chat',
    AFTER_CHAT: 'after-chat',
});

const VALID_ROLES = new Set(Object.values(CONTEXT_ROLES));
const VALID_POSITIONS = new Set(Object.values(CONTEXT_POSITIONS));

export function createContextContribution(input = {}) {
    if (!input.id) throw new TypeError('Context contribution requires an id.');
    const content = String(input.content ?? '').trim();
    if (!content) throw new TypeError(`Context contribution ${input.id} requires content.`);

    const role = input.role ?? CONTEXT_ROLES.SYSTEM;
    const position = input.position ?? CONTEXT_POSITIONS.AFTER_SYSTEM;
    if (!VALID_ROLES.has(role)) throw new TypeError(`Invalid context role: ${role}`);
    if (!VALID_POSITIONS.has(position)) throw new TypeError(`Invalid context position: ${position}`);

    return Object.freeze({
        id: String(input.id),
        source: String(input.source ?? input.id),
        title: String(input.title ?? '').trim(),
        content,
        role,
        position,
        priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
        estimatedTokens: Math.max(1, Number(input.estimatedTokens ?? Math.ceil(content.length / 4))),
        required: Boolean(input.required),
        metadata: structuredClone(input.metadata ?? {}),
    });
}
