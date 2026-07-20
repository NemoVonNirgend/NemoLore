export const ENGINE_OWNERS = Object.freeze({
    MODULAR: 'nemolore-modular',
    LEGACY: 'nemolore-legacy',
    NEMOTAVERN: 'nemotavern',
    NONE: 'none',
});

function safeCall(value, receiver) {
    try {
        return typeof value === 'function' ? value.call(receiver) : value;
    } catch {
        return null;
    }
}

function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null) ?? null;
}

function capability(value) {
    if (typeof value === 'boolean') return value;
    return Boolean(value && typeof value === 'object' ? value.available ?? value.enabled ?? true : value);
}

function readCapabilities(scope) {
    const host = scope?.NemoTavern ?? null;
    const declared = safeCall(host?.capabilities?.snapshot, host?.capabilities)
        ?? safeCall(host?.capabilities, host)
        ?? safeCall(host?.snapshot, host)?.capabilities
        ?? {};
    const engines = declared?.engines ?? declared;
    const loreApi = firstValue(host?.lore, scope?.NemoTavernLore);
    const memoryApi = firstValue(host?.memory, scope?.NemoTavernMemory);
    const contextLedgerApi = firstValue(host?.contextLedger, scope?.NemoTavernContextLedger);
    const provenanceApi = firstValue(host?.provenance, scope?.NemoTavernProvenance);

    return Object.freeze({
        summary: capability(firstValue(engines?.summary, engines?.summaryEngine, memoryApi)),
        lore: capability(firstValue(engines?.lore, engines?.loreEngine, loreApi)),
        memory: capability(firstValue(engines?.memory, engines?.memoryEngine, memoryApi)),
        contextLedger: capability(firstValue(declared?.contextLedger, contextLedgerApi)),
        provenance: capability(firstValue(declared?.provenance, provenanceApi)),
    });
}

function readInspectorValue(api, names) {
    if (!api) return null;
    for (const name of names) {
        const value = safeCall(api[name], api);
        if (value != null) return value;
    }
    return null;
}

export function createNemoTavernHostInterop({ scope = globalThis } = {}) {
    function snapshot() {
        const host = scope?.NemoTavern ?? null;
        const capabilities = readCapabilities(scope);
        const memoryApi = firstValue(host?.memory, scope?.NemoTavernMemory);
        const loreApi = firstValue(host?.lore, scope?.NemoTavernLore);
        const declaredActive = safeCall(host?.capabilities?.active, host?.capabilities) ?? {};
        let memoryEnabled = firstValue(declaredActive?.memory, safeCall(memoryApi?.isEnabled, memoryApi), memoryApi?.enabled);
        let loreEnabled = firstValue(declaredActive?.lore, safeCall(loreApi?.isEnabled, loreApi), loreApi?.enabled);
        let memorySummaryEnabled = firstValue(declaredActive?.memorySummary, memoryEnabled);
        let loreSummaryEnabled = firstValue(declaredActive?.loreSummary, safeCall(loreApi?.isSummaryEnabled, loreApi));

        // Compatibility fallback for older forks. Current NemoTavern exposes
        // lightweight active-state methods, avoiding full chat/store clones on
        // every ownership check in generation hot paths.
        if (memoryEnabled == null) {
            const state = readInspectorValue(memoryApi, ['snapshot', 'getSnapshot']);
            memoryEnabled = state?.settings?.enabled;
        }
        if (loreEnabled == null || loreSummaryEnabled == null) {
            const state = readInspectorValue(loreApi, ['snapshot', 'getSnapshot']);
            loreEnabled = firstValue(loreEnabled, state?.settings?.enabled);
            loreSummaryEnabled = firstValue(loreSummaryEnabled,
                state?.settings?.enabled == null || state?.settings?.summaryTakeover == null
                    ? null
                    : Boolean(state.settings.enabled && state.settings.summaryTakeover));
        }
        const activeMemory = memoryEnabled == null ? capabilities.memory : Boolean(memoryEnabled);
        memorySummaryEnabled = firstValue(memorySummaryEnabled, activeMemory);
        const sourceSummaryKnown = memorySummaryEnabled != null || loreSummaryEnabled != null;
        const summaryEnabled = firstValue(declaredActive?.summary,
            sourceSummaryKnown ? Boolean(memorySummaryEnabled || loreSummaryEnabled) : null);
        return Object.freeze({
            available: Boolean(host || scope?.NemoTavernLore || scope?.NemoTavernMemory),
            version: host?.version ?? null,
            capabilities,
            active: Object.freeze({
                memory: activeMemory,
                lore: loreEnabled == null ? capabilities.lore : Boolean(loreEnabled),
                summary: summaryEnabled == null ? capabilities.summary : Boolean(summaryEnabled),
                memorySummary: Boolean(memorySummaryEnabled),
                loreSummary: Boolean(loreSummaryEnabled),
            }),
        });
    }

    function observabilitySnapshot() {
        const host = scope?.NemoTavern ?? null;
        const contextApi = firstValue(host?.contextLedger, scope?.NemoTavernContextLedger);
        const provenanceApi = firstValue(host?.provenance, scope?.NemoTavernProvenance);
        const memoryApi = firstValue(host?.memory, scope?.NemoTavernMemory);
        const memory = readInspectorValue(memoryApi, ['snapshot', 'getSnapshot']);
        return Object.freeze({
            contextLedger: readInspectorValue(contextApi, ['snapshot', 'getLast', 'getLastContextLedger']) ?? memory,
            memory,
            provenance: readInspectorValue(provenanceApi, ['summary', 'snapshot', 'getLast', 'getLastProvenance']),
        });
    }

    return Object.freeze({ snapshot, observabilitySnapshot });
}

