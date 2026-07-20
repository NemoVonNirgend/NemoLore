import { CONTEXT_POSITIONS, CONTEXT_ROLES, createContextContribution } from '../context/context-contribution.js';
import { PREFERENCE_STATUS } from './preference-record.js';

export function createPreferenceContextContributor({ store, settings, getPersonaId, logger } = {}) {
    if (!store?.list) throw new TypeError('Preference contributor requires a preference store.');
    return Object.freeze({
        name: 'preferences',
        async contribute(request = {}, options = {}) {
            if (!settings?.enablePreferenceMemory) return [];
            const requestedPersonaId = request.personaId ?? getPersonaId?.() ?? null;
            const personaId = String(requestedPersonaId ?? '').trim() || null;
            const limit = Math.max(1, Number(settings.preferenceContextLimit ?? 12));
            const budget = Math.max(40, Number(options.maxTokens ?? settings.preferenceContextBudget ?? 400));
            const accepted = store.list()
                .filter(item => item.status === PREFERENCE_STATUS.ACCEPTED)
                .filter(item => item.scope === 'global' || (personaId && item.personaId === String(personaId)))
                .sort((a, b) => b.priority - a.priority || String(b.updatedAt).localeCompare(String(a.updatedAt)))
                .slice(0, limit);
            const selected = [];
            let used = 8;
            for (const item of accepted) {
                const cost = Math.max(1, Math.ceil(item.content.length / 4));
                if (used + cost > budget) continue;
                selected.push(item);
                used += cost;
            }
            if (!selected.length) return [];
            logger?.debug('Prepared accepted preference context.', { selected: selected.length, personaId });
            return createContextContribution({
                id: 'preferences:accepted',
                source: 'preferences',
                title: 'Accepted User Preferences',
                content: `## Accepted User Preferences\n\n${selected.map(item => `- ${item.content}`).join('\n')}`,
                role: CONTEXT_ROLES.SYSTEM,
                position: CONTEXT_POSITIONS.AFTER_SYSTEM,
                priority: settings.preferenceContextPriority ?? 90,
                estimatedTokens: used,
                metadata: { preferenceIds: selected.map(item => item.id), acceptedOnly: true, personaId },
            });
        },
    });
}
