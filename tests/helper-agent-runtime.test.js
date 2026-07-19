import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelperAgentRegistry } from '../src/agents/helper-agent-registry.js';
import { createHelperAgentRuntime } from '../src/agents/helper-agent-runtime.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('runs helper jobs with bounded concurrency', async () => {
    const registry = createHelperAgentRegistry();
    let active = 0;
    let peak = 0;
    registry.register('work', {
        async run(job) {
            active += 1;
            peak = Math.max(peak, active);
            await tick();
            active -= 1;
            return job.payload.value;
        },
    });

    const runtime = createHelperAgentRuntime({ registry, concurrency: 2 });
    const jobs = [1, 2, 3, 4].map(value => runtime.enqueue({ agent: 'work', payload: { value } }));
    await new Promise(resolve => {
        const unsubscribe = runtime.subscribe(event => {
            if (event === 'succeeded' && runtime.list().filter(job => job.status === 'succeeded').length === 4) {
                unsubscribe();
                resolve();
            }
        });
    });

    assert.equal(peak, 2);
    assert.deepEqual(jobs.map(job => job.status), ['queued', 'queued', 'queued', 'queued']);
});

test('deduplicates active jobs by key', async () => {
    const registry = createHelperAgentRegistry();
    registry.register('work', { async run() { await tick(); return true; } });
    const runtime = createHelperAgentRuntime({ registry, concurrency: 1 });

    const first = runtime.enqueue({ agent: 'work', dedupeKey: 'same' });
    const second = runtime.enqueue({ agent: 'work', dedupeKey: 'same' });
    assert.equal(first.id, second.id);
});
