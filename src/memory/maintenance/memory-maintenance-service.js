export function createMemoryMaintenanceService({ aging, consolidation, episodePromotion, corePromotion, logger } = {}) {
    if (!aging?.run || !consolidation?.run || !episodePromotion?.run || !corePromotion?.run) {
        throw new TypeError('Memory maintenance requires aging, consolidation, episode promotion, and core promotion services.');
    }

    async function run(context = {}) {
        const episodePromotionResult = episodePromotion.run(context);
        const corePromotionResult = corePromotion.run(context);
        const consolidationResult = consolidation.run(context);
        const agingResult = aging.run(context);
        logger?.debug('Completed memory maintenance.', {
            consolidated: consolidationResult.consolidated?.length ?? 0,
            aged: agingResult.aged?.length ?? 0,
            episodes: episodePromotionResult.episodes?.length ?? 0,
            core: corePromotionResult.promoted?.length ?? 0,
        });
        return { episodePromotion: episodePromotionResult, corePromotion: corePromotionResult, consolidation: consolidationResult, aging: agingResult };
    }

    return Object.freeze({ run });
}
