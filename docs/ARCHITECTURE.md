# NemoLore Architecture

NemoLore is being migrated from a single-file extension into a set of small, dependency-directed modules. The migration is intentionally incremental: `index.js` remains the compatibility entrypoint until each subsystem has been extracted and verified.

## Design goals

- Preserve current behavior during extraction.
- Keep SillyTavern-specific APIs behind integration adapters.
- Maintain one canonical runtime state store.
- Separate persisted settings from ephemeral state.
- Make memory, lore, retrieval, providers, and UI independently testable.
- Avoid circular dependencies.

## Dependency direction

```text
index.js
  -> core/lifecycle
      -> feature services
          -> integrations
          -> core state/settings/logger
          -> utilities
```

Feature modules may depend on `core` and `integrations`. Core modules must not import feature modules or UI modules.

## Planned structure

```text
src/
  core/
    constants.js
    logger.js
    settings.js
    state.js
    lifecycle.js
  integrations/
    sillytavern.js
    events.js
    generation.js
    world-info.js
  memory/
    summary-service.js
    summary-queue.js
    hierarchical-memory.js
    core-memories.js
    context-injector.js
    memory-store.js
  lore/
    noun-detector.js
    lorebook-service.js
    entry-generator.js
    entry-updater.js
  retrieval/
    embedding-provider.js
    vector-store.js
    semantic-search.js
  providers/
    generation-client.js
    profile-provider.js
    async-api-provider.js
  ui/
    panel.js
    notifications.js
    highlighting.js
    tooltips.js
    progress.js
  utils/
    dom.js
    text.js
    tokens.js
    guards.js
```

## Migration order

1. Core constants, logging, settings defaults, and runtime state.
2. Small utilities and SillyTavern adapters.
3. Noun detection and highlighting.
4. Summary storage, queueing, and context injection.
5. Core and hierarchical memory.
6. Lorebook generation and updates.
7. Vector retrieval and embedding providers.
8. UI composition and final lifecycle extraction.
9. Reduce `index.js` to a thin bootstrap.

## Compatibility rule

No extraction commit should intentionally change user-visible behavior. Behavioral modernization happens only after the modular migration has a stable baseline.