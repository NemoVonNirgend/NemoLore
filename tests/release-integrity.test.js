import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.yml', '.yaml']);
const CONFLICT_MARKER = /^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

async function collectTextFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectTextFiles(fullPath));
        } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(fullPath);
        }
    }

    return files;
}

test('published repository contains no unresolved merge markers', async () => {
    const offenders = [];
    for (const file of await collectTextFiles(ROOT)) {
        const source = await readFile(file, 'utf8');
        if (CONFLICT_MARKER.test(source)) offenders.push(path.relative(ROOT, file));
    }

    assert.deepEqual(offenders, [], `Unresolved merge markers found in: ${offenders.join(', ')}`);
});