export function createEngineOwnership({ settings = {}, hostInterop } = {}) {
    if (!hostInterop?.snapshot) throw new TypeError('Engine ownership requires a host interop adapter.');

    function ownerFor(engine) {
        const host = hostInterop.snapshot();
        if (engine === 'summary') {
            if (settings.summaryEngineMode === 'modular') return ENGINE_OWNERS.MODULAR;
            const nativeMemoryOwns = !(settings.enableHelperAgents && settings.helperMemoryAfterReply)
                && host.capabilities.memory && host.active.memory;
            const nativeLoreOwns = settings.loreEngineMode !== 'modular'
                && host.capabilities.lore && host.active.lore;
            const nativeSummaryRuns = (host.active.loreSummary && nativeLoreOwns)
                || (host.active.memorySummary && nativeMemoryOwns);
            return host.capabilities.summary && nativeSummaryRuns ? ENGINE_OWNERS.NEMOTAVERN : ENGINE_OWNERS.LEGACY;
        }
        if (engine === 'lore') {
            if (settings.loreEngineMode === 'modular') return ENGINE_OWNERS.MODULAR;
            return host.capabilities.lore && host.active.lore ? ENGINE_OWNERS.NEMOTAVERN : ENGINE_OWNERS.LEGACY;
        }
        if (engine === 'memory') {
            if (settings.enableHelperAgents && settings.helperMemoryAfterReply) return ENGINE_OWNERS.MODULAR;
            return host.capabilities.memory && host.active.memory ? ENGINE_OWNERS.NEMOTAVERN : ENGINE_OWNERS.NONE;
        }
        throw new TypeError(`Unknown engine: ${engine}`);
    }

    function snapshot() {
        return Object.freeze({
            summaryOwner: ownerFor('summary'),
            loreOwner: ownerFor('lore'),
            memoryOwner: ownerFor('memory'),
        });
    }

    function owns(engine, owner = ENGINE_OWNERS.MODULAR) {
        return ownerFor(engine) === owner;
    }

    return Object.freeze({ snapshot, ownerFor, owns, owners: ENGINE_OWNERS });
}
