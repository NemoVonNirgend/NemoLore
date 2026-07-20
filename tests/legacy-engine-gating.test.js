import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('legacy index uses the shared lowercase settings namespace', async () => {
    const source = await readFile('index.js', 'utf8');

    assert.match(source, /linkExtensionSettingsNamespaces\(extension_settings\)/);
    assert.match(source, /extension_settings\[EXTENSION_NAME\] = nemoLoreSettings/);
    assert.match(source, /extension_settings\[MODULE_NAME\] = nemoLoreSettings/);
});

test('modular summary mode gates every legacy automatic queue and exclusion boundary', async () => {
    const source = await readFile('index.js', 'utf8');

    assert.match(source, /function legacySummaryAutomationEnabled\(\)/);
    assert.match(source, /static async processSummaryQueue\(\) \{\s*if \(!legacySummaryAutomationEnabled\(\)\)/);
    assert.match(source, /static queueMessageForSummary\(messageIndex\) \{\s*if \(!legacySummaryAutomationEnabled\(\)\)/);
    assert.match(source, /static shouldExcludeFromContext\(messageIndex\) \{\s*if \(!legacySummaryAutomationEnabled\(\)\) return false;/);
    assert.match(source, /globalThis\.nemolore_intercept_messages = function \(chat, contextSize, abort, type\) \{\s*if \(!legacySummaryAutomationEnabled\(\)\) return;/);
    assert.match(source, /legacySummaryAutomationEnabled\(\)\s*&& nemoLoreSettings\.autoSummarize/);
    assert.match(source, /if \(!manual && !legacySummaryAutomationEnabled\(\)\) return null;/);
    assert.match(source, /getContext\(\)\?\.chat\?\.\[index1\] !== message1/);
    assert.match(source, /summarizeMessage\(messageIndex, \{ manual: true \}\)/);
});

test('modular lore mode gates legacy chat setup and periodic update boundaries', async () => {
    const source = await readFile('index.js', 'utf8');

    assert.match(source, /function legacyLoreAutomationEnabled\(\)/);
    assert.match(source, /async function handleIntelligentLorebookSetup\(chatId\) \{\s*if \(!legacyLoreAutomationEnabled\(\)\) return;/);
    assert.match(source, /static async createAutoLorebook\(chatId\) \{\s*if \(!legacyLoreAutomationEnabled\(\)\) return null;/);
    assert.match(source, /function checkForPeriodicUpdate\(\) \{\s*if \(!legacyLoreAutomationEnabled\(\)\) return;/);
    assert.match(source, /async function performPeriodicUpdate\(\) \{\s*if \(!legacyLoreAutomationEnabled\(\)\) return;/);
});
