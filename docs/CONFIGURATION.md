# Configuration

## Profiles

Select Short RP, Long Form, Episodic, or Epic in the NemoLore drawer. A profile controls recent-message windows, summary and lore cadence, memory extraction and maintenance, helper concurrency, retrieval budgets, and semantic retrieval. Advanced edits are stored as profile overrides.

The modular architecture owns summary and lore execution. Stored `legacy` engine values are migration signals only and are normalized to `modular`.

## Generation providers

Use **Helper connection**, above Advanced tuning. Enable helpers, select a provider, then select a model. The choice saves automatically. SillyTavern providers reuse their native default endpoints and saved credentials through the SillyTavern server. Set up credentials in API Connections first. Vertex also inherits its authentication mode, region, and project settings.

SillyTavern's model catalogue includes extension-added models. Sources supporting model-list APIs fetch models when selected and have a refresh button. Vertex uses the host catalogue. Account access must still be verified with the provider. An unlisted model can be entered by choosing **Enter another model ID…**.

Choose **Use current chat connection** to follow the main model. Choose **Manual OpenAI-compatible endpoint** for separate endpoint/key/model fields, including common URL presets. The manual URL must be the full chat-completions URL. Changing it clears the old manual key; saved SillyTavern credentials are never placed in this field.

Internal route IDs remain available to integrations: `sillytavern` follows `generateRaw`, `st-saved` uses `helperConnectionSource` and `helperConnectionModel`, and `async` uses the manual endpoint when enabled. Existing custom route names are retained. The native chat provider is always registered and remains the default for unavailable legacy routes.

Saved-connection requests clone native generation settings and inherit the visible response-token limit, preserving explicit caller limits. They do not change the foreground source, model, or global token settings. Manual endpoints omit `max_tokens` unless a caller supplies a limit.

The current-chat route also uses this isolated native path when the active API is Chat Completions. Other APIs retain the `generateRaw` fallback. **Helper temperature** is blank by default: native connections inherit their sampling settings and manual endpoints omit the temperature parameter. Set a number (including zero) to override helper sampling for native Chat Completions or manual endpoints. Explicit per-call temperatures take precedence. Other current-chat API types keep their native sampling.

## Helper routing

The shared provider applies to every helper unless a memory, summary, or lore override is present. The fallback provider is attempted after the primary exhausts its configured retries. Timeouts and circuit-breaker limits protect foreground generation from a stalled provider.

Post-reply helper toggles and minimum-message settings decide which jobs are eligible. Lore can also require a lore-worthy signal. Successful jobs keep a dedupe record; failed jobs may be retried later.

Concurrency and the per-reply maximum count helper jobs, not HTTP requests. A normal memory job performs three extraction requests; summary and lore each perform one. Timeouts abort the request before retrying. Cancelling a job prevents its retry/fallback path and all later commits.

Message deletion, edits, and swipe changes cancel affected work and invalidate obsolete memory and summaries. The next completed reply can schedule a fresh batch; mutation events never directly dispatch helpers. Already-applied lorebook changes remain available for manual review and are not automatically undone.

## Context

The active profile controls memory budget, candidate count, summary input size, and the recent-message exclusion window. Reviewed preferences are injected before summary and memory when enabled. Only accepted global preferences and accepted preferences matching the active user persona are eligible.

## Semantic memory

NemoLore does not store a second embedding key. It inherits the source, model, credential, and alternate endpoint from SillyTavern Vector Storage. When the inherited source cannot be used by a third-party extension, the semantic index reports unavailable and retrieval continues lexically.

Use the inspector to see availability, active collection, indexed/dirty counts, last error, and the rebuild command.
