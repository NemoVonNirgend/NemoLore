# Configuration

NemoLore combines the established settings drawer with a modular section named **Parallel Helpers & Context**. All settings are saved by SillyTavern. Engine and independent-provider changes should be followed by a page reload.

## Engine selection

`summaryEngineMode` and `loreEngineMode` each accept `legacy` or `modular` and default to `legacy`.

### Summary engine

- `legacy`: preserves the established automatic summary queue, legacy summary display/injection, and legacy running-window exclusion.
- `modular`: gates legacy automatic summarization and legacy summary exclusion. Post-reply modular summary jobs may run, the per-chat modular summary store is used, and the modular context contributor can inject the resolved summary.

For automatic modular summaries, enable all three controls:

1. **Enable parallel helper agents**
2. **Run summary after replies**
3. **Summary engine** = `modular`

`autoSummarize` still controls the legacy automatic path. Manual legacy actions remain callable in either mode, but should not be used as a substitute for configuring the selected automatic engine.

### Lore engine

- `legacy`: preserves established automatic lorebook setup, chat prompts, summary-coupled generation, and periodic updates.
- `modular`: gates those legacy automatic paths. Post-reply modular lore jobs use preview/apply safety and the chat-associated lorebook repository.

For automatic modular lore, enable all three controls:

1. **Enable parallel helper agents**
2. **Run lore after replies**
3. **Automatic lore engine** = `modular`

If **Require a lore-worthy signal** is enabled, a lore helper is scheduled only when the reply payload contains entities or text that looks like a durable named-entity/event change.

### Summary precedence

When summary context is enabled, the contributor resolves one source according to **Summary precedence**:

| Value | Resolution |
| --- | --- |
| `new-first` | Use the modular per-chat summary, falling back to legacy. |
| `legacy-first` | Use a legacy summary when present, falling back to modular. |
| `new-only` | Inject only the modular summary. |
| `legacy-only` | Inject only the legacy summary. |

**Inject conversation summary** disables or enables the modular summary contribution. Summary content is contributed at the `after-system` position with system role. The default priority is 80.

### Message exclusion

The modular interceptor shortens the generation chat array only when all of these conditions are met:

- summary engine is `modular`;
- a non-empty modular summary exists for the active chat;
- **Hide messages when threshold** is enabled.

It retains the most recent **Running Memory Size** messages. In legacy mode, the modular interceptor forwards the original chat array untouched and the legacy path owns its normal exclusion behavior.

## Provider configuration

### `sillytavern`

The `sillytavern` provider is always registered. It converts helper messages into a prompt and calls SillyTavern's `generateRaw`, so it uses the generation connection and credentials already configured in SillyTavern. This is the recommended starting point.

Enter `sillytavern` in **Shared helper provider**, or leave the field empty to use the active registered provider (which is `sillytavern` in the default configuration).

### `async`

The modular `async` provider is registered at bootstrap only when **Enable Independent Async API** is enabled and **Custom Endpoint** is not empty. The endpoint must accept an OpenAI-compatible `POST` body containing `model`, `messages`, and optional `max_tokens`, `temperature`, and `stop`, and return text in a common OpenAI-compatible response field.

Configure the independent API fields in the established NemoLore settings:

- enable the independent API;
- supply the API key if the endpoint requires bearer authentication;
- supply the model;
- supply the full chat-completions endpoint URL.

Save, then reload. Enter `async` in the helper provider field. The provider is not dynamically added or removed after bootstrap.

The established legacy async API path also has provider-specific behavior. Do not assume that a legacy provider label such as `openai`, `gemini`, `claude`, or `openrouter` is a modular registry name; modular helper fields normally use `sillytavern` or `async`.

### Routing and fallback

Provider selection order for a workflow is:

1. an explicit provider supplied by a manual/API call;
2. the workflow override (**Memory provider override**, **Summary provider override**, or **Lore provider override**);
3. **Shared helper provider**;
4. the registry's active provider.

If the primary route fails after retries, **Fallback provider** is attempted once without additional retries. The fallback must be registered and must differ from the primary.

Timeouts, retries, and a per-provider circuit breaker are configured by:

- `helperRequestTimeoutMs` (default 45,000 ms);
- `helperRetryCount` (default 1 retry);
- `helperCircuitBreakerFailures` (default 3 failures);
- `helperCircuitBreakerCooldownMs` (default 60,000 ms).

The UI exposes timeout and retry controls. Use **Reset Provider Circuits** after correcting a provider configuration if you do not want to wait for the cooldown.

## Helper scheduling

The helper master toggle is **Enable parallel helper agents**. The runtime concurrency default is 3, with a supported UI range of 1 to 6. **Maximum helper calls per reply** caps selected workflows after policy evaluation; the order is memory, summary, then lore.

Each workflow has:

- an after-reply toggle;
- a minimum-message threshold;
- an optional cooldown scoped to the chat and workflow;
- a provider route.

Current defaults are memory enabled after replies with no minimum, summary disabled with a four-message minimum, and lore disabled with a two-message minimum plus a lore-signal requirement.

SillyTavern events that are not completed assistant replies (including first-message, command, and extension events) are ignored by the post-reply listener. A job dedupe key combines workflow, chat ID, and message ID. Successful work stays deduplicated for the current page session; failed or cancelled work releases the key so it can be retried. Helper errors are recorded and logged rather than thrown into the foreground chat generation path.

## Context controls

NemoLore's context registry currently includes summary and memory contributors. Contributions are assigned roles, positions, priorities, and token estimates, then assembled within the available context budget. The SillyTavern adapter maps these into extension prompt slots.

Use **Open NemoLore Inspector** after a generation attempt to inspect:

- selected and omitted contributions;
- token estimates and omission reasons;
- contributor names and positions;
- helper job state;
- current memory, summary, and lorebook state.

The inspector reflects the latest context package built in the current page session; before the first build it reports that no context package is available.
