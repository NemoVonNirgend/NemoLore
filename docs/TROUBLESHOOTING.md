# Troubleshooting

Use the browser developer console together with **Open NemoLore Inspector**. The console diagnoses bootstrap and host-integration failures; the inspector diagnoses context, provider routing, persistence state, and helper scheduling after bootstrap succeeds.

## Extension does not load

Verify the extension directory contains these paths directly:

```text
NemoLore/manifest.json
NemoLore/bootstrap.js
NemoLore/index.js
NemoLore/src/
```

A common installation mistake is `third-party/NemoLore/NemoLore/manifest.json`. Move the inner checkout up one level. Restart SillyTavern after changing extension files and hard-refresh the browser to clear cached modules.

In the console, distinguish:

- a `bootstrap.js` import failure, which prevents modular and compatibility setup;
- an `index.js` import failure, which prevents the legacy compatibility layer from completing;
- a `settings.html` failure, which can leave services running while the drawer is absent.

For repository validation, run `npm test` and `npm run test:smoke` from the extension directory with Node.js 20 or newer.

## Modular controls are missing

The modular section is inserted into the legacy NemoLore settings container after it appears. Wait for the Extensions drawer to finish loading, close and reopen it, and hard-refresh once. If the legacy NemoLore panel exists but **Parallel Helpers & Context** does not, search the console for:

```text
Legacy settings loaded without a compatible container for modular controls
```

Compatibility/fallback rendering of the legacy drawer can change its structure. Capture the SillyTavern version and relevant DOM/console error when reporting this issue.

## Helper does not run

Check the following in order:

1. **Enable parallel helper agents** is on.
2. The workflow's **Run ... after replies** control is on.
3. Summary/lore engine mode is `modular` for those workflows.
4. The chat has met the workflow's minimum-message count.
5. The per-chat cooldown has elapsed.
6. **Maximum helper calls per reply** has not excluded the workflow; selection priority is memory, summary, lore.
7. Lore has a signal when **Require a lore-worthy signal** is on.
8. The event was a completed assistant reply, not a first-message, command, or extension event.
9. The provider field contains a registered name (`sillytavern` or configured `async`).

The inspector lists queued, running, succeeded, failed, and cancelled jobs. Repeated dispatch of the same workflow/chat/message returns the existing successful job by design.

## Provider errors and fallback

For `sillytavern`, verify normal SillyTavern generation works first. NemoLore uses the active host connection; it does not maintain a second copy of those credentials.

For `async`:

- enter a full chat-completions endpoint, not a provider home page;
- verify the model name and bearer key;
- confirm the response is OpenAI-compatible;
- reload after saving, because the provider is registered only at startup.

The configured provider name is case-sensitive. Legacy labels such as `openai` or `gemini` are not modular provider registry names.

After repeated failures, a circuit may remain open until its cooldown. Correct the endpoint, then click **Reset Provider Circuits**. If a fallback is configured, confirm it is registered and differs from the primary.

Helper failures should not interrupt foreground chat generation. If a chat generation itself fails at the same time, diagnose the SillyTavern backend separately before attributing it to helper scheduling.

## Memory or summary appears under the wrong chat

Stop generation, switch away, then switch back and check the active chat ID in the inspector. NemoLore serializes chat activation and flushes the previous chat before loading the next one. Do not trigger rapid chat changes through custom scripts while persistence is still settling.

If the issue reproduces after a normal switch and reload, preserve both chats and report:

- the two chat IDs;
- the active chat ID shown by the inspector;
- whether the issue affects memory, modular summary, or lorebook association;
- relevant `chat_metadata.nemolore` keys with private content removed.

## Summary is not injected

Confirm:

- **Inject conversation summary** is on;
- the active chat has a non-empty summary in the Summary Manager;
- precedence permits the source that exists;
- a context package has been built since the summary changed.

The inspector should list a `summary` contribution after a generation/interceptor run. In modular mode, old messages are not hidden until a modular summary exists and message hiding is enabled. In legacy mode, the modular interceptor intentionally leaves the chat array untouched.

## Lore Manager reports no associated lorebook

Open a real chat first. Run a modular lore preview or use the existing lore setup flow to create/associate a book. The association is per chat. If a book exists but is not associated, use SillyTavern's world-info controls to associate it with the chat, then reload.

Do not create a blank metadata association by hand. The repository writes both NemoLore and SillyTavern association fields together.

## Protected lore changed unexpectedly

Confirm protection is visible on the exact UID that was updated. Protection is stored per entry, so a duplicate unprotected entry with another UID can still be changed. Use normalized identities in the Lore Manager to locate duplicates and merge only after backing up the lorebook.

Generated preview and apply both check protection. Manual edits made outside NemoLore and explicit **Remove protection** actions are outside that safeguard.

## Duplicate listeners or duplicate jobs

The memory lifecycle and post-reply listener installers are idempotent; repeated initialization in one page should not add another listener. Successful helper work also retains its dedupe key for the page session.

If duplicates occur, record whether they appear after a full reload, after hot-reloading extension modules, or after manually calling install APIs. Include the chat ID, message ID, workflow, and inspector job list. A full reload clears session-only listener and dedupe state and is the correct recovery after extension files change.

## Useful diagnostic API

After successful bootstrap, `globalThis.NemoLore` exposes read-oriented inspection surfaces in the browser console:

```js
NemoLore.lifecycle.snapshot()
NemoLore.providers.registry.list()
NemoLore.providers.router.inspect()
NemoLore.agents.runtime.inspect()
NemoLore.observability.snapshot()
```

Avoid mutating stores or chat metadata from the console when reproducing a persistence issue; doing so bypasses the normal lifecycle being tested.
