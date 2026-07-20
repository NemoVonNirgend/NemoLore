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

function patchFor(entry, existing = null) {
    return {
        content: entry.content,
        key: mergeKeywords(entry, existing),
        comment: entry.title || existing?.comment || entry.key,
    };
}

function isProtected(entry) {
    return Boolean(entry?.extensions?.nemolore?.protected);
}

export function createLoreGenerationService({ generation, lorebooks, lock, entityIndex = createLoreEntityIndex(), logger } = {}) {
    if (!generation?.generate) throw new TypeError('Lore generation service requires generation.');
    if (!lorebooks?.ensureForChat) throw new TypeError('Lore generation service requires lorebooks.');

    async function preview(payload = {}) {
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

        const operations = normalizeEntries(result.text ?? result).map(entry => {
            const match = entityIndex.resolve(current, entry);
            const resolvedUid = entry.uid ?? match?.uid ?? null;
            return Object.freeze({
                ...entry,
                action: entry.action === 'noop' ? 'noop' : resolvedUid != null ? 'update' : 'create',
                identity: entityIndex.normalizeIdentity(entry.key),
                resolvedUid,
                matchedIdentity: match?.identity ?? null,
                protected: isProtected(match?.entry),
                existing: match?.entry ? structuredClone(match.entry) : null,
            });
        });

        return Object.freeze({
            chatId: String(payload.chatId),
            provider: result.provider ?? payload.provider ?? null,
            generatedAt: new Date().toISOString(),
            operations,
            generation: result,
        });
    }

    async function apply(previewResult, { approvedIndexes = null } = {}) {
        if (!previewResult?.chatId || !Array.isArray(previewResult.operations)) {
            throw new TypeError('Lore apply requires a preview result.');
        }
        const approved = approvedIndexes == null ? null : new Set(approvedIndexes.map(Number));
        const applied = [];

        await Promise.all(previewResult.operations.map((operation, index) => {
            if (approved && !approved.has(index)) {
                applied.push({ ...operation, skipped: true, reason: 'not-approved' });
                return Promise.resolve();
            }
            return lock.run(`lore:${previewResult.chatId}:${operation.identity}`, async () => {
                if (operation.action === 'noop') {
                    applied.push({ ...operation, skipped: true, reason: 'model-noop' });
                    return;
                }
                const latest = await lorebooks.load();
                const match = entityIndex.resolve(latest, operation);
                const existing = match?.entry ?? operation.existing ?? null;
                if (isProtected(existing)) {
                    applied.push({ ...operation, skipped: true, reason: 'protected-entry', resolvedUid: existing.uid });
                    return;
                }
                const resolvedUid = operation.resolvedUid ?? match?.uid ?? null;
                if (resolvedUid != null) {
                    const value = await lorebooks.updateEntry(resolvedUid, patchFor(operation, existing));
                    applied.push({ ...operation, action: 'update', resolvedUid, matchedIdentity: match?.identity ?? operation.matchedIdentity, value });
                    return;
                }
                const value = await lorebooks.createEntry(patchFor(operation));
                applied.push({ ...operation, action: 'create', value });
            });
        }));

        logger?.debug('Applied generated lore changes.', { chatId: previewResult.chatId, count: applied.length });
        return { ...previewResult, applied };
    }

    async function generate(payload = {}) {
        return apply(await preview(payload));
    }

    return Object.freeze({ preview, apply, generate, entityIndex });
}
