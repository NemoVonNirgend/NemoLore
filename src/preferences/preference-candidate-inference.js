const STOP_WORDS = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'into', 'then', 'than', 'their', 'there', 'have', 'had', 'was', 'were', 'she', 'her', 'his', 'him', 'they', 'them', 'you', 'your']);

function tokens(text) {
    return String(text ?? '').toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) ?? [];
}

function phrases(text) {
    const values = tokens(text);
    const result = new Set();
    for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= values.length - size; index += 1) {
            const words = values.slice(index, index + size);
            if (words.filter(word => !STOP_WORDS.has(word)).length < 2) continue;
            result.add(words.join(' '));
        }
    }
    return result;
}

export function createPreferenceCandidateInference({ store, settings, logger } = {}) {
    if (!store?.listEvidence || !store?.save) throw new TypeError('Preference inference requires a preference store.');

    function preview({ threshold = settings?.preferenceInferenceThreshold ?? 3, limit = 5 } = {}) {
        const matches = new Map();
        for (const evidence of store.listEvidence()) {
            const accepted = String(evidence.acceptedText ?? '').toLowerCase();
            for (const phrase of phrases(evidence.rejectedText)) {
                if (accepted.includes(phrase)) continue;
                const match = matches.get(phrase) ?? { phrase, evidenceIds: [] };
                match.evidenceIds.push(evidence.id);
                matches.set(phrase, match);
            }
        }
        const existingKeys = new Set(store.list().map(item => item.metadata?.inferenceKey).filter(Boolean));
        const existingEvidence = new Set(store.list().map(item => item.metadata?.inferenceEvidenceSignature).filter(Boolean));
        const selected = [];
        const seenEvidence = new Set(existingEvidence);
        const ranked = [...matches.values()]
            .filter(match => match.evidenceIds.length >= threshold && !existingKeys.has(match.phrase))
            .sort((a, b) => b.evidenceIds.length - a.evidenceIds.length || b.phrase.length - a.phrase.length);
        for (const match of ranked) {
            const signature = [...match.evidenceIds].sort().join('|');
            if (seenEvidence.has(signature)) continue;
            seenEvidence.add(signature);
            selected.push({ ...match, evidenceSignature: signature });
            if (selected.length >= limit) break;
        }
        return selected;
    }

    function generate(options) {
        const proposals = preview(options);
        const records = proposals.map(proposal => store.save({
            content: `Avoid the recurring pattern “${proposal.phrase}”.`,
            status: 'candidate',
            confidence: Math.min(0.9, 0.5 + (proposal.evidenceIds.length * 0.1)),
            evidenceIds: proposal.evidenceIds,
            tags: ['inferred-preference'],
            metadata: {
                origin: 'evidence-inference',
                inferenceKey: proposal.phrase,
                inferenceEvidenceSignature: proposal.evidenceSignature,
            },
        }));
        logger?.debug('Generated inactive preference candidates.', { count: records.length });
        return records;
    }

    return Object.freeze({ preview, generate });
}
