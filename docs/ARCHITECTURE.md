# NemoLore architecture

NemoLore uses a modular runtime behind a compatibility entrypoint. `manifest.json` loads `bootstrap.js`; the bootstrap constructs services and imports `index.js` to preserve established UI, manual workflows, highlighting, macro support, and other legacy behavior.

The architecture is deliberately incremental. `index.js` is not yet a thin file, but automatic summary and lore ownership is selected explicitly so legacy and modular engines do not compete.

## Startup sequence

```text
manifest.json
  -> bootstrap.js
      -> link legacy and canonical settings namespaces
      -> register generation providers
      -> construct memory, summary, lore, context, helper, and UI services
      -> import index.js compatibility module
      -> wrap the legacy generation interceptor
      -> install chat lifecycle and post-reply listeners
      -> install modular settings controls
      -> mark runtime ready
```

The public read/integration surface is exposed as `globalThis.NemoLore`. Its main namespaces are `providers`, `agents`, `context`, `summary`, `lore`, `memory`, `observability`, `settingsController`, and `services`.

## Dependency direction

```text
bootstrap / compatibility entrypoint
  -> feature services and workflows
      -> core contracts and stores
      -> SillyTavern integration adapters
      -> providers
  -> UI controllers
      -> management services
```

Core modules do not depend on UI. Feature logic receives host operations through adapters, allowing repository tests to use fakes without a SillyTavern DOM or backend.

## Subsystems

### Core

`src/core` owns settings/defaults, linked settings namespaces, lifecycle state, logging, keyed locks, and live chat-metadata access. The metadata accessor is important because SillyTavern can replace its exported `chat_metadata` object during chat switches.

### Memory

The memory store holds typed, revisioned records and a source ledger. Extractors produce episodes, atomic facts, and state changes; processors deduplicate, detect contradictions, and score importance. Retrieval selects, scores, filters, budgets, and composes context.

Memory persistence serializes the active store to the current chat's metadata. The SillyTavern lifecycle serializes chat activation, flushes the previous chat, loads the new chat, and invokes the idempotent legacy-summary migrator.

### Summary

The modular summary store keeps one lineage-aware record per chat. The service builds bounded inputs and routes generation through the provider router. The context contributor resolves modular versus legacy data using explicit precedence and contributes at `after-system`.

The compatibility coordinator reports selected summary/lore modes. Guards in `index.js` gate legacy automatic work at each scheduling, drain, injection, exclusion, setup, and update boundary rather than temporarily mutating persisted settings.

### Lore

The lorebook repository owns chat association and delegates physical world-info operations to the SillyTavern adapter. Generation is two-phase: preview normalizes model operations and resolves entity identities; apply re-loads the lorebook, re-checks protected entries, and serializes writes by chat and identity.

The management service adds operator-controlled protection and duplicate merge behavior.

### Providers and helper agents

The provider registry has an always-available SillyTavern adapter and an optional OpenAI-compatible provider registered at startup. The resilient router applies per-workflow overrides, retries, timeouts, fallback, and circuit breaking.

Post-reply scheduling filters events and policy conditions before batching memory, summary, and lore jobs. The runtime enforces concurrency and job dedupe. Helper exceptions are stored on jobs and do not propagate into foreground chat generation.

### Context integration

The context registry collects normalized contributions. The injector applies priority and token budgets. The SillyTavern bridge maps four abstract positions to extension-prompt slots and exposes the most recent package for inspection.

The wrapped generation interceptor runs context assembly and then summary-mode-aware exclusion. In modular summary mode it trims the actual prompt chat only when a modular summary is available; in legacy mode it forwards the original chat to legacy logic.

### UI and observability

The modular settings controller installs into the established NemoLore drawer. It owns access to memory, summary/lore, and inspector panels. Management panels call services rather than mutating stores or world-info documents directly.

Observability subscribes to helper and memory events and snapshots context, contributors, per-chat summary/lore state, and job queues. Its history is bounded and session-local.

## Persistence boundaries

Persisted:

- global extension settings through SillyTavern;
- memories, summaries, migration markers, and association metadata per chat;
- lore entries in SillyTavern world-info files.

Session-only:

- helper queues and completed-job dedupe keys;
- provider circuit counters;
- current context package and observability history;
- DOM panels and listener installation state.

## Compatibility constraints

- Engine modes default to legacy.
- Legacy manual surfaces remain available.
- The `nemolore` and `NemoLore` settings names refer to one object.
- Mode changes require reload so startup-time provider and compatibility wiring is deterministic.
- The extension's manifest interceptor name remains `nemolore_intercept_messages`.
- Existing lorebooks and legacy summary sources are preserved during modular migration.

New work should stay behind the current service/adapter boundaries. Redesigning the compatibility layer is out of scope unless a concrete host-runtime failure requires it.
