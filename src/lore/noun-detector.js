const COMMON_WORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'had', 'have',
    'what', 'were', 'they', 'has', 'his', 'that', 'with', 'this', 'will', 'from', 'said', 'she', 'him', 'been',
    'who', 'did', 'get', 'may', 'how', 'use', 'man', 'new', 'now', 'way', 'day', 'two', 'men', 'old', 'see',
    'oil', 'sit', 'set', 'run', 'eat', 'far', 'sea', 'eye', 'ago', 'off', 'too', 'any', 'sun', 'why', 'let',
    'put', 'end', 'try', 'big', 'ask', 'own', 'say',
]);

const COMMON_PROPER_NOUNS = new Set([
    'English', 'American', 'European', 'Asian', 'African', 'God', 'Jesus', 'Christ', 'Buddha', 'Allah',
    'Internet', 'Google', 'Facebook', 'Twitter', 'YouTube', 'Amazon', 'Apple', 'Microsoft',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December',
]);

const PROPER_NOUN_PATTERNS = Object.freeze([
    /\b[A-Z][a-z]+\s+(?:of|in|at|on|from|to|for)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]*[A-Z][a-z]*\b/g,
    /\b[A-Z]{2,}\b/g,
    /\b[A-Z][a-z]*(?:store|shop|mart|center|centre|cafe|restaurant|hotel|motel|inn|pub|bar|club|gym|hospital|school|college|university|library|museum|theater|theatre|cinema|park|garden|plaza|mall|market|bank|church|temple|mosque|synagogue)\b/gi,
    /\b(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor|Sir|Lady|Lord|Duke|Duchess|King|Queen|Prince|Princess|Captain|Colonel|General|Admiral)\.\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|Company|Industries|Enterprises|Foundation|Institute|Academy|Society)\b/gi,
    /"[A-Z][^"]*"/g,
    /'[A-Z][^']*'/g,
    /\b[A-Z][a-z]*['’\-][a-z]+(?:['’\-][a-z]+)*\b/g,
    /\b[A-Z][a-z]*-[A-Z]?[a-z]+(?:-[A-Z]?[a-z]+)*\b/g,
]);

const PLACE_PATTERN = /\b(bookstore|restaurant|cafe|hospital|library|museum|theater|theatre|cinema|park|hotel|motel|inn|pub|bar|club|gym|school|college|university|bank|church|temple|mosque|synagogue|store|shop|mall|market|plaza|garden)\b/gi;
const QUOTED_PATTERN = /["']([^"']{3,50})["']/g;

function cleanFormattingText(text) {
    return String(text ?? '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/~~(.*?)~~/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/#{1,6}\s*/g, '')
        .trim();
}

function isNumericOrDate(word) {
    return /^\d+$/.test(word)
        || /^\d{4}$/.test(word)
        || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(word)
        || /^(January|February|March|April|May|June|July|August|September|October|November|December)$/i.test(word)
        || /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(word);
}

function isCommonEnglishWord(word) {
    return [
        /^(am|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|can|must)$/i,
        /^(this|that|these|those|here|there|where|when|what|who|why|how)$/i,
        /^(and|or|but|so|yet|for|nor|if|then|else|than|as|like)$/i,
    ].some((pattern) => pattern.test(word));
}

function filterCompoundNouns(nouns) {
    const filtered = [];
    const seen = new Set();

    for (const noun of [...nouns].sort((a, b) => b.length - a.length)) {
        const normalized = noun.toLowerCase();
        if (seen.has(normalized)) continue;
        if (filtered.some((longer) => longer.toLowerCase().includes(normalized))) continue;
        filtered.push(noun);
        seen.add(normalized);
    }

    return filtered;
}

export function createNounDetector({ settings, logger }) {
    function isValidNoun(noun) {
        if (!noun || noun.length < settings.nounMinLength) return false;
        if (settings.excludeCommonWords && COMMON_WORDS.has(noun.toLowerCase())) return false;
        if (isCommonEnglishWord(noun) || isNumericOrDate(noun)) return false;
        return true;
    }

    function shouldHighlight(noun) {
        return noun.length >= settings.nounMinLength && !COMMON_PROPER_NOUNS.has(noun);
    }

    function detect(text) {
        const cleanText = cleanFormattingText(text);
        const nouns = new Set();

        for (const pattern of PROPER_NOUN_PATTERNS) {
            pattern.lastIndex = 0;
            for (const match of cleanText.match(pattern) ?? []) {
                const noun = match.trim().replace(/^["']|["']$/g, '');
                if (isValidNoun(noun)) nouns.add(noun);
            }
        }

        PLACE_PATTERN.lastIndex = 0;
        for (const match of cleanText.match(PLACE_PATTERN) ?? []) {
            const noun = match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
            if (isValidNoun(noun)) nouns.add(noun);
        }

        QUOTED_PATTERN.lastIndex = 0;
        let match;
        while ((match = QUOTED_PATTERN.exec(cleanText)) !== null) {
            const noun = match[1].trim();
            if (/^[A-Z]/.test(noun) && isValidNoun(noun)) nouns.add(noun);
        }

        const result = filterCompoundNouns([...nouns].filter(shouldHighlight));
        logger.debug('Detected lore candidates.', result);
        return result;
    }

    return Object.freeze({
        detect,
        cleanFormattingText,
        isValidNoun,
        shouldHighlight,
    });
}
