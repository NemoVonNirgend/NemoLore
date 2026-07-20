import { parseJsonResponse } from '../memory/extractors/json-response.js';
import { createLoreEntityIndex } from './lore-entity-index.js';

const SYSTEM_PROMPT = `Extract durable lore changes from roleplay text. Return JSON only as {"entries":[...]}. Each entry must include action (create|update|noop), key, title, content, keywords, and optional uid. Preserve manual prose where possible. Do not create entries for transient scene details.`;

function normalizeEntries(value) {
    const parsed = parseJsonResponse(value);
    const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? parsed.items ?? [parsed];
    return entries.filter(Boolean).map(entry => ({
        action: String(entry.action ?? 'create').toLowerCase(),
        key: String(entry.key ?? entry.title ?? entry.uid ?? '').trim(),
        uid: entry.uid ?? null,
        title: String(entry.title ?? entry.key ?? '').trim(),
        content: String(entry.content ?? '').trim(),
        keywords: [...new Set((entry.keywords ?? []).map(String).map(value => value.trim()).filter(Boolean))],
    })).filter(entry => entry.key && (entry.action === 'noop' || entry.content));
}

function mergeKeywords(entry, existing) {
    const current = Array.isArray(existing?.key) ? existing.key : [existing?.key].filter(Boolean);
    return [...new Set([...current, entry.key, entry.title, ...entry.keywords].map(String).map(value => value.trim()).filter(Boolean))];
}

export function createLoreGenerationService({ generation, lorebooks, lock, entityIndex = createLoreEntityIndex(), logger } = {}) {
    if (!generation?.generate) throw new TypeError('Lore generation service requires generation.');
    if (!lorebooks?.ensureForChat) throw new TypeError('Lore generation service requires lorebooks.');

    async function generate(payload = {}) {
        if (!payload.chatId) throw new TypeError('Lore generation requires chatId.');
        await lorebooks.ensureForChat(payload.chatId);
        const current = await lorebooks.load();
        const result = await generation.generate({
            systemPrompt: payload.systemPrompt ?? SYSTEM_PROMPT,
            prompt: `Current lorebook:\n${JSON.stringify(current)}\n\nRecent roleplay:\n${payload.input ?? ''}`,
            maxTokens: payload.maxTokens ?? 1000,
            temperature: payload.temperature ?? 0.2,
            metadata: { task: 'lore-generation', chatId: payload.chatId },
        }, { provider: payload.provider, workflow: 'lore' });

        const entries = normalizeEntries(result.text ?? result);
        const applied = [];
        await Promise.all(entries.map(entry => lock.run(`lore:${payload.chatId}:${entityIndex.normalizeIdentity(entry.key)}`, async () => {
            const latest = await lorebooks.load();
            const match = entityIndex.resolve(latest, entry);
            const resolvedUid = entry.uid ?? match?.uid ?? null;
            if (entry.action === 'noop') return applied.push({ ...entry, resolvedUid, skipped: true, reason: 'model-noop' });
            if (resolvedUid != null) {
                const existing = match?.entry ?? null;
                const value = await lorebooks.updateEntry(resolvedUid, {
                    content: entry.content,
                    key: mergeKeywords(entry, existing),
                    comment: entry.title || existing?.comment || entry.key,
                });
                return applied.push({ ...entry, action: 'update', resolvedUid, matchedIdentity: match?.identity ?? null, value });
            }
            const value = await lorebooks.createEntry({ content: entry.content, key: mergeKeywords(entry), comment: entry.title || entry.key });
            applied.push({ ...entry, action: 'create', value });
        })));
        logger?.debug('Applied generated lore changes.', { chatId: payload.chatId, count: applied.length });
        return { entries, applied, generation: result };
    }

    return Object.freeze({ generate, entityIndex });
}
