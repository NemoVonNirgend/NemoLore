import { createContextContribution } from './context-contribution.js';
import { createContextPackage } from './context-package.js';

function normalizeOutput(value) {
    if (!value) return [];
    return (Array.isArray(value) ? value : [value]).map(createContextContribution);
}

export function createContextInjector({ registry, logger } = {}) {
    if (!registry) throw new TypeError('Context injector requires a contributor registry.');

    async function build(request = {}, options = {}) {
        const maxTokens = Math.max(0, Number(options.maxTokens ?? request.maxTokens ?? 2000));
        const requested = options.contributors ?? registry.list();
        const produced = [];
        const errors = [];

        for (const name of requested) {
            const contributor = registry.get(name);
            if (!contributor) {
                errors.push({ contributor: name, error: 'unknown-contributor' });
                continue;
            }

            try {
                const output = await contributor.contribute(request, options);
                produced.push(...normalizeOutput(output));
            } catch (error) {
                errors.push({ contributor: name, error });
                logger?.error('Context contributor failed.', { contributor: name, error });
                if (options.failFast) throw error;
            }
        }

        produced.sort((a, b) => {
            if (a.required !== b.required) return a.required ? -1 : 1;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.id.localeCompare(b.id);
        });

        const selected = [];
        const omitted = [];
        let usedTokens = 0;

        for (const contribution of produced) {
            const fits = usedTokens + contribution.estimatedTokens <= maxTokens;
            if (fits || contribution.required) {
                selected.push(contribution);
                usedTokens += contribution.estimatedTokens;
            } else {
                omitted.push({ ...contribution, omissionReason: 'token-budget' });
            }
        }

        const grouped = Object.groupBy
            ? Object.groupBy(selected, item => item.position)
            : selected.reduce((groups, item) => {
                (groups[item.position] ??= []).push(item);
                return groups;
            }, {});

        return Object.freeze({
            selected,
            omitted,
            errors,
            grouped,
            usedTokens,
            maxTokens,
        });
    }

    function render(result, { separator = '\n\n' } = {}) {
        return result.selected.map(item => item.content).filter(Boolean).join(separator);
    }

    async function inject(request = {}, options = {}) {
        return createContextPackage(await build(request, options));
    }

    return Object.freeze({ build, render, inject });
}
