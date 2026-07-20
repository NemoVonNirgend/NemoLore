import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

test('package and manifest versions remain aligned', async () => {
    const [manifest, pkg] = await Promise.all([
        readJson('manifest.json'),
        readJson('package.json'),
    ]);
    assert.equal(pkg.version, manifest.version);
    assert.equal(pkg.type, 'module');
    assert.equal(typeof pkg.scripts?.test, 'string');
});

test('manifest entry files and test workflow exist', async () => {
    const manifest = await readJson('manifest.json');
    await Promise.all([
        access(manifest.js),
        access(manifest.css),
        access('.github/workflows/test.yml'),
    ]);
    assert.equal(manifest.generate_interceptor, 'nemolore_intercept_messages');
});

test('legacy settings resolve relative to the dynamically imported module', async () => {
    const source = await readFile('index.js', 'utf8');
    assert.match(source, /new URL\('\.\/settings\.html', import\.meta\.url\)/);
    assert.doesNotMatch(source, /script\[src\*=["']NemoLore\/index\.js/);
    await access('settings.html');
});
