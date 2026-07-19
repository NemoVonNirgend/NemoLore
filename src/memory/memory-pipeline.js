export function createMemoryPipeline({ store, sourceLedger, logger } = {}) {
    if (!store) throw new TypeError('Memory pipeline requires a store.');
    if (!sourceLedger) throw new TypeError('Memory pipeline requires a source ledger.');

    const extractors = new Map();
    const processors = [];

    function registerExtractor(name, extractor) {
        if (!name || typeof extractor?.extract !== 'function') {
            throw new TypeError('Extractor requires a name and extract(input) method.');
        }
        extractors.set(name, extractor);
        return extractor;
    }

    function registerProcessor(processor) {
        if (typeof processor !== 'function') {
            throw new TypeError('Processor must be a function.');
        }
        processors.push(processor);
        return processor;
    }

    async function ingest({ sources = [], input, extractor, context = {} } = {}) {
        const registeredSources = sources.map(source => sourceLedger.register(source));
        const sourceIds = registeredSources.map(source => source.id);
        const selectedExtractor = typeof extractor === 'string'
            ? extractors.get(extractor)
            : extractor;

        if (!selectedExtractor || typeof selectedExtractor.extract !== 'function') {
            throw new Error(`Unknown or invalid memory extractor: ${extractor ?? '(none)'}`);
        }

        const extracted = await selectedExtractor.extract({
            input,
            sources: registeredSources,
            context,
        });

        const candidates = Array.isArray(extracted) ? extracted : [extracted];
        const saved = [];

        for (const candidate of candidates.filter(Boolean)) {
            let current = {
                ...candidate,
                sourceIds: candidate.sourceIds?.length ? candidate.sourceIds : sourceIds,
            };

            for (const processor of processors) {
                current = await processor(current, { context, store, sourceLedger });
                if (!current) break;
            }

            if (current) saved.push(store.save(current));
        }

        logger?.debug('Memory ingestion completed.', {
            extractor: typeof extractor === 'string' ? extractor : selectedExtractor.name,
            sourceCount: registeredSources.length,
            memoryCount: saved.length,
        });

        return saved;
    }

    function invalidateSource(sourceId, reason = 'source-removed') {
        const affected = sourceLedger.memoriesForSource(sourceId);
        for (const memoryId of affected) {
            if (store.has(memoryId)) store.invalidate(memoryId, reason);
        }
        sourceLedger.remove(sourceId);
        return affected;
    }

    return Object.freeze({
        registerExtractor,
        registerProcessor,
        ingest,
        invalidateSource,
        getExtractor: name => extractors.get(name) ?? null,
        listExtractors: () => [...extractors.keys()],
    });
}
