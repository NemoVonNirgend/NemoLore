import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

async function collectJavaScriptFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await collectJavaScriptFiles(fullPath));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files;
}

test('all modular source files import without host globals', async () => {
    const sourceRoot = path.resolve('src');
    const files = await collectJavaScriptFiles(sourceRoot);
    assert.ok(files.length > 0, 'Expected modular source files to exist.');

    const failures = [];
    for (const file of files.sort()) {
        try {
            await import(pathToFileURL(file).href);
        } catch (error) {
            failures.push({ file: path.relative(process.cwd(), file), error: error?.stack ?? String(error) });
        }
    }

    assert.deepEqual(failures, [], `Module import failures:\n${JSON.stringify(failures, null, 2)}`);
});
