# NemoLore Architecture

NemoLore is a modular SillyTavern extension composed from small, dependency-directed services. `bootstrap.js` is the only runtime entrypoint; the former single-file runtime was retired after its data and UI responsibilities were migrated.

## Design goals

- Preserve user data through versioned migration.
- Keep SillyTavern-specific APIs behind integration adapters.
- Maintain one canonical runtime state store.
- Separate persisted settings from ephemeral state.
- Make memory, lore, retrieval, providers, and UI independently testable.
- Avoid circular dependencies.

## Dependency direction

```text
bootstrap.js
  -> core/lifecycle
      -> feature services
          -> integrations
          -> core state/settings/logger
          -> utilities
```

Feature modules may depend on `core` and `integrations`. Core modules must not import feature modules or UI modules.

## Structure

```text
src/
  core/
    constants.js
    logger.js
    settings.js
    state.js
    lifecycle.js
  integrations/
    sillytavern-*.js
    world-info-adapter.js
  memory/
    extractors/
    processors/
    retrieval/
    maintenance/
    memory-store.js
    memory-persistence.js
  lore/
    noun-detector.js
    lorebook-service.js
    entry-generator.js
    entry-updater.js
  summary/
  context/
  agents/
  presets/
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

## Completed migration

1. Core constants, logging, settings defaults, and runtime state.
2. Small utilities and SillyTavern adapters.
3. Noun detection and highlighting.
4. Summary storage, queueing, and context injection.
5. Core and hierarchical memory.
6. Lorebook generation and updates.
7. Semantic memory indexing and retrieval through SillyTavern's built-in Vector Storage configuration.
8. UI composition and final lifecycle extraction.
9. Replace the legacy runtime and settings shell with `bootstrap.js` and the standalone modular UI.

## Migration rule

Legacy settings and summaries are accepted only as versioned migration inputs. They cannot select an alternate runtime. Source data and policy snapshots remain recoverable, while all active execution uses modular services.
