# Configuration

## Profiles

Select Short RP, Long Form, Episodic, or Epic in the NemoLore drawer. A profile controls recent-message windows, summary and lore cadence, memory extraction and maintenance, helper concurrency, retrieval budgets, and semantic retrieval. Advanced edits are stored as profile overrides.

The modular architecture owns summary and lore execution. Stored `legacy` engine values are migration signals only and are normalized to `modular`.

## Generation providers

`sillytavern` delegates helper requests to SillyTavern's active generation connection. It is registered on every bootstrap and is the default when a stored route names a provider that is no longer available.

`async` sends OpenAI-compatible JSON to the exact endpoint configured in the drawer. Set:

- **Enable OpenAI-compatible provider**
- **Async API endpoint**: full chat-completions URL
- **Async API key**: Bearer token, if required
- **Async API model**: provider model identifier

Changing these fields replaces the live provider registration without requiring a full extension reinstall.

## Helper routing

The shared provider applies to every helper unless a memory, summary, or lore override is present. The fallback provider is attempted after the primary exhausts its configured retries. Timeouts and circuit-breaker limits protect foreground generation from a stalled provider.

Post-reply helper toggles and minimum-message settings decide which jobs are eligible. Lore can also require a lore-worthy signal. Successful jobs keep a dedupe record; failed jobs may be retried later.

## Context

The active profile controls memory budget, candidate count, summary input size, and the recent-message exclusion window. Reviewed preferences are injected before summary and memory when enabled. Only accepted global preferences and accepted preferences matching the active user persona are eligible.

## Semantic memory

NemoLore does not store a second embedding key. It inherits the source, model, credential, and alternate endpoint from SillyTavern Vector Storage. When the inherited source cannot be used by a third-party extension, the semantic index reports unavailable and retrieval continues lexically.

Use the inspector to see availability, active collection, indexed/dirty counts, last error, and the rebuild command.
