const GROUP_LABELS = Object.freeze({
    core: 'Core Memories',
    relationship: 'Relationships',
    entity: 'Character and Entity State',
    'world-state': 'Current World State',
    atomic: 'Established Facts',
    episode: 'Relevant Past Events',
    consolidated: 'Long-Term Narrative Context',
});

function renderRecord(record) {
    const title = record.title ? `${record.title}: ` : '';
    return `- ${title}${record.content}`.trim();
}

export function createContextComposer() {
    function compose(selected, { heading = 'Relevant Memory', includeMetadata = false } = {}) {
        const groups = new Map();

        for (const candidate of selected) {
            const record = candidate.record ?? candidate;
            const bucket = groups.get(record.type) ?? [];
            bucket.push(record);
            groups.set(record.type, bucket);
        }

        const sections = [];
        for (const [type, records] of groups) {
            const body = records.map(renderRecord).join('\n');
            sections.push(`### ${GROUP_LABELS[type] ?? type}\n${body}`);
        }

        const text = sections.length
            ? `## ${heading}\n\n${sections.join('\n\n')}`
            : '';

        return {
            text,
            memoryIds: selected.map(candidate => (candidate.record ?? candidate).id),
            groups: Object.fromEntries([...groups].map(([type, records]) => [type, records.length])),
            ...(includeMetadata ? {
                records: selected.map(candidate => ({
                    id: (candidate.record ?? candidate).id,
                    score: candidate.score ?? null,
                    estimatedTokens: candidate.estimatedTokens ?? null,
                })),
            } : {}),
        };
    }

    return Object.freeze({ compose });
}
