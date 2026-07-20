export function createMemoryMaintenanceService({ aging, consolidation, logger } = {}) {
    if (!aging?.run || !consolidation?.run) throw new TypeError('Memory maintenance requires aging and consolidation services.');

    async function run(context = {}) {
        const consolidationResult = consolidation.run(context);
        const agingResult = aging.run(context);
        logger?.debug('Completed memory maintenance.', {
            consolidated: consolidationResult.consolidated?.length ?? 0,
            aged: agingResult.aged?.length ?? 0,
        });
        return { consolidation: consolidationResult, aging: agingResult };
    }

    return Object.freeze({ run });
}
