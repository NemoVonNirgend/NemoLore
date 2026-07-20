# NemoLore preset architecture

NemoLore presents story-scale policies instead of exposing its internal scheduling graph as the primary user experience. The modular runtime is the only target architecture; legacy settings and records are migration inputs rather than alternate engines.

## Presets

- **Short RP** keeps recent summaries and sparse lore maintenance, without message hiding, vector retrieval, core memories, aging, or consolidation.
- **Long Form** is the recommended complete experience for stories lasting hundreds of messages.
- **Episodic** consolidates turn detail into scene and episode records sooner while prioritizing developments and lasting consequences.
- **Epic** combines a tight recent-message window with aggressive extraction, hierarchical summaries, broad retrieval, and strong provenance for chats reaching thousands of messages.

Definitions live in `src/presets/preset-registry.js`. They are immutable and versioned independently from stored user settings. A resolved preset combines its base policy with recognized explicit overrides.

## Staged migration

The first checkpoint classifies pre-preset settings and records a migration explanation without silently changing an existing installation's behavior. Clean installations use Long Form and the modular summary/lore engines immediately.

Later checkpoints will replace direct module reads with resolved policy values, introduce preset cards and a small Advanced override surface, migrate every legacy data family, validate record counts and provenance, and finally disable legacy runtime execution.

Migration is required to be idempotent, resumable, and source-preserving.

## Live policy adoption

The runtime reads profile values dynamically for:

- memory retrieval token budgets and candidate limits;
- recent-message and summary input windows;
- summary and lore message cadence;
- helper workflow enablement, limits, and concurrency;
- message exclusion windows;
- provider routing and circuit behavior.

Switching profiles resets scheduling history so the newly selected cadence takes effect without retaining stale per-chat counters. Running helper jobs are allowed to finish; a lower concurrency limit applies to subsequent work rather than cancelling active operations.
