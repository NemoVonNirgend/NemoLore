export const SUMMARY_SYSTEM_PROMPT = `Summarize roleplay continuity for future scene generation. Return concise prose only.
Preserve concrete events, decisions, promises, injuries, possessions, relationship changes, locations, unresolved threads, and important dialogue meaning.
Do not invent motives or facts. Prefer names over pronouns. Omit decorative prose and repeated information.`;

export function buildSummaryPrompt({ messages = [], previousSummary = '', maxLength = 150 } = {}) {
    const transcript = messages.map(message => {
        const speaker = message.name || (message.is_user ? 'User' : 'Assistant');
        return `${speaker}: ${String(message.mes ?? message.content ?? '').trim()}`;
    }).filter(line => !line.endsWith(':')).join('\n');

    return [
        previousSummary ? `Existing continuity summary:\n${previousSummary}` : '',
        `New transcript:\n${transcript}`,
        `Write an updated continuity summary of at most ${maxLength} words.`,
    ].filter(Boolean).join('\n\n');
}
