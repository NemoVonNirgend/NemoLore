import {
    saveSettingsDebounced,
    chat,
    chat_metadata,
    this_chid,
    getCurrentChatId,
    saveMetadata,
    callPopup,
    eventSource,
    event_types,
    saveChatConditional,
    characters,
    extension_prompt_roles,
    active_character,
    generateQuietPrompt,
    substituteParamsExtended,
    generateRaw,
    getMaxContextSize,
    main_api
} from '../../../../script.js';
import { selected_group } from '../../../group-chats.js';
import { extension_settings, renderExtensionTemplateAsync, writeExtensionField, getContext } from '../../../extensions.js';
import { download, getFileText, uuidv4, getSortableDelay, getStringHash, trimToEndSentence } from '../../../utils.js';
import { getPresetManager } from '../../../preset-manager.js';
import { 
    world_names, 
    createNewWorldInfo, 
    deleteWorldInfo, 
    saveWorldInfo, 
    loadWorldInfo, 
    updateWorldInfoList, 
    createWorldInfoEntry, 
    openWorldInfoEditor,
    METADATA_KEY, 
    DEFAULT_DEPTH, 
    DEFAULT_WEIGHT, 
    world_info_logic, 
    world_info_position 
} from '../../../world-info.js';

const MODULE_NAME = 'NemoLore';
const EXTENSION_NAME = 'nemolore';

// Settings and state management
let nemoLoreSettings = {
    enabled: true,
    autoMode: false,
    updateInterval: 50,
    highlightNouns: true,
    createLorebookOnChat: true,
    notificationTimeout: 10000,
    showInitialPrompt: true,
    nounMinLength: 3,
    excludeCommonWords: true,
    
    // Message summarization settings
    enableSummarization: true,
    connectionProfile: '',  // Connection profile for summarization (like qvink)
    completionPreset: '',   // Completion preset for summarization
    prefill: '', // Default prefill for summarization
    autoSummarize: true,    // Automatically summarize every message
    runningMemorySize: 50,  // Number of recent messages to keep visible (rest get hidden/summarized)
    maxContextSize: 100000, // Target max context size to stay under
    summaryThreshold: 1500, // Token threshold to start hiding original messages  
    summaryMaxLength: 150,  // Maximum tokens per summary
    showSummariesInChat: true, // Display summaries in chat like qvink
    hideMessagesWhenThreshold: true, // Hide original messages when threshold is reached
    includeTimeLocation: true,  // Include time and location in summaries
    includeNPCs: true,      // Include present NPCs in summaries
    includeEvents: true,    // Include what occurred in summaries
    includeDialogue: false,  // Include what was said in summaries (disabled by default for optimal memory)
    summaryDelay: 0,        // No delay for immediate processing
    blockChatDuringSummary: false, // Don't block input during summarization
    
    // Persistent storage for summaries (per chat)
    chatSummaries: {},       // { chatId: { messageIndex: summaryData } }
    
    // Core memory system settings
    enableCoreMemories: true,          // Enable core memory detection
    coreMemoryStartCount: 20,          // Start checking for core memories after N messages
    coreMemoryPromptLorebook: true,    // Prompt user to create lorebook entries for core memories
    coreMemoryReplaceMessage: true,    // Replace original message with core memory when aging out
    coreMemoryAnimationDuration: 2000, // Duration of golden animation in ms

    // Vectorization settings for semantic retrieval
    enableVectorization: false, // Enable semantic search of excluded messages  
    vectorizationSource: 'google', // Vectorization source (google=Gemini, openai, cohere, etc.)
    vectorSearchLimit: 3, // Max number of relevant messages to retrieve
    vectorSimilarityThreshold: 0.7, // Minimum similarity score for retrieval
    
    // UI compatibility
    forceCompatibilityMode: false, // Force fallback interface for compatibility
    
    // Embedding model settings
    openaiModel: 'text-embedding-3-small', // OpenAI embedding model
    googleModel: 'text-embedding-004', // Google Gemini embedding model  
    cohereModel: 'embed-english-v3.0', // Cohere embedding model
    ollamaModel: 'mxbai-embed-large', // Ollama embedding model
    vllmModel: '' // vLLM embedding model
};

let isInitialized = false;
let currentChatLorebook = null;
let highlightedNouns = new Set();
let messageObserver = null;
let processedMessages = new WeakSet(); // Track processed messages to prevent duplicates
let currentTooltip = null; // Track the current tooltip element

// Message summarization state
let messageSummaries = new Map(); // Track message summaries by chat index
let summaryProcessingQueue = []; // Queue of messages waiting for summarization
let isProcessingSummaries = false; // Flag to prevent concurrent summarization
let summaryProgressBar = null; // Progress bar element for summarization
// Context injection system replaces visual hiding - messages excluded from AI context but visible to user
let totalChatTokens = 0; // Track total token count for threshold checking

// Vectorization system for excluded messages
let vectorizedMessages = new Map(); // Track vectorized message hashes by index
let isVectorizationEnabled = false; // Flag to enable/disable vectorization

// Common words to exclude from noun detection
const COMMON_WORDS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'had', 'have', 'what', 'were', 'they', 'has', 'his', 'that', 'with', 'this', 'will', 'from', 'said', 'she', 'him', 'been', 'who', 'did', 'get', 'may', 'how', 'use', 'man', 'new', 'now', 'way', 'day', 'two', 'men', 'old', 'see', 'oil', 'sit', 'set', 'run', 'eat', 'far', 'sea', 'eye', 'ago', 'off', 'too', 'any', 'sun', 'why', 'let', 'put', 'end', 'try', 'big', 'ask', 'own', 'say', 'she', 'may', 'use'
]);

// Proper noun patterns - capitalized words that aren't at sentence start
const PROPER_NOUN_PATTERNS = [
    // Compound proper nouns with connecting words (House of Leaves, Tower of London, etc.)
    /\b[A-Z][a-z]+\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+\s+in\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+\s+at\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+\s+on\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+\s+from\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+\s+to\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    /\b[A-Z][a-z]+\s+for\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    
    // Basic proper nouns (names, places)
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    
    // Mixed case words (McCormick, iPhone, etc.)
    /\b[A-Z][a-z]*[A-Z][a-z]*\b/g,
    
    // All caps words (acronyms, organizations)
    /\b[A-Z]{2,}\b/g,
    
    // Place types and establishments (should catch bookstore, restaurant, etc. when capitalized)
    /\b[A-Z][a-z]*(?:store|shop|mart|center|centre|cafe|restaurant|hotel|motel|inn|pub|bar|club|gym|hospital|school|college|university|library|museum|theater|theatre|cinema|park|garden|plaza|mall|market|bank|church|temple|mosque|synagogue)\b/gi,
    
    // Common title patterns (Dr. Smith, Professor X, etc.)
    /\b(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor|Sir|Lady|Lord|Duke|Duchess|King|Queen|Prince|Princess|Captain|Colonel|General|Admiral)\.\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    
    // Organizations and company patterns
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Corp|LLC|Ltd|Company|Industries|Enterprises|Foundation|Institute|Academy|Society)\b/gi,
    
    // Book/media titles (quoted or italicized)
    /"[A-Z][^"]*"/g,
    /'[A-Z][^']*'/g,
    
    // Fantasy/sci-fi names with apostrophes or hyphens
    /\b[A-Z][a-z]*['''-][a-z]+(?:['''-][a-z]+)*\b/g,
    /\b[A-Z][a-z]*-[A-Z]?[a-z]+(?:-[A-Z]?[a-z]+)*\b/g
];

// Notification system
class NotificationSystem {
    static show(message, buttons = [], timeout = 10000) {
        return new Promise((resolve) => {
            const notification = document.createElement('div');
            notification.className = 'nemolore-notification';
            notification.innerHTML = `
                <div class="nemolore-notification-content">
                    <p>${message}</p>
                    <div class="nemolore-notification-buttons">
                        ${buttons.map(btn => `<button class="nemolore-btn" data-action="${btn.action}">${btn.text}</button>`).join('')}
                    </div>
                </div>
            `;

            document.body.appendChild(notification);

            // Auto-remove after timeout
            const timeoutId = setTimeout(() => {
                notification.remove();
                resolve('timeout');
            }, timeout);

            // Handle button clicks
            notification.addEventListener('click', (e) => {
                if (elementMatches(e.target, '[data-action]')) {
                    clearTimeout(timeoutId);
                    const action = e.target.getAttribute('data-action');
                    notification.remove();
                    resolve(action);
                }
            });
        });
    }
}

// Noun detection and highlighting system
class NounDetector {
    static detectNouns(text) {
        const nouns = new Set();
        
        // Clean text of formatting characters first
        const cleanText = this.cleanFormattingText(text);
        console.log(`[${MODULE_NAME}] Original text: ${text.substring(0, 100)}...`);
        console.log(`[${MODULE_NAME}] Cleaned text: ${cleanText.substring(0, 100)}...`);
        
        // Use multiple patterns to catch different types of nouns
        for (const pattern of PROPER_NOUN_PATTERNS) {
            const matches = cleanText.match(pattern) || [];
            for (let match of matches) {
                // Clean up the match
                match = match.trim().replace(/^["']|["']$/g, ''); // Remove quotes
                
                if (this.isValidNoun(match)) {
                    nouns.add(match);
                    console.log(`[${MODULE_NAME}] Found noun: "${match}"`);
                }
            }
        }

        // Additional specialized patterns
        this.detectSpecialPatterns(cleanText, nouns);

        // Get basic filtered nouns first (keep it simple for now)
        const basicFiltered = Array.from(nouns).filter(noun => this.shouldHighlight(noun));
        console.log(`[${MODULE_NAME}] Basic filtered nouns:`, basicFiltered);
        
        // Apply compound filtering
        const finalNouns = this.filterCompoundNouns(basicFiltered);
        console.log(`[${MODULE_NAME}] Final nouns for highlighting:`, finalNouns);
        return finalNouns;
    }

    static cleanFormattingText(text) {
        // Remove common formatting characters but preserve the text content
        return text
            .replace(/\*\*(.*?)\*\*/g, '$1')     // **bold** -> bold  
            .replace(/\*(.*?)\*/g, '$1')         // *italic* -> italic
            .replace(/__(.*?)__/g, '$1')         // __underline__ -> underline
            .replace(/_(.*?)_/g, '$1')           // _italic_ -> italic
            .replace(/~~(.*?)~~/g, '$1')         // ~~strikethrough~~ -> strikethrough
            .replace(/`(.*?)`/g, '$1')           // `code` -> code
            .replace(/\[(.*?)\]\(.*?\)/g, '$1') // [text](link) -> text
            .replace(/#{1,6}\s*/g, '')           // ## headers -> headers
            .trim();
    }

    static detectSpecialPatterns(text, nouns) {
        // Detect common place types that might be lowercase
        const placePatterns = [
            /\b(bookstore|restaurant|cafe|hospital|library|museum|theater|theatre|cinema|park|hotel|motel|inn|pub|bar|club|gym|school|college|university|bank|church|temple|mosque|synagogue|store|shop|mall|market|plaza|garden)\b/gi
        ];
        
        for (const pattern of placePatterns) {
            const matches = text.match(pattern) || [];
            for (let match of matches) {
                match = match.trim();
                if (this.isValidNoun(match)) {
                    // Capitalize for consistency
                    const capitalizedMatch = match.charAt(0).toUpperCase() + match.slice(1).toLowerCase();
                    nouns.add(capitalizedMatch);
                    console.log(`[${MODULE_NAME}] Found place type: "${capitalizedMatch}"`);
                }
            }
        }

        // Detect quoted titles and names
        const quotedPattern = /["']([^"']{3,50})["']/g;
        let quotedMatch;
        while ((quotedMatch = quotedPattern.exec(text)) !== null) {
            const match = quotedMatch.trim();
            if (this.isValidNoun(match) && /^[A-Z]/.test(match)) {
                nouns.add(match);
                console.log(`[${MODULE_NAME}] Found quoted text: "${match}"`);
            }
        }
    }

    static isValidNoun(match) {
        if (!match || match.length < nemoLoreSettings.nounMinLength) return false;
        if (COMMON_WORDS.has(match.toLowerCase())) return false;
        if (this.isCommonEnglishWord(match)) return false;
        if (this.isNumericOrDate(match)) return false;
        return true;
    }

    static shouldHighlight(noun) {
        // Additional filtering for what gets highlighted
        if (noun.length < nemoLoreSettings.nounMinLength) return false;
        if (this.isCommonProperNoun(noun)) return false;
        return true;
    }

    static filterCompoundNouns(nouns) {
        // Remove individual words that are part of longer compound nouns
        // Also remove case duplicates (bookstore vs Bookstore)
        const filtered = [];
        const seenLowercase = new Set();
        
        // Sort by length (longest first) to prioritize compound nouns
        const sorted = nouns.sort((a, b) => b.length - a.length);
        
        for (const noun of sorted) {
            const nounLower = noun.toLowerCase();
            
            // Skip if we've already seen this noun (case-insensitive)
            if (seenLowercase.has(nounLower)) {
                console.log(`[${MODULE_NAME}] Filtering out duplicate "${noun}" (already have case variant)`);
                continue;
            }
            
            // Check if this noun is a subset of any longer noun already in the filtered list
            const isPartOfLongerNoun = filtered.some(longerNoun => {
                return longerNoun !== noun && longerNoun.toLowerCase().includes(nounLower);
            });
            
            if (!isPartOfLongerNoun) {
                filtered.push(noun);
                seenLowercase.add(nounLower);
            } else {
                console.log(`[${MODULE_NAME}] Filtering out "${noun}" as it's part of a longer compound noun`);
            }
        }
        
        return filtered;
    }

    static isNumericOrDate(word) {
        // Filter out years, numbers, dates
        return /^\d+$/.test(word) || 
               /^\d{4}$/.test(word) || 
               /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(word) ||
               /^(January|February|March|April|May|June|July|August|September|October|November|December)$/i.test(word) ||
               /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(word);
    }

    static isCommonProperNoun(word) {
        // Filter out very common proper nouns that aren't interesting
        const commonProper = [
            'English', 'American', 'European', 'Asian', 'African', 'God', 'Jesus', 'Christ', 'Buddha', 'Allah',
            'Internet', 'Google', 'Facebook', 'Twitter', 'YouTube', 'Amazon', 'Apple', 'Microsoft',
            'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
            'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return commonProper.includes(word);
    }

    static isCommonEnglishWord(word) {
        // Basic check for common English words
        const commonPatterns = [
            /^(am|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|can|must)$/i,
            /^(this|that|these|those|here|there|where|when|what|who|why|how)$/i,
            /^(and|or|but|so|yet|for|nor|if|then|else|than|as|like)$/i
        ];
        
        return commonPatterns.some(pattern => pattern.test(word));
    }

    static highlightNouns(element, nouns) {
        if (!nemoLoreSettings.highlightNouns) return;

        // Check if already highlighted to prevent duplicates
        if (element.hasAttribute('data-nemolore-processed')) {
            return;
        }

        let html = element.innerHTML;
        const originalHtml = html;
        let hasHighlights = false;
        
        console.log(`[${MODULE_NAME}] Attempting to highlight nouns:`, nouns);
        console.log(`[${MODULE_NAME}] Original HTML:`, html.substring(0, 200) + '...');
        
        // Sort nouns by length (longest first) to process compound nouns before individual words
        const sortedNouns = [...nouns].sort((a, b) => b.length - a.length);
        
        sortedNouns.forEach(noun => {
            // Simple check - skip if this exact noun is already highlighted
            if (html.includes(`data-noun="${noun}"`)) {
                console.log(`[${MODULE_NAME}] Skipping already highlighted noun: ${noun}`);
                return;
            }
            
            // Create a simple word boundary regex
            const escapedNoun = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b(${escapedNoun})\\b`, 'gi');
            
            let matchCount = 0;
            const newHtml = html.replace(regex, (match) => {
                matchCount++;
                console.log(`[${MODULE_NAME}] Highlighting "${match}" (match ${matchCount})`);
                return `<span class="nemolore-highlighted-noun" 
                           data-noun="${noun}" 
                           role="button" 
                           tabindex="0" 
                           aria-label="Lorebook entry for ${noun}. Press Enter to view, or hold on mobile."
                           title="Click for lorebook info, hold on mobile">${match}</span>`;
            });
            
            if (matchCount > 0) {
                hasHighlights = true;
                html = newHtml;
                console.log(`[${MODULE_NAME}] Successfully highlighted "${noun}" in ${matchCount} places`);
            } else {
                console.log(`[${MODULE_NAME}] No matches found for: "${noun}"`);
            }
        });

        if (hasHighlights) {
            // Validate HTML before setting it
            if (this.isValidHTML(html)) {
                element.innerHTML = html;
                element.setAttribute('data-nemolore-processed', 'true');
                highlightedNouns = new Set([...highlightedNouns, ...nouns]);
            } else {
                console.error(`[${MODULE_NAME}] Generated invalid HTML, reverting to original`);
                element.innerHTML = originalHtml;
                element.setAttribute('data-nemolore-processed', 'true');
            }
        }
    }

    static isValidHTML(html) {
        // Basic validation to check for malformed HTML
        try {
            // Count opening and closing span tags
            const openSpans = (html.match(/<span[^>]*>/g) || []).length;
            const closeSpans = (html.match(/<\/span>/g) || []).length;
            
            // Check for malformed attributes (like unclosed quotes)
            const hasUnclosedQuotes = /data-noun="[^"]*</.test(html);
            const hasNestedSpans = /data-noun="[^"]*<span/.test(html);
            
            if (openSpans !== closeSpans) {
                console.warn(`[${MODULE_NAME}] Mismatched span tags: ${openSpans} open, ${closeSpans} close`);
                return false;
            }
            
            if (hasUnclosedQuotes || hasNestedSpans) {
                console.warn(`[${MODULE_NAME}] Malformed HTML detected`);
                return false;
            }
            
            return true;
        } catch (error) {
            console.error(`[${MODULE_NAME}] HTML validation error:`, error);
            return false;
        }
    }
}

// Lorebook management
class LorebookManager {
    static async createChatLorebook(chatId) {
        const lorebookName = `NemoLore_${chatId}_${Date.now()}`;
        
        try {
            await createNewWorldInfo(lorebookName);
            currentChatLorebook = lorebookName;
            
            // Store lorebook reference in chat metadata using SillyTavern's standard key
            chat_metadata[METADATA_KEY] = lorebookName;
            
            // Also store in our custom metadata for tracking
            if (!chat_metadata.nemolore) {
                chat_metadata.nemolore = {};
            }
            chat_metadata.nemolore.lorebook = lorebookName;
            chat_metadata.nemolore.created_by = MODULE_NAME;
            chat_metadata.nemolore.created_at = Date.now();
            
            await saveMetadata();
            
            console.log(`[${MODULE_NAME}] Created lorebook: ${lorebookName}`);
            return lorebookName;
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error creating lorebook:`, error);
            return null;
        }
    }

    static async generateInitialEntries(characterData, lorebookName) {
        if (!characterData) {
            console.error(`[${MODULE_NAME}] No character data provided`);
            return;
        }

        if (!lorebookName) {
            console.error(`[${MODULE_NAME}] No lorebook name provided`);
            return;
        }

        console.log(`[${MODULE_NAME}] Starting generation for character: ${characterData.name}, lorebook: ${lorebookName}`);
        
        const prompt = this.buildInitialGenerationPrompt(characterData);
        console.log(`[${MODULE_NAME}] Generated prompt length: ${prompt.length} characters`);
        
        try {
            console.log(`[${MODULE_NAME}] Calling generateQuietPrompt...`);
            const response = await generateQuietPrompt(prompt, false);
            console.log(`[${MODULE_NAME}] Received response length: ${response?.length || 0} characters`);
            console.log(`[${MODULE_NAME}] Response preview:`, response?.substring(0, 200) + '...');
            
            const entries = this.parseGenerationResponse(response);
            console.log(`[${MODULE_NAME}] Parsed ${entries.length} entries:`, entries);
            
            if (entries.length === 0) {
                console.warn(`[${MODULE_NAME}] No entries were parsed from the response`);
                await NotificationSystem.show(
                    'No lorebook entries were generated. The AI response may have been in an unexpected format.',
                    [],
                    5000
                );
                return;
            }
            
            await this.addEntriesToLorebook(lorebookName, entries);
            console.log(`[${MODULE_NAME}] Successfully generated ${entries.length} initial entries`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error generating initial entries:`, error);
            await NotificationSystem.show(
                `Error generating lorebook entries: ${error.message}. Check console for details.`,
                [],
                5000
            );
        }
    }

    static buildInitialGenerationPrompt(characterData) {
        return `You are an expert worldbuilding assistant. Based on the following character information, create a comprehensive set of lorebook entries that would enhance roleplay sessions.

Character Information:
Name: ${characterData.name || 'Unknown'}
Description: ${characterData.description || 'No description'}
Personality: ${characterData.personality || 'No personality defined'}
Scenario: ${characterData.scenario || 'No scenario defined'}
First Message: ${characterData.first_mes || 'No first message'}

CREATIVE NAMING GUIDELINES:
- Use fresh, interesting names that avoid AI slop clichés
- FORBIDDEN generic names: Elara, Lyra, Seraphina, Theron, Thorne, Kaelen, Faelan, Finn, Aria, Zara, Kira, Luna, Nova, Sage, Vale
- Draw inspiration from established media characters but create unique variations
- Combine linguistic elements creatively (like "Noah Von Nirgend" or "Alena Kreft")
- Consider cultural/historical naming patterns: Germanic compounds, Slavic endings, Celtic roots
- Use meaningful name components that hint at character traits or origins

QUALITY CHARACTER EXAMPLES FOR INSPIRATION:
- Noah Von Nirgend: Complex psychological character in retrofuture setting with German-inspired name
- Alena Kreft: Princess with social anxiety, detailed world with locations like "Valerian Empire", "Thalassopolis"
- Ani: AI companion with technical precision but emotional depth

Generate 8-12 lorebook entries covering:
1. Important people (friends, family, rivals, mentors) - Give them creative, memorable names following the guidelines above
2. Significant locations (hometown, workplace, hangouts, districts, regions) - Create evocative place names
3. Key items or objects (weapons, heirlooms, technology, artifacts)
4. Important concepts or lore elements (organizations, customs, phenomena)
5. Background events or history (conflicts, discoveries, traditions)

For each entry, provide:
- A clear, evocative title that avoids generic fantasy/sci-fi clichés
- Trigger keywords (3-5 relevant keywords including names)
- A detailed description (2-4 sentences) with rich, specific details

WRITING QUALITY STANDARDS:
- Prioritize specific, concrete details over vague generalities
- Create interconnected elements that reference each other
- Include sensory details and cultural nuances
- Balance familiar concepts with unique twists
- Write with personality and voice, not sterile exposition

Format your response as JSON:
{
  "entries": [
    {
      "title": "Entry Title",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "description": "Detailed description of the entry"
    }
  ]
}

Focus on elements that would naturally come up in conversation and enhance the roleplay experience with memorable, creative names and rich worldbuilding details.`;
    }

    static parseGenerationResponse(response) {
        try {
            // Try to extract JSON from the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch);
                return parsed.entries || [];
            }
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error parsing generation response:`, error);
        }
        return [];
    }

    static generateEntryName(entry) {
        // Use the title if provided
        if (entry.title && entry.title !== 'Entry Title') {
            return entry.title;
        }
        
        // Extract meaningful name from keywords
        if (entry.keywords && entry.keywords.length > 0) {
            // Use the first keyword as it's usually the most relevant
            const primaryKeyword = entry.keywords;
            
            // Capitalize and format nicely
            return primaryKeyword.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
        }
        
        // Extract name from content if keywords aren't helpful
        if (entry.description) {
            // Look for patterns like "X is a..." or "The X..." at the beginning
            const patterns = [
                /^([A-Z][a-z\s]+?)\s+is\s+a/i,
                /^The\s+([A-Z][a-z\s]+?)\s+/i,
                /^([A-Z][a-z\s]+?)\s+was\s+/i,
                /^([A-Z][a-z\s]+?)\s+serves\s+/i,
                /^([A-Z][a-z\s]+?)\s+stands\s+/i
            ];
            
            for (const pattern of patterns) {
                const match = entry.description.match(pattern);
                if (match && match.length < 50) {
                    return match.trim();
                }
            }
            
            // Fallback: use first few words of description
            const firstWords = entry.description.split(' ').slice(0, 3).join(' ');
            if (firstWords.length < 50) {
                return firstWords;
            }
        }
        
        // Final fallback
        return 'Untitled Entry';
    }

    static async addEntriesToLorebook(lorebookName, entries) {
        // Load the lorebook data first
        const lorebookData = await loadWorldInfo(lorebookName);
        if (!lorebookData) {
            console.error(`[${MODULE_NAME}] Could not load lorebook data for: ${lorebookName}`);
            return;
        }

        for (const entry of entries) {
            try {
                // Create the entry using SillyTavern's function
                const newEntry = createWorldInfoEntry(lorebookName, lorebookData);
                
                if (!newEntry) {
                    console.error(`[${MODULE_NAME}] Failed to create world info entry for "${entry.title}"`);
                    continue;
                }

                // Generate a meaningful name for the entry
                const entryName = this.generateEntryName(entry);
                
                // Update the entry with our data
                newEntry.key = entry.keywords || [];
                newEntry.keysecondary = [];
                newEntry.comment = `${entryName} - Generated by ${MODULE_NAME}`;
                newEntry.content = entry.description || '';
                newEntry.constant = false;
                newEntry.selective = true;
                newEntry.selectiveLogic = world_info_logic.AND_ANY;
                newEntry.addMemo = true;
                newEntry.order = 100;
                newEntry.position = world_info_position.before;
                newEntry.disable = false;
                newEntry.excludeRecursion = true;
                newEntry.preventRecursion = true;
                newEntry.probability = 100;
                newEntry.useProbability = false;
                newEntry.depth = DEFAULT_DEPTH;
                newEntry.group = '';
                newEntry.groupOverride = false;
                newEntry.groupWeight = DEFAULT_WEIGHT;
                newEntry.scanDepth = null;
                newEntry.caseSensitive = null;
                newEntry.matchWholeWords = null;
                newEntry.useGroupScoring = null;
                newEntry.automationId = '';
                newEntry.role = extension_prompt_roles.SYSTEM;
                newEntry.sticky = null;
                newEntry.cooldown = null;
                newEntry.delay = null;
                newEntry.delayUntilRecursion = false;
                newEntry.title = entry.title || '';

                console.log(`[${MODULE_NAME}] Created initial entry "${entry.title}" with UID: ${newEntry.uid}`);
            } catch (error) {
                console.error(`[${MODULE_NAME}] Error adding entry "${entry.title}":`, error);
            }
        }
        
        // Save the updated lorebook
        await saveWorldInfo(lorebookName, lorebookData);
        await updateWorldInfoList();
    }

    static async findEntryForNoun(noun) {
        if (!currentChatLorebook) return null;
        
        try {
            const worldInfo = await loadWorldInfo(currentChatLorebook);
            if (!worldInfo || !worldInfo.entries) return null;
            
            console.log(`[${MODULE_NAME}] Searching for noun "${noun}" in lorebook entries:`, Object.keys(worldInfo.entries));
            
            // worldInfo.entries is an object with integer keys, not an array
            const candidates = [];
            
            for (const [uid, entry] of Object.entries(worldInfo.entries)) {
                if (!entry || !entry.key) continue;
                
                console.log(`[${MODULE_NAME}] Checking entry ${uid} with keys:`, entry.key, "title:", entry.title);
                
                const nounLower = noun.toLowerCase();
                let matchScore = 0;
                let matchType = '';
                
                // Check for exact keyword match (highest priority)
                const exactKeywordMatch = entry.key.some(keyword => keyword.toLowerCase() === nounLower);
                if (exactKeywordMatch) {
                    matchScore = 100;
                    matchType = 'exact_keyword';
                }
                
                // Check for exact title match (high priority)
                else if (entry.title && entry.title.toLowerCase() === nounLower) {
                    matchScore = 90;
                    matchType = 'exact_title';
                }
                
                // Check if noun is the primary keyword (first in list)
                else if (entry.key.length > 0 && entry.key[0].toLowerCase() === nounLower) {
                    matchScore = 80;
                    matchType = 'primary_keyword';
                }
                
                // Check for partial keyword match (lower priority)
                else if (entry.key.some(keyword => keyword.toLowerCase().includes(nounLower))) {
                    matchScore = 30;
                    matchType = 'partial_keyword';
                }
                
                // Check for partial title match (lowest priority)
                else if (entry.title && entry.title.toLowerCase().includes(nounLower)) {
                    matchScore = 20;
                    matchType = 'partial_title';
                }
                
                if (matchScore > 0) {
                    candidates.push({
                        uid,
                        entry,
                        matchScore,
                        matchType
                    });
                    console.log(`[${MODULE_NAME}] Found candidate "${entry.title || 'Untitled'}" with score ${matchScore} (${matchType})`);
                }
            }
            
            // Sort by match score (highest first) and return data with match info
            if (candidates.length > 0) {
                candidates.sort((a, b) => b.matchScore - a.matchScore);
                const bestMatch = candidates[0];
                console.log(`[${MODULE_NAME}] Best match for "${noun}": "${bestMatch.entry.title || 'Untitled'}" (score: ${bestMatch.matchScore}, type: ${bestMatch.matchType})`);
                
                // Return both the entry and match metadata for tooltip system
                return {
                    entry: bestMatch.entry,
                    matchScore: bestMatch.matchScore,
                    matchType: bestMatch.matchType,
                    allCandidates: candidates
                };
            }
            
            console.log(`[${MODULE_NAME}] No entry found for noun "${noun}"`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error finding entry for noun "${noun}":`, error);
        }
        
        return null;
    }
}

// Tooltip management
class TooltipManager {
    static truncateText(text, maxSentences = 2) {
        if (!text) return '';
        
        // Split by sentence-ending punctuation
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        
        if (sentences.length <= maxSentences) {
            return text.trim();
        }
        
        // Take first few sentences and add back the punctuation
        const truncated = sentences.slice(0, maxSentences).join('. ').trim();
        return truncated + (truncated.endsWith('.') ? '...' : '...');
    }

    static async showTooltip(element, noun, isMobile = false) {
        // Remove any existing tooltip
        this.hideTooltip();

        const rect = element.getBoundingClientRect();
        const tooltip = document.createElement('div');
        tooltip.className = 'nemolore-tooltip';
        if (isMobile) {
            tooltip.classList.add('mobile-active');
        }
        
        // Try to find existing entry (now returns match metadata)
        const matchData = await LorebookManager.findEntryForNoun(noun);
        
        if (matchData) {
            const { entry, matchScore, matchType, allCandidates } = matchData;
            
            // Threshold for exact vs partial match (scores 80+ are considered exact)
            const isExactMatch = matchScore >= 80;
            
            if (isExactMatch) {
                // Show full entry content for exact matches
                const truncatedContent = this.truncateText(entry.content, 2);
                tooltip.innerHTML = `
                    <div class="nemolore-tooltip-title">${entry.title || noun}</div>
                    <div class="nemolore-tooltip-content">${truncatedContent || 'No description available.'}</div>
                `;
            } else {
                // Show linked/related entry info for partial matches
                const relatedEntries = allCandidates.slice(0, 3).map(c => c.entry.title || 'Untitled').join(', ');
                tooltip.innerHTML = `
                    <div class="nemolore-tooltip-title">${noun}</div>
                    <div class="nemolore-tooltip-related">Related: ${entry.title || 'Untitled'}</div>
                    <div class="nemolore-tooltip-create">Click to create dedicated entry</div>
                `;
                tooltip.classList.add('nemolore-tooltip-partial');
            }
            
            // Store match data on tooltip for click handling
            tooltip._nemoLoreMatchData = matchData;
        } else {
            // No matches found
            tooltip.innerHTML = `
                <div class="nemolore-tooltip-title">${noun}</div>
                <div class="nemolore-tooltip-no-entry">Click to create entry</div>
            `;
        }

        // Position tooltip with mobile-friendly positioning
        this.positionTooltip(tooltip, element, rect);
        
        document.body.appendChild(tooltip);
        currentTooltip = tooltip;
        
        // Add improved hover detection for desktop
        if (!isMobile) {
            this.setupDesktopHoverDetection(tooltip, element);
        }

        // Show tooltip with animation
        setTimeout(() => {
            tooltip.classList.add('show');
        }, 10);
    }

    static positionTooltip(tooltip, element, rect) {
        const tooltipWidth = 250; // Updated width for mobile
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        // Mobile-friendly positioning
        if (viewportWidth <= 768) {
            // Mobile: center tooltip at bottom of screen
            tooltip.style.left = '10px';
            tooltip.style.right = '10px';
            tooltip.style.width = 'calc(100vw - 20px)';
            tooltip.style.bottom = '20px';
            tooltip.style.top = 'auto';
            tooltip.style.position = 'fixed';
            return;
        }
        
        // Desktop positioning
        let left = rect.left + scrollLeft + (rect.width / 2) - (tooltipWidth / 2);
        let top = rect.top + scrollTop;
        
        // Keep tooltip in viewport horizontally
        if (left < 10) left = 10;
        if (left + tooltipWidth > viewportWidth - 10) left = viewportWidth - tooltipWidth - 10;
        
        // Position above or below based on space
        const spaceAbove = rect.top;
        const spaceBelow = viewportHeight - rect.bottom;
        
        if (spaceAbove > 100 && spaceAbove > spaceBelow) {
            // Position above
            tooltip.style.top = (top - 60) + 'px';
            tooltip.classList.add('above');
        } else {
            // Position below
            tooltip.style.top = (top + rect.height + 10) + 'px';
            tooltip.classList.add('below');
        }
        
        tooltip.style.left = left + 'px';
        tooltip.style.position = 'absolute';
    }
    
    static setupDesktopHoverDetection(tooltip, element) {
        let hoverTimeout;
        
        const showTooltip = () => {
            clearTimeout(hoverTimeout);
            if (currentTooltip) {
                currentTooltip.classList.add('show');
            }
        };
        
        const hideTooltipDelayed = () => {
            hoverTimeout = setTimeout(() => {
                this.hideTooltip();
            }, 150); // Short delay before hiding
        };
        
        // Keep tooltip visible when hovering over it
        tooltip.addEventListener('mouseenter', showTooltip);
        tooltip.addEventListener('mouseleave', hideTooltipDelayed);
        
        // Keep tooltip visible when hovering over original element
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltipDelayed);
    }

    static hideTooltip() {
        if (currentTooltip) {
            currentTooltip.classList.remove('show');
            setTimeout(() => {
                if (currentTooltip && currentTooltip.parentNode) {
                    currentTooltip.parentNode.removeChild(currentTooltip);
                }
                currentTooltip = null;
            }, 200); // Match CSS transition duration
        }
    }
}

// Message Summarization System
class MessageSummarizer {
    // Static property to cache connection profiles detection
    static connection_profiles_active;
    
    // Connection profile management (exact copy from MessageSummarize)
    static async setConnectionProfile(profileName) {
        if (!profileName || !this.checkConnectionProfilesActive()) return;
        
        // Check if getContext is available (it's a global function)
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] getContext not available, cannot switch connection profile`);
            return;
        }
        
        const context = getContext();
        if (!context || !context.executeSlashCommandsWithOptions) {
            console.warn(`[${MODULE_NAME}] Invalid context, cannot switch connection profile`);
            return;
        }
        
        try {
            await context.executeSlashCommandsWithOptions(`/profile ${profileName}`);
            console.log(`[${MODULE_NAME}] Switched to connection profile: ${profileName}`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to switch connection profile:`, error);
        }
    }
    
    static async setCompletionPreset(presetName) {
        if (!presetName) return;
        
        try {
            const context = getContext();
            await context.executeSlashCommandsWithOptions(`/preset ${presetName}`);
            console.log(`[${MODULE_NAME}] Switched to completion preset: ${presetName}`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to switch completion preset:`, error);
        }
    }
    
    // Connection profiles detection - EXACT copy from MessageSummarize
    static checkConnectionProfilesActive() {
        if (this.connection_profiles_active === undefined) {
            this.connection_profiles_active = $('#sys-settings-button').find('#connection_profiles').length > 0;
        }
        return this.connection_profiles_active;
    }

    // Get connection profiles - EXACT copy from MessageSummarize
    static async getConnectionProfiles() {
        if (!this.checkConnectionProfilesActive()) return; // if the extension isn't active, return
        
        let ctx = getContext();
        let result = await ctx.executeSlashCommandsWithOptions('/profile-list');
        try {
            return JSON.parse(result.pipe);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to parse JSON from /profile-list. Result:`, result);
            console.error(error);
            return [];
        }
    }

    // Get completion presets - EXACT copy from MessageSummarize  
    static async getCompletionPresets() {
        try {
            // Get the list of available completion presets for the selected connection profile API
            let summaryApi = main_api; // Use current API (we could extend this later with connection profile API)
            console.log(`[${MODULE_NAME}] Getting presets for API:`, summaryApi);
            
            let { presets, preset_names } = getPresetManager().getPresetList(summaryApi);
            console.log(`[${MODULE_NAME}] getPresetManager returned:`, { presets: presets ? Object.keys(presets) : null, preset_names });
            
            // Array of names
            if (Array.isArray(preset_names)) {
                console.log(`[${MODULE_NAME}] Returning array of preset names:`, preset_names);
                return preset_names;
            }
            // Object of {names: index}
            const keys = Object.keys(preset_names);
            console.log(`[${MODULE_NAME}] Returning object keys:`, keys);
            return keys;
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error getting completion presets:`, error);
            return [];
        }
    }
    static buildSummarizationPrompt(messageData) {
        const { message, chatContext, timeContext, locationContext, npcContext } = messageData;
        
        let prompt = `You are an expert narrative summarizer. Create a concise summary of this roleplay message that captures the essential information for future reference.

SUMMARIZATION REQUIREMENTS:
- Maximum ${nemoLoreSettings.summaryMaxLength} tokens
- Past tense, factual tone
- Include key details that would be important for understanding future context
- Focus on actions, events, and meaningful dialogue`;

        // Add core memory instructions only if enabled and we're past the start count
        if (nemoLoreSettings.enableCoreMemories) {
            const context = getContext();
            const currentMessageCount = context?.chat?.length || 0;
            
            if (currentMessageCount >= nemoLoreSettings.coreMemoryStartCount) {
                prompt += `

CORE MEMORY DETECTION:
If this message represents a truly significant narrative moment (major character development, important plot reveals, relationship changes, dramatic events, or story-defining moments), mark it as a CORE MEMORY by wrapping your entire summary in <CORE_MEMORY> tags.

Examples of core memories:
- Character deaths or major injuries
- Romantic confessions or breakups
- Major plot revelations or secrets revealed
- Character growth moments or realizations
- Significant world-changing events
- Important promises or vows made

Only mark as CORE_MEMORY if the moment is genuinely pivotal to the story.`;
            }
        }

        if (nemoLoreSettings.includeTimeLocation && (timeContext || locationContext)) {
            prompt += `\n\nCONTEXT:`;
            if (timeContext) prompt += `\nTime: ${timeContext}`;
            if (locationContext) prompt += `\nLocation: ${locationContext}`;
        }

        if (nemoLoreSettings.includeNPCs && npcContext && npcContext.length > 0) {
            prompt += `\nPresent Characters/NPCs: ${npcContext.join(', ')}`;
        }

        prompt += `\n\nMESSAGE TO SUMMARIZE:
${message.mes}

SUMMARY FOCUS:`;
        if (nemoLoreSettings.includeEvents) prompt += `\n- What happened/occurred`;
        if (nemoLoreSettings.includeDialogue) prompt += `\n- Important dialogue or conversations`;
        
        prompt += `\n\nProvide only the summary, no additional commentary:`;

        return prompt;
    }

    static async extractContextFromChat(messageIndex) {
        // Check if getContext is available (it's a global function)
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] getContext not available, cannot extract context`);
            return { timeContext: null, locationContext: null, npcContext: [] };
        }
        
        const context = getContext();
        if (!context || !context.chat || !context.chat[messageIndex]) {
            console.warn(`[${MODULE_NAME}] Invalid context or message, cannot extract context`);
            return { timeContext: null, locationContext: null, npcContext: [] };
        }
        
        const currentMessage = context.chat[messageIndex];
        
        let timeContext = null;
        let locationContext = null;
        let npcContext = [];

        try {
            // Extract time context (look for time-related patterns in recent messages)
            for (let i = Math.max(0, messageIndex - 5); i <= messageIndex; i++) {
                const msg = context.chat[i];
                if (!msg) continue;
                
                // Look for time patterns
                const timePatterns = [
                    /\b(morning|afternoon|evening|night|midnight|dawn|dusk)\b/i,
                    /\b\d{1,2}:\d{2}\s?(am|pm|AM|PM)\b/,
                    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
                ];
                
                for (const pattern of timePatterns) {
                    const match = msg.mes.match(pattern);
                    if (match) {
                        timeContext = match;
                        break;
                    }
                }
            }

            // Extract location context from lorebook entries and message content
            if (currentChatLorebook) {
                const worldInfo = await loadWorldInfo(currentChatLorebook);
                if (worldInfo && worldInfo.entries) {
                    for (const [uid, entry] of Object.entries(worldInfo.entries)) {
                        if (!entry || !entry.key) continue;
                        
                        // Check if this entry represents a location
                        const isLocation = entry.key.some(keyword => 
                            /\b(house|building|room|street|city|town|park|restaurant|cafe|store|office|school|hospital)\b/i.test(keyword) ||
                            entry.content.toLowerCase().includes('location') ||
                            entry.content.toLowerCase().includes('place')
                        );
                        
                        if (isLocation) {
                            // Check if location is mentioned in current message
                            const mentionedInMessage = entry.key.some(keyword =>
                                currentMessage.mes.toLowerCase().includes(keyword.toLowerCase())
                            );
                            
                            if (mentionedInMessage) {
                                locationContext = entry.title || (entry.key && entry.key[0]);
                                break;
                            }
                        }
                    }
                }
            }

            // Extract NPCs from highlighted nouns and lorebook
            const detectedNouns = NounDetector.detectNouns(currentMessage.mes);
            for (const noun of detectedNouns) {
                const matchData = await LorebookManager.findEntryForNoun(noun);
                if (matchData && matchData.entry) {
                    const entry = matchData.entry;
                    // Check if this entry represents a character/NPC
                    const isCharacter = entry.content && (
                        entry.content.toLowerCase().includes('character') ||
                        entry.content.toLowerCase().includes('person') ||
                        entry.content.toLowerCase().includes('he ') ||
                        entry.content.toLowerCase().includes('she ') ||
                        entry.content.toLowerCase().includes(' is a ') ||
                        entry.key.some(k => /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(k)) // Full names
                    );
                    
                    if (isCharacter && !npcContext.includes(noun)) {
                        npcContext.push(noun);
                    }
                }
            }

        } catch (error) {
            console.warn(`[${MODULE_NAME}] Error extracting context:`, error);
        }

        return {
            timeContext,
            locationContext, 
            npcContext
        };
    }

    static async summarizeMessage(messageIndex) {
        if (!nemoLoreSettings.enableSummarization) return null;
        
        // Check if getContext is available (it's a global function)
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] getContext not available, cannot summarize message`);
            return null;
        }
        
        const context = getContext();
        if (!context || !context.chat) {
            console.warn(`[${MODULE_NAME}] Invalid context, cannot summarize message`);
            return null;
        }
        
        const message = context.chat[messageIndex];
        
        if (!message || !message.mes) return null;

        try {
            console.log(`[${MODULE_NAME}] Summarizing message ${messageIndex}: "${message.mes.substring(0, 50)}..."`);
            
            // Extract contextual information
            const contextData = await this.extractContextFromChat(messageIndex);
            
            // Build the summarization prompt
            const messageData = {
                message,
                chatContext: context.chat.slice(Math.max(0, messageIndex - 3), messageIndex), // Previous 3 messages for context
                ...contextData
            };
            
            const prompt = this.buildSummarizationPrompt(messageData);
            
            // Generate summary using specified connection profile and preset
            const originalConnectionProfile = main_api;
            const originalPreset = extension_settings.preset;
            
            let response = null;
            
            try {
                // Switch to summarization connection profile if specified
                if (nemoLoreSettings.connectionProfile) {
                    await this.setConnectionProfile(nemoLoreSettings.connectionProfile);
                }
                
                // Switch to summarization completion preset if specified  
                if (nemoLoreSettings.completionPreset) {
                    await this.setCompletionPreset(nemoLoreSettings.completionPreset);
                }
                
                // Generate the summary - try generateQuietPrompt first as it may be more reliable
                const fullPrompt = prompt + (nemoLoreSettings.prefill ? '\n\n' + nemoLoreSettings.prefill : '');
                
                console.log(`[${MODULE_NAME}] Sending summarization request for message ${messageIndex}`);
                console.log(`[${MODULE_NAME}] Prompt: ${fullPrompt}`);
                
                // Try generateQuietPrompt first
                try {
                    console.log(`[${MODULE_NAME}] Calling generateQuietPrompt with prompt length: ${fullPrompt.length}`);
                    response = await generateQuietPrompt(fullPrompt, false);
                    console.log(`[${MODULE_NAME}] generateQuietPrompt succeeded, response length: ${response?.length || 0}`);
                } catch (quietError) {
                    console.log(`[${MODULE_NAME}] generateQuietPrompt failed, trying generateRaw:`, quietError);
                    try {
                        response = await generateRaw(fullPrompt, '', true, false, false, null, false);
                        console.log(`[${MODULE_NAME}] generateRaw succeeded, response length: ${response?.length || 0}`);
                    } catch (rawError) {
                        console.error(`[${MODULE_NAME}] Both generateQuietPrompt and generateRaw failed:`, rawError);
                        throw rawError;
                    }
                }
                
            } finally {
                // Always restore original settings - only if we actually changed them
                try {
                    // Connection profiles might not support empty reset, so skip reset for now
                    // The user's current profile will remain active after summarization
                    
                    // Reset completion preset to original
                    if (nemoLoreSettings.completionPreset && originalPreset) {
                        await this.setCompletionPreset(originalPreset);
                    }
                } catch (resetError) {
                    console.warn(`[${MODULE_NAME}] Error resetting settings:`, resetError);
                }
            }
            
            if (response && response.trim()) {
                const rawSummary = response.trim();
                console.log(`[${MODULE_NAME}] Generated summary: "${rawSummary.substring(0, 100)}..."`);
                
                // Check for core memory tag
                const isCoreMemory = this.detectCoreMemory(rawSummary);
                const cleanSummary = this.extractCleanSummary(rawSummary);
                
                // Store summary with core memory flag
                const summaryData = {
                    text: cleanSummary,
                    originalLength: message.mes.length,
                    timestamp: Date.now(),
                    messageHash: getStringHash(message.mes),
                    context: contextData,
                    isCoreMemory: isCoreMemory,
                    rawResponse: rawSummary // Keep original response for debugging
                };
                
                messageSummaries.set(messageIndex, summaryData);
                
                // Save summary to persistent storage
                this.saveSummaryToPersistentStorage(messageIndex, summaryData);
                
                // Add visual indicator to the message (different for core memories)
                this.addSummaryIndicator(messageIndex, isCoreMemory);
                
                // Handle core memory special processing
                if (isCoreMemory) {
                    console.log(`[${MODULE_NAME}] 🌟 CORE MEMORY DETECTED for message ${messageIndex}!`);
                    this.handleCoreMemoryDetected(messageIndex, summaryData);
                }
                
                return cleanSummary;
            } else {
                console.log(`[${MODULE_NAME}] No valid response from API for message ${messageIndex}`);
                return null;
            }
            
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error summarizing message ${messageIndex}:`, error);
            return null;
        }
    }

    // Core Memory Detection System
    static detectCoreMemory(summaryText) {
        // Check for the <CORE_MEMORY> tag
        return /<CORE_MEMORY\b[^>]*>|<\/CORE_MEMORY>/i.test(summaryText);
    }

    static extractCleanSummary(summaryText) {
        // Remove <CORE_MEMORY> tags but keep the content
        return summaryText
            .replace(/<CORE_MEMORY\b[^>]*>/gi, '')
            .replace(/<\/CORE_MEMORY>/gi, '')
            .trim();
    }

    static async handleCoreMemoryDetected(messageIndex, summaryData) {
        // Add core memory animation and special handling
        await this.playCoreMemoryAnimation(messageIndex);
        
        // If enabled, automatically add to core memory lorebook entry
        if (nemoLoreSettings.coreMemoryPromptLorebook) {
            setTimeout(() => {
                this.promptCoreMemoryLorebook(messageIndex, summaryData);
            }, 2500); // After animation completes
        }
        
        // Log the core memory achievement
        console.log(`[${MODULE_NAME}] 🌟 Core Memory Unlocked: "${summaryData.text.substring(0, 50)}..."`);
    }

    static async playCoreMemoryAnimation(messageIndex) {
        const messageElement = document.querySelector(`[data-message-index="${messageIndex}"]`) || 
                              document.querySelector(`.mes:nth-child(${messageIndex + 1})`);
        
        if (!messageElement) return;

        const indicator = messageElement.querySelector('.nemolore-summary-indicator');
        if (!indicator) return;

        // Add golden core memory animation
        indicator.classList.add('nemolore-core-memory');
        
        // Play sparkle animation
        this.createSparkleEffect(indicator);
        
        // Change badge to golden
        const badge = indicator.querySelector('.nemolore-summary-badge');
        if (badge) {
            badge.innerHTML = '✨ Core Memory';
            badge.style.background = 'linear-gradient(45deg, #ffd700, #ffed4e)';
            badge.style.color = '#8b4513';
            badge.style.boxShadow = '0 0 10px rgba(255, 215, 0, 0.6)';
            badge.style.animation = 'nemolore-golden-pulse 2s infinite';
        }

        // Play notification sound (if available)
        this.playNotificationSound('core-memory');
    }

    static createSparkleEffect(element) {
        const sparkleContainer = document.createElement('div');
        sparkleContainer.className = 'nemolore-sparkle-container';
        sparkleContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            overflow: hidden;
        `;

        // Create multiple sparkle particles
        for (let i = 0; i < 8; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'nemolore-sparkle';
            sparkle.innerHTML = '✨';
            sparkle.style.cssText = `
                position: absolute;
                font-size: 12px;
                color: #ffd700;
                animation: nemolore-sparkle-float 2s ease-out forwards;
                animation-delay: ${i * 0.25}s;
                left: ${50 + (Math.random() - 0.5) * 40}%;
                top: ${50 + (Math.random() - 0.5) * 40}%;
            `;
            sparkleContainer.appendChild(sparkle);
        }

        element.style.position = 'relative';
        element.appendChild(sparkleContainer);

        // Remove sparkles after animation
        setTimeout(() => {
            if (sparkleContainer.parentNode) {
                sparkleContainer.parentNode.removeChild(sparkleContainer);
            }
        }, 3000);
    }

    static playNotificationSound(type) {
        // Play a celebratory sound for core memory unlock
        if (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined') {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                if (type === 'core-memory') {
                    // Play a magical ascending chime sequence
                    const frequencies = [523, 659, 784, 1047]; // C5, E5, G5, C6
                    frequencies.forEach((freq, index) => {
                        setTimeout(() => {
                            const oscillator = audioContext.createOscillator();
                            const gainNode = audioContext.createGain();
                            
                            oscillator.connect(gainNode);
                            gainNode.connect(audioContext.destination);
                            
                            oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
                            oscillator.type = 'sine';
                            
                            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
                            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                            
                            oscillator.start();
                            oscillator.stop(audioContext.currentTime + 0.3);
                        }, index * 150);
                    });
                }
            } catch (error) {
                console.log(`[${MODULE_NAME}] Audio not available:`, error);
            }
        }
    }

    static async promptCoreMemoryLorebook(messageIndex, summaryData) {
        try {
            // Get the original message
            const context = getContext();
            const originalMessage = context.chat[messageIndex];
            
            // Find or create the Core Memory lorebook entry
            await this.addToCoreMemoryEntry(summaryData, originalMessage, messageIndex);
            
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to update Core Memory lorebook entry:`, error);
            toastr.warning('Failed to update Core Memory lorebook entry automatically.');
        }
    }

    static async addToCoreMemoryEntry(summaryData, originalMessage, messageIndex) {
        const CORE_MEMORY_ENTRY_NAME = 'Core Memories';
        const CORE_MEMORY_KEY = 'core_memories';
        
        try {
            // Check if lorebook creation is enabled
            if (!nemoLoreSettings.createLorebookOnChat) {
                console.log(`[${MODULE_NAME}] Lorebook creation disabled, skipping core memory entry`);
                return;
            }
            
            // Look for existing Core Memory entry
            let coreMemoryEntry = this.findCoreMemoryEntry();
            
            if (!coreMemoryEntry) {
                // Create the initial Core Memory entry
                coreMemoryEntry = await this.createInitialCoreMemoryEntry();
                console.log(`[${MODULE_NAME}] Created initial Core Memory lorebook entry`);
                toastr.info(`📚 Created Core Memories lorebook entry`);
            }
            
            // Add this core memory to the entry
            await this.appendToCoreMemoryEntry(coreMemoryEntry, summaryData, originalMessage, messageIndex);
            
            toastr.success(`🌟 Core memory added to lorebook!`);
            console.log(`[${MODULE_NAME}] Added core memory to lorebook: "${summaryData.text.substring(0, 50)}..."`);
            
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to update Core Memory entry:`, error);
            throw error;
        }
    }

    static findCoreMemoryEntry() {
        // Search for existing Core Memory entry in current world info
        const worldInfo = world_names.get(characters[this_chid]?.data?.world) || {};
        if (!worldInfo.entries) return null;
        
        // Look for entry with the Core Memory comment/title
        for (const [uid, entry] of Object.entries(worldInfo.entries)) {
            if (entry.comment === 'Core Memories' || 
                entry.key.includes('core_memories') ||
                entry.content.includes('## Core Memories')) {
                return { uid, ...entry };
            }
        }
        
        return null;
    }

    static async createInitialCoreMemoryEntry() {
        const initialContent = `## Core Memories
*Significant moments and pivotal events from our story*

---

`;

        const newEntry = createWorldInfoEntry({
            comment: 'Core Memories',
            content: initialContent,
            key: ['core_memories', 'important_moments', 'pivotal_events'],
            keysecondary: ['memories', 'story_moments', 'narrative'],
            selective: false,
            constant: true, // Always active
            vectorized: true, // Enable for better retrieval
            order: 100, // High priority
            position: world_info_position.before,
            disable: false,
            addMemo: true,
            excludeRecursion: false,
            delayUntilRecursion: false,
            displayIndex: 0,
            probability: 100,
            useProbability: false,
            depth: DEFAULT_DEPTH,
            selectiveLogic: 0,
            group: 'Story',
            groupOverride: false,
            groupWeight: DEFAULT_WEIGHT,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: 0,
            sticky: null,
            cooldown: null,
            delay: null
        });

        // Save the world info
        await saveWorldInfo();
        
        return newEntry;
    }

    static async appendToCoreMemoryEntry(coreMemoryEntry, summaryData, originalMessage, messageIndex) {
        const timestamp = new Date(summaryData.timestamp).toLocaleString();
        const speaker = originalMessage.name || (originalMessage.is_user ? 'User' : 'Assistant');
        
        // Create formatted core memory entry
        const newMemoryEntry = `**${timestamp}** *(Message ${messageIndex})* - ${speaker}:
${summaryData.text}

`;

        // Append to existing content (before the last ---)
        let updatedContent = coreMemoryEntry.content;
        
        // If there's a trailing --- section, insert before it
        if (updatedContent.includes('---\n')) {
            const parts = updatedContent.split('---\n');
            if (parts.length >= 2) {
                // Insert before the last --- section
                updatedContent = parts[0] + newMemoryEntry + '---\n' + parts.slice(1).join('---\n');
            } else {
                // Just append
                updatedContent += newMemoryEntry;
            }
        } else {
            // No --- section, just append
            updatedContent += newMemoryEntry;
        }
        
        // Update the entry content
        coreMemoryEntry.content = updatedContent;
        
        // Save the updated world info
        await saveWorldInfo();
        
        console.log(`[${MODULE_NAME}] Appended core memory to lorebook entry`);
    }

    static async processSummaryQueue() {
        console.log(`[${MODULE_NAME}] processSummaryQueue called, isProcessingSummaries: ${isProcessingSummaries}, queue length: ${summaryProcessingQueue.length}`);
        
        if (isProcessingSummaries || summaryProcessingQueue.length === 0) {
            console.log(`[${MODULE_NAME}] Skipping processing: already processing or empty queue`);
            return;
        }
        
        isProcessingSummaries = true;
        
        try {
            console.log(`[${MODULE_NAME}] Processing ${summaryProcessingQueue.length} messages for summarization`);
            console.log(`[${MODULE_NAME}] Queue contents:`, summaryProcessingQueue);
            
            // Show progress bar if enabled
            if (nemoLoreSettings.showSummariesInChat) {
                console.log(`[${MODULE_NAME}] Showing progress bar`);
                this.showProgressBar(summaryProcessingQueue.length);
            } else {
                console.log(`[${MODULE_NAME}] Progress bar disabled in settings`);
            }
            
            let processed = 0;
            while (summaryProcessingQueue.length > 0) {
                const messageIndex = summaryProcessingQueue.shift();
                console.log(`[${MODULE_NAME}] Processing message ${messageIndex}, ${summaryProcessingQueue.length} remaining`);
                
                try {
                    const result = await this.summarizeMessage(messageIndex);
                    console.log(`[${MODULE_NAME}] Summarization result for message ${messageIndex}:`, result ? 'Success' : 'Failed');
                    processed++;
                } catch (error) {
                    console.error(`[${MODULE_NAME}] Error processing message ${messageIndex}:`, error);
                    processed++; // Still increment to avoid infinite loop
                }
                
                // Update progress bar
                if (summaryProgressBar) {
                    this.updateProgressBar(processed, processed + summaryProcessingQueue.length);
                }
                
                // Small delay to prevent overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Hide progress bar
            this.hideProgressBar();
            
            // Refresh chat display to show summaries
            if (nemoLoreSettings.showSummariesInChat) {
                this.refreshSummaryDisplay();
            }
            
            // Update enhanced memory injection for context
            this.enhancedMemoryInjection();
            console.log(`[${MODULE_NAME}] Finished processing ${processed} messages`);
            
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error in processSummaryQueue:`, error);
        } finally {
            console.log(`[${MODULE_NAME}] Setting isProcessingSummaries to false`);
            isProcessingSummaries = false;
        }
    }

    static showProgressBar(total) {
        // Remove existing progress bar
        this.hideProgressBar();
        
        summaryProgressBar = document.createElement('div');
        summaryProgressBar.className = 'nemolore-summary-progress';
        summaryProgressBar.innerHTML = `
            <div class="nemolore-progress-bar">
                <div class="nemolore-progress-fill" style="width: 0%"></div>
            </div>
            <div class="nemolore-progress-text">Summarizing messages... 0/${total}</div>
        `;
        
        document.body.appendChild(summaryProgressBar);
    }

    static updateProgressBar(current, total) {
        if (!summaryProgressBar) return;
        
        const percentage = Math.round((current / total) * 100);
        const fill = summaryProgressBar.querySelector('.nemolore-progress-fill');
        const text = summaryProgressBar.querySelector('.nemolore-progress-text');
        
        if (fill) fill.style.width = percentage + '%';
        if (text) text.textContent = `Summarizing messages... ${current}/${total}`;
    }

    static hideProgressBar() {
        if (summaryProgressBar && summaryProgressBar.parentNode) {
            summaryProgressBar.parentNode.removeChild(summaryProgressBar);
            summaryProgressBar = null;
        }
    }

    static refreshSummaryDisplay() {
        // Add summary displays to messages that have them
        const chatContainer = document.getElementById('chat');
        if (!chatContainer) return;
        
        const messages = chatContainer.querySelectorAll('.mes');
        messages.forEach((msgElement, index) => {
            if (messageSummaries.has(index)) {
                this.displaySummaryForMessage(msgElement, index);
            }
        });
    }

    static displaySummaryForMessage(messageElement, messageIndex) {
        // Remove existing summary display
        const existingSummary = messageElement.querySelector('.nemolore-message-summary');
        if (existingSummary) {
            existingSummary.remove();
        }
        
        const summaryData = messageSummaries.get(messageIndex);
        if (!summaryData) return;
        
        // Only display summaries for messages beyond the running memory window
        const context = getContext();
        const currentChatLength = context.chat.length;
        const runningMemorySize = nemoLoreSettings.runningMemorySize || 50;
        const isWithinRunningMemory = messageIndex >= (currentChatLength - runningMemorySize);
        
        if (isWithinRunningMemory) {
            // Message is within running memory - don't display summary even though we have one
            console.log(`[${MODULE_NAME}] Not displaying summary for message ${messageIndex} (within running memory)`);
            return;
        }
        
        console.log(`[${MODULE_NAME}] Displaying summary for message ${messageIndex} (beyond running memory)`);
        
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'nemolore-message-summary';
        summaryDiv.innerHTML = `
            <div class="nemolore-summary-text">${summaryData.summary}</div>
            <div class="nemolore-summary-meta">
                ${summaryData.context.timeContext ? `⏰ ${summaryData.context.timeContext}` : ''}
                ${summaryData.context.locationContext ? `📍 ${summaryData.context.locationContext}` : ''}
                ${summaryData.context.npcContext.length > 0 ? `👥 ${summaryData.context.npcContext.join(', ')}` : ''}
            </div>
        `;
        
        messageElement.appendChild(summaryDiv);
    }

    // Summary UI Management
    static addSummaryIndicator(messageIndex, isCoreMemory = false) {
        const chatContainer = document.getElementById('chat');
        if (!chatContainer) return;
        
        const messages = chatContainer.querySelectorAll('.mes');
        if (messageIndex >= messages.length) return;
        
        const messageElement = messages[messageIndex];
        const summaryData = messageSummaries.get(messageIndex);
        
        if (!summaryData || messageElement.querySelector('.nemolore-summary-indicator')) return;
        
        // Check if this is a core memory from stored data
        const isCore = isCoreMemory || summaryData.isCoreMemory;
        
        // Create summary indicator badge
        const indicator = document.createElement('div');
        indicator.className = isCore ? 'nemolore-summary-indicator nemolore-core-memory' : 'nemolore-summary-indicator';
        
        if (isCore) {
            indicator.innerHTML = `
                <span class="nemolore-summary-badge nemolore-core-badge" title="Core Memory - Significant narrative moment">
                    ✨ Core Memory
                </span>
            `;
        } else {
            indicator.innerHTML = `
                <span class="nemolore-summary-badge" title="Message has been summarized">
                    📝 Summarized
                </span>
            `;
        }
        
        // Add click handler to view/edit summary
        indicator.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSummaryModal(messageIndex);
        });
        
        // Insert the indicator in the message header
        const messageHeader = messageElement.querySelector('.mes_block') || messageElement;
        const firstChild = messageHeader.firstChild;
        messageHeader.insertBefore(indicator, firstChild);
    }

    static showSummaryModal(messageIndex) {
        const summaryData = messageSummaries.get(messageIndex);
        if (!summaryData) return;
        
        const context = getContext();
        const message = context.chat[messageIndex];
        
        // Create custom modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'nemolore-modal-overlay';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            padding: 20px;
            box-sizing: border-box;
        `;
        
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: var(--SmartThemeBlurTintColor);
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 8px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            width: 100%;
        `;
        
        modalContent.innerHTML = `
            <div class="nemolore-summary-modal">
                <div class="nemolore-summary-header">
                    <h3>Message Summary</h3>
                    <div class="nemolore-summary-meta">
                        <span>Message #${messageIndex + 1}</span>
                        <span>•</span>
                        <span>${new Date(summaryData.timestamp).toLocaleString()}</span>
                        <span>•</span>
                        <span>${summaryData.originalLength} chars → ${summaryData.text.length} chars</span>
                    </div>
                </div>
                
                <div class="nemolore-summary-content">
                    <div class="nemolore-summary-section">
                        <label>Original Message (preview):</label>
                        <div class="nemolore-original-preview">${message.mes.substring(0, 300)}${message.mes.length > 300 ? '...' : ''}</div>
                    </div>
                    
                    <div class="nemolore-summary-section">
                        <label for="nemolore-summary-text">Summary:</label>
                        <textarea id="nemolore-summary-text" class="nemolore-summary-textarea">${summaryData.text}</textarea>
                    </div>
                    
                    ${summaryData.context && Object.values(summaryData.context).some(v => v && (Array.isArray(v) ? v.length > 0 : true)) ? `
                    <div class="nemolore-summary-section">
                        <label>Context Information:</label>
                        <div class="nemolore-context-info">
                            ${summaryData.context.timeContext ? `<div><strong>Time:</strong> ${summaryData.context.timeContext}</div>` : ''}
                            ${summaryData.context.locationContext ? `<div><strong>Location:</strong> ${summaryData.context.locationContext}</div>` : ''}
                            ${summaryData.context.npcContext?.length ? `<div><strong>NPCs:</strong> ${summaryData.context.npcContext.join(', ')}</div>` : ''}
                        </div>
                    </div>
                    ` : ''}
                </div>
                
                <div class="nemolore-summary-actions">
                    <button id="nemolore-save-summary" class="menu_button">💾 Save Changes</button>
                    <button id="nemolore-regenerate-summary" class="menu_button">🔄 Regenerate</button>
                    <button id="nemolore-delete-summary" class="menu_button menu_button_warning">🗑️ Delete Summary</button>
                    <button id="nemolore-close-summary" class="menu_button">✕ Close</button>
                </div>
            </div>
        `;
        
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);
        
        // Setup event handlers immediately
        this.setupSummaryModalHandlers(messageIndex, modalOverlay);
        
        // Close on overlay click
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                this.closeSummaryModal(modalOverlay);
            }
        });
        
        // Close on Escape key
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeSummaryModal(modalOverlay);
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }
    
    static closeSummaryModal(modalOverlay) {
        if (modalOverlay && modalOverlay.parentNode) {
            modalOverlay.parentNode.removeChild(modalOverlay);
        }
    }

    static setupSummaryModalHandlers(messageIndex, modalOverlay) {
        const summaryTextarea = document.getElementById('nemolore-summary-text');
        
        // Save changes
        document.getElementById('nemolore-save-summary')?.addEventListener('click', () => {
            const newSummaryText = summaryTextarea.value.trim();
            if (newSummaryText) {
                const existingSummary = messageSummaries.get(messageIndex);
                const updatedSummary = {
                    ...existingSummary,
                    text: newSummaryText,
                    edited: true,
                    lastEdited: Date.now()
                };
                
                messageSummaries.set(messageIndex, updatedSummary);
                
                // Save to persistent storage
                this.saveSummaryToPersistentStorage(messageIndex, updatedSummary);
                
                // Update any displayed summaries and enhanced memory injection
                this.refreshSummaryDisplay();
                this.enhancedMemoryInjection();
                
                // Close modal
                this.closeSummaryModal(modalOverlay);
                
                console.log(`[${MODULE_NAME}] Updated summary for message ${messageIndex}`);
            }
        });
        
        // Regenerate summary
        document.getElementById('nemolore-regenerate-summary')?.addEventListener('click', async () => {
            this.closeSummaryModal(modalOverlay);
            
            // Remove existing summary and regenerate
            messageSummaries.delete(messageIndex);
            this.deleteSummaryFromPersistentStorage(messageIndex);
            
            // Remove visual indicator
            const chatContainer = document.getElementById('chat');
            const messages = chatContainer.querySelectorAll('.mes');
            if (messageIndex < messages.length) {
                const indicator = messages[messageIndex].querySelector('.nemolore-summary-indicator');
                if (indicator) indicator.remove();
            }
            
            // Show progress
            console.log(`[${MODULE_NAME}] Regenerating summary for message ${messageIndex}`);
            
            // Queue for regeneration
            await this.summarizeMessage(messageIndex);
            
            // Update display
            this.addSummaryIndicator(messageIndex);
        });
        
        // Delete summary
        document.getElementById('nemolore-delete-summary')?.addEventListener('click', () => {
            messageSummaries.delete(messageIndex);
            
            // Remove from persistent storage
            this.deleteSummaryFromPersistentStorage(messageIndex);
            
            // Remove visual indicator
            const chatContainer = document.getElementById('chat');
            const messages = chatContainer.querySelectorAll('.mes');
            if (messageIndex < messages.length) {
                const indicator = messages[messageIndex].querySelector('.nemolore-summary-indicator');
                if (indicator) indicator.remove();
            }
            
            // Update display and enhanced memory injection
            this.refreshSummaryDisplay();
            this.enhancedMemoryInjection();
            
            this.closeSummaryModal(modalOverlay);
            console.log(`[${MODULE_NAME}] Deleted summary for message ${messageIndex}`);
        });
        
        // Close modal
        document.getElementById('nemolore-close-summary')?.addEventListener('click', () => {
            this.closeSummaryModal(modalOverlay);
        });
    }

    // Persistent storage methods for summaries
    static saveSummaryToPersistentStorage(messageIndex, summaryData) {
        const chatId = getCurrentChatId();
        if (!chatId) return;
        
        // Initialize chat summaries storage if needed
        if (!nemoLoreSettings.chatSummaries) {
            nemoLoreSettings.chatSummaries = {};
        }
        
        if (!nemoLoreSettings.chatSummaries[chatId]) {
            nemoLoreSettings.chatSummaries[chatId] = {};
        }
        
        // Store the summary
        nemoLoreSettings.chatSummaries[chatId][messageIndex] = summaryData;
        
        // Save to extension settings
        saveSettings();
        
        console.log(`[${MODULE_NAME}] Saved summary for message ${messageIndex} in chat ${chatId}`);
    }

    static loadSummariesFromPersistentStorage() {
        const chatId = getCurrentChatId();
        if (!chatId) return;
        
        console.log(`[${MODULE_NAME}] Loading summaries for chat ${chatId}`);
        
        // Clear current summaries
        messageSummaries.clear();
        
        // Load summaries for current chat
        if (nemoLoreSettings.chatSummaries && nemoLoreSettings.chatSummaries[chatId]) {
            const chatSummaries = nemoLoreSettings.chatSummaries[chatId];
            
            let loadedCount = 0;
            for (const [messageIndex, summaryData] of Object.entries(chatSummaries)) {
                const index = parseInt(messageIndex);
                
                // Validate the summary data
                if (this.validateSummaryData(index, summaryData)) {
                    messageSummaries.set(index, summaryData);
                    loadedCount++;
                } else {
                    // Remove invalid summary data
                    delete nemoLoreSettings.chatSummaries[chatId][messageIndex];
                    console.warn(`[${MODULE_NAME}] Removed invalid summary for message ${messageIndex}`);
                }
            }
            
            console.log(`[${MODULE_NAME}] Loaded ${loadedCount} summaries for chat ${chatId}`);
            
            // Save cleaned up data if any invalid summaries were removed
            if (loadedCount !== Object.keys(chatSummaries).length) {
                saveSettings();
            }
            
            // Refresh UI to show summary indicators
            setTimeout(() => {
                this.refreshSummaryIndicators();
            }, 500);
            
            // Check if we need bulk summarization for unsummarized messages
            setTimeout(() => {
                this.checkForBulkSummarization();
            }, 1000);
        } else {
            // No existing summaries found, check for bulk summarization
            setTimeout(() => {
                this.checkForBulkSummarization();
            }, 1000);
        }
    }

    static async checkForBulkSummarization() {
        if (!nemoLoreSettings.enableSummarization || !nemoLoreSettings.autoSummarize) {
            console.log(`[${MODULE_NAME}] Bulk summarization skipped: summarization disabled`);
            return;
        }

        const context = getContext();
        if (!context?.chat?.length) return;

        const totalMessages = context.chat.length;
        const unsummarizedMessages = [];

        // Find all messages that need summarization
        for (let i = 0; i < totalMessages; i++) {
            if (!messageSummaries.has(i)) {
                unsummarizedMessages.push(i);
            }
        }

        console.log(`[${MODULE_NAME}] Found ${unsummarizedMessages.length} unsummarized messages out of ${totalMessages} total`);

        if (unsummarizedMessages.length === 0) {
            console.log(`[${MODULE_NAME}] No messages need summarization`);
            return;
        }

        // If we have many unsummarized messages, use bulk mode
        if (unsummarizedMessages.length > 10) {
            console.log(`[${MODULE_NAME}] Starting bulk summarization for ${unsummarizedMessages.length} messages`);
            await this.performBulkSummarization(unsummarizedMessages);
        } else {
            // Few messages, process individually
            console.log(`[${MODULE_NAME}] Processing ${unsummarizedMessages.length} messages individually`);
            for (const messageIndex of unsummarizedMessages) {
                this.queueMessageForSummary(messageIndex);
            }
        }
    }

    static async performBulkSummarization(messageIndices) {
        const BULK_CHUNK_SIZE = 20;
        const context = getContext();
        
        try {
            // Show progress notification
            toastr.info(`📝 Starting bulk summarization of ${messageIndices.length} messages...`, 'NemoLore', { timeOut: 5000 });

            // Process in chunks of 20
            for (let i = 0; i < messageIndices.length; i += BULK_CHUNK_SIZE) {
                const chunkIndices = messageIndices.slice(i, i + BULK_CHUNK_SIZE);
                const chunkMessages = chunkIndices.map(idx => context.chat[idx]);
                
                console.log(`[${MODULE_NAME}] Processing bulk chunk: messages ${chunkIndices[0]}-${chunkIndices[chunkIndices.length - 1]}`);
                
                // Show progress
                const progress = Math.round(((i + chunkIndices.length) / messageIndices.length) * 100);
                toastr.info(`📝 Bulk summarizing... ${progress}% complete`, 'NemoLore', { timeOut: 3000 });

                // Create bulk summary for this chunk
                const chunkSummary = await this.createBulkChunkSummary(chunkMessages, chunkIndices);
                
                if (chunkSummary) {
                    // Mark all messages in this chunk as summarized with the bulk summary
                    for (const messageIndex of chunkIndices) {
                        const message = context.chat[messageIndex];
                        const summaryData = {
                            text: chunkSummary,
                            originalLength: message.mes?.length || 0,
                            timestamp: Date.now(),
                            messageHash: getStringHash(message.mes || ''),
                            context: {},
                            isBulkSummary: true,
                            bulkChunkStart: chunkIndices[0],
                            bulkChunkEnd: chunkIndices[chunkIndices.length - 1]
                        };

                        messageSummaries.set(messageIndex, summaryData);
                        this.saveSummaryToPersistentStorage(messageIndex, summaryData);
                        
                        // Add summary indicator
                        setTimeout(() => this.addSummaryIndicator(messageIndex), 100);
                    }
                    
                    console.log(`[${MODULE_NAME}] Completed bulk chunk ${chunkIndices[0]}-${chunkIndices[chunkIndices.length - 1]}`);
                } else {
                    console.warn(`[${MODULE_NAME}] Failed to create bulk summary for chunk ${chunkIndices[0]}-${chunkIndices[chunkIndices.length - 1]}`);
                }

                // Small delay between chunks to prevent overwhelming the API
                if (i + BULK_CHUNK_SIZE < messageIndices.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            toastr.success(`✅ Bulk summarization complete! Processed ${messageIndices.length} messages`, 'NemoLore');
            console.log(`[${MODULE_NAME}] Bulk summarization completed for ${messageIndices.length} messages`);

            // Refresh summary indicators
            setTimeout(() => this.refreshSummaryIndicators(), 500);

        } catch (error) {
            console.error(`[${MODULE_NAME}] Bulk summarization failed:`, error);
            toastr.error('Bulk summarization failed. Check console for details.', 'NemoLore');
        }
    }

    static async createBulkChunkSummary(messages, indices) {
        try {
            // Combine all messages in the chunk into a cohesive text
            const combinedText = messages.map((msg, i) => {
                const speaker = msg.name || (msg.is_user ? 'User' : 'Assistant');
                return `${speaker}: ${msg.mes}`;
            }).join('\n\n');

            // Create bulk summarization prompt
            const prompt = `You are an expert narrative summarizer. Create a concise summary that captures the essential events and information from this sequence of messages.

SUMMARIZATION REQUIREMENTS:
- Maximum ${nemoLoreSettings.summaryMaxLength * 2} tokens (bulk summary can be longer)
- Past tense, factual tone
- Cover the main events, character interactions, and plot developments
- Include key details that would be important for understanding future context

MESSAGES TO SUMMARIZE (Messages ${indices[0]} to ${indices[indices.length - 1]}):
${combinedText}

Provide only the summary, no additional commentary:`;

            console.log(`[${MODULE_NAME}] Sending bulk summarization request for messages ${indices[0]}-${indices[indices.length - 1]}`);

            // Use the same API approach as individual summarization
            let response = null;
            
            try {
                response = await generateQuietPrompt(prompt, false);
                console.log(`[${MODULE_NAME}] Bulk generateQuietPrompt succeeded for chunk ${indices[0]}-${indices[indices.length - 1]}`);
            } catch (quietError) {
                console.log(`[${MODULE_NAME}] Bulk generateQuietPrompt failed, trying generateRaw:`, quietError);
                try {
                    response = await generateRaw(prompt, '', true, false, false, null, false);
                    console.log(`[${MODULE_NAME}] Bulk generateRaw succeeded for chunk ${indices[0]}-${indices[indices.length - 1]}`);
                } catch (rawError) {
                    console.error(`[${MODULE_NAME}] Both bulk API calls failed:`, rawError);
                    throw rawError;
                }
            }

            if (response && response.trim()) {
                const summary = response.trim();
                console.log(`[${MODULE_NAME}] Generated bulk summary for messages ${indices[0]}-${indices[indices.length - 1]}: "${summary.substring(0, 100)}..."`);
                return summary;
            } else {
                console.warn(`[${MODULE_NAME}] No valid bulk response for messages ${indices[0]}-${indices[indices.length - 1]}`);
                return null;
            }

        } catch (error) {
            console.error(`[${MODULE_NAME}] Error creating bulk chunk summary:`, error);
            return null;
        }
    }

    static validateSummaryData(messageIndex, summaryData) {
        // Check if summary data is valid
        if (!summaryData || typeof summaryData !== 'object') return false;
        if (!summaryData.text || !summaryData.messageHash) return false;
        
        // Check if getContext is available
        if (typeof getContext !== 'function') {
            console.log(`[${MODULE_NAME}] getContext not available yet, skipping validation for message ${messageIndex}`);
            return true; // Assume valid for now, will validate when context is available
        }
        
        // Check if the message still exists and matches
        const context = getContext();
        if (!context || !context.chat || messageIndex >= context.chat.length) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} doesn't exist in current chat, removing summary`);
            return false;
        }
        
        const message = context.chat[messageIndex];
        if (!message || getStringHash(message.mes) !== summaryData.messageHash) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} changed, removing summary`);
            return false;
        }
        
        return true;
    }

    static deleteSummaryFromPersistentStorage(messageIndex) {
        const chatId = getCurrentChatId();
        if (!chatId) return;
        
        if (nemoLoreSettings.chatSummaries && 
            nemoLoreSettings.chatSummaries[chatId] && 
            nemoLoreSettings.chatSummaries[chatId][messageIndex]) {
            
            delete nemoLoreSettings.chatSummaries[chatId][messageIndex];
            saveSettings();
            
            console.log(`[${MODULE_NAME}] Deleted persistent summary for message ${messageIndex}`);
        }
    }

    static cleanupOldSummaries() {
        // Clean up summaries for chats that no longer exist
        // This can be called periodically to prevent storage bloat
        if (!nemoLoreSettings.chatSummaries) return;
        
        const currentChatId = getCurrentChatId();
        let cleanedChats = 0;
        
        // Keep only recent chats (last 50) and current chat
        const chatIds = Object.keys(nemoLoreSettings.chatSummaries);
        if (chatIds.length > 50) {
            const chatsToKeep = chatIds.slice(-50);
            if (currentChatId && !chatsToKeep.includes(currentChatId)) {
                chatsToKeep.push(currentChatId);
            }
            
            for (const chatId of chatIds) {
                if (!chatsToKeep.includes(chatId)) {
                    delete nemoLoreSettings.chatSummaries[chatId];
                    cleanedChats++;
                }
            }
            
            if (cleanedChats > 0) {
                saveSettings();
                console.log(`[${MODULE_NAME}] Cleaned up summaries for ${cleanedChats} old chats`);
            }
        }
    }

    // Refresh all summary indicators in chat
    static refreshSummaryIndicators() {
        const chatContainer = document.getElementById('chat');
        if (!chatContainer) return;
        
        const messages = chatContainer.querySelectorAll('.mes');
        messages.forEach((messageElement, index) => {
            // Remove existing indicators
            const existingIndicator = messageElement.querySelector('.nemolore-summary-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
            
            // Add indicator if message has summary
            if (messageSummaries.has(index)) {
                this.addSummaryIndicator(index);
            }
        });
    }

    static queueMessageForSummary(messageIndex) {
        if (!nemoLoreSettings.enableSummarization || !nemoLoreSettings.autoSummarize) {
            console.log(`[${MODULE_NAME}] Summarization disabled or auto-summarize off`);
            return;
        }
        
        // Check if SillyTavern is ready
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] Cannot queue message for summary - SillyTavern not ready`);
            return;
        }
        
        // Check if already processed
        if (messageSummaries.has(messageIndex)) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} already has summary, skipping`);
            return;
        }
        
        // Add to queue if not already there
        if (!summaryProcessingQueue.includes(messageIndex)) {
            summaryProcessingQueue.push(messageIndex);
            console.log(`[${MODULE_NAME}] Queued message ${messageIndex} for summarization`);
        }
        
        // Process immediately (no delay) - we want to summarize every message as it happens
        setTimeout(() => {
            this.processSummaryQueue();
        }, 100); // Small delay just to batch multiple rapid messages
    }

    // Context management for AI - replacing messages with summaries in context
    static shouldExcludeFromContext(messageIndex) {
        // Don't exclude if summarization is disabled
        if (!nemoLoreSettings.enableSummarization || !nemoLoreSettings.hideMessagesWhenThreshold) return false;
        
        // Don't exclude if we don't have a summary for this message
        if (!messageSummaries.has(messageIndex)) return false;
        
        const context = getContext();
        const currentChatLength = context.chat.length;
        
        // Implement running memory window: exclude messages that are beyond the running memory size
        const runningMemorySize = nemoLoreSettings.runningMemorySize || 50;
        const shouldExcludeByRunningMemory = messageIndex < (currentChatLength - runningMemorySize);
        
        if (shouldExcludeByRunningMemory && messageSummaries.has(messageIndex)) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} beyond running memory size (${runningMemorySize}), excluding from context`);
            return true;
        }
        
        return false;
    }

    static collectSummariesForInjection() {
        // Collect all summaries that should be injected into context
        const context = getContext();
        const summaryTexts = [];
        
        // Iterate through messages in order and collect summaries for excluded messages
        for (let i = 0; i < context.chat.length; i++) {
            const summaryData = messageSummaries.get(i);
            if (summaryData && this.shouldExcludeFromContext(i)) {
                // Format the summary with context information
                let summaryText = summaryData.text;
                
                // Add context information if available
                const contextInfo = [];
                if (summaryData.context?.timeContext) {
                    contextInfo.push(`⏰ ${summaryData.context.timeContext}`);
                }
                if (summaryData.context?.locationContext) {
                    contextInfo.push(`📍 ${summaryData.context.locationContext}`);
                }
                if (summaryData.context?.npcContext?.length > 0) {
                    contextInfo.push(`👥 ${summaryData.context.npcContext.join(', ')}`);
                }
                
                if (contextInfo.length > 0) {
                    summaryText += ` (${contextInfo.join(', ')})`;
                }
                
                summaryTexts.push(summaryText);
            }
        }
        
        return summaryTexts;
    }

    static refreshMemoryInjection() {
        // Update the context injection with current summaries
        const context = getContext();
        if (!context || !nemoLoreSettings.enableSummarization) {
            // Clear injection if disabled
            context?.setExtensionPrompt?.(`${MODULE_NAME}_summary_memory`, "");
            return;
        }
        
        const summaries = this.collectSummariesForInjection();
        
        if (summaries.length === 0) {
            context.setExtensionPrompt(`${MODULE_NAME}_summary_memory`, "");
            return;
        }
        
        // Format the summary injection
        const injectionText = `[Previous events (summarized)]:\n${summaries.join('\n')}\n`;
        
        // Inject before main prompt using SillyTavern's extension prompt system
        context.setExtensionPrompt(
            `${MODULE_NAME}_summary_memory`, 
            injectionText, 
            2, // IN_PROMPT position (before main prompt)
            1, // depth
            false, // scan
            0  // SYSTEM role
        );
        
        console.log(`[${MODULE_NAME}] Injected ${summaries.length} summaries into context`);
    }

    // Vectorization system for excluded messages
    static async vectorizeExcludedMessage(messageIndex) {
        if (!nemoLoreSettings.enableVectorization) {
            return;
        }

        const context = getContext();
        const message = context.chat[messageIndex];
        if (!message) return;

        try {
            const messageText = message.mes;
            const messageHash = getStringHash(messageText);
            
            // Skip if already vectorized
            if (vectorizedMessages.has(messageIndex)) {
                console.log(`[${MODULE_NAME}] Message ${messageIndex} already vectorized`);
                return;
            }

            // Format text with vectors-enhanced compatible metadata encoding
            const speaker = message.name || (message.is_user ? 'User' : 'Assistant');
            
            // Use vectors-enhanced format: [META:floor=X,speaker=name,type=excluded_message] + message text
            const encodedText = `[META:floor=${messageIndex},speaker=${speaker},type=excluded_message,originalIndex=${messageIndex}] ${messageText}`;

            // Prepare vector item
            const vectorItem = {
                text: encodedText,  // Use encoded text with metadata prefix
                hash: messageHash,
                index: messageIndex,
                metadata: {
                    type: 'excluded_message',
                    chatId: getCurrentChatId(),
                    messageIndex: messageIndex,
                    originalIndex: messageIndex, // Add originalIndex to match vectors-enhanced
                    floor: messageIndex,  // Add floor to match vectors-enhanced
                    timestamp: Date.now(),
                    speaker: speaker,
                    is_user: message.is_user,
                    decodedType: 'excluded_message'  // For compatibility with vectors-enhanced
                }
            };

            // Use SillyTavern's vector API to store the message
            const collectionId = `nemolore_${getCurrentChatId()}`;
            await this.insertVectorItem(collectionId, vectorItem);
            
            vectorizedMessages.set(messageIndex, messageHash);
            console.log(`[${MODULE_NAME}] Vectorized excluded message ${messageIndex}`);

        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to vectorize message ${messageIndex}:`, error);
        }
    }

    static async insertVectorItem(collectionId, item) {
        try {
            const requestHeaders = getRequestHeaders();
            const response = await fetch('/api/vector/insert', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...requestHeaders,
                },
                body: JSON.stringify({
                    collectionId: collectionId,
                    items: [item],
                    source: nemoLoreSettings.vectorizationSource || 'google',
                    model: getSelectedEmbeddingModel(),
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to insert vector item: ${response.statusText}`);
            }

            console.log(`[${MODULE_NAME}] Successfully inserted vector item for message ${item.index}`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Vector insertion failed:`, error);
            throw error;
        }
    }

    // Decode metadata from encoded text (compatible with vectors-enhanced format)
    static decodeMetadataFromText(encodedText) {
        if (!encodedText) {
            return { text: encodedText, metadata: {} };
        }
        
        const metaMatch = encodedText.match(/^\[META:([^\]]+)\]/);
        if (!metaMatch) {
            return { text: encodedText, metadata: {} };
        }
        
        const metaString = metaMatch[1];
        const text = encodedText.substring(metaMatch[0].length).trim();
        const metadata = {};
        
        // Parse metadata key-value pairs
        const pairs = metaString.split(',');
        for (const pair of pairs) {
            const [key, value] = pair.split('=');
            if (key && value) {
                if (key === 'originalIndex' || key === 'floor') {
                    metadata[key] = parseInt(value, 10);
                } else {
                    metadata[key] = value;
                }
            }
        }
        
        return { text, metadata };
    }

    static async semanticSearchRelevantMessages(queryText, limit = null) {
        if (!nemoLoreSettings.enableVectorization) {
            return [];
        }

        try {
            const collectionId = `nemolore_${getCurrentChatId()}`;
            const searchLimit = limit || nemoLoreSettings.vectorSearchLimit || 3;
            const threshold = nemoLoreSettings.vectorSimilarityThreshold || 0.7;
            
            const requestHeaders = getRequestHeaders();
            const response = await fetch('/api/vector/query', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...requestHeaders,
                },
                body: JSON.stringify({
                    collectionId: collectionId,
                    searchText: queryText,
                    topK: searchLimit,
                    source: nemoLoreSettings.vectorizationSource || 'google',
                    model: getSelectedEmbeddingModel(),
                }),
            });

            if (!response.ok) {
                console.warn(`[${MODULE_NAME}] Vector query failed: ${response.statusText}`);
                return [];
            }

            const results = await response.json();
            console.log(`[${MODULE_NAME}] Found ${results.length || 0} vectorized results, filtering by threshold ${threshold}`);
            
            // Process results and decode metadata from text field (vectors-enhanced format)
            const processedResults = [];
            if (results.metadata && Array.isArray(results.metadata)) {
                for (const item of results.metadata) {
                    if (item.text) {
                        // Decode metadata from text field
                        const decoded = this.decodeMetadataFromText(item.text);
                        
                        // Create result compatible with our system
                        const processedResult = {
                            text: decoded.text, // Clean text without META prefix
                            score: item.score || 1.0,  // Default high score if not provided
                            metadata: {
                                ...item,
                                ...decoded.metadata, // Merge decoded metadata
                                decodedType: decoded.metadata.type,
                                decodedOriginalIndex: decoded.metadata.originalIndex,
                                decodedFloor: decoded.metadata.floor,
                                decodedSpeaker: decoded.metadata.speaker
                            }
                        };
                        
                        processedResults.push(processedResult);
                    }
                }
            }
            
            // Filter by type and similarity threshold
            const filteredResults = processedResults.filter(result => 
                result.metadata?.decodedType === 'excluded_message' &&
                result.score >= threshold
            );

            console.log(`[${MODULE_NAME}] ${filteredResults.length} messages passed similarity threshold`);
            
            // Sort by similarity score (highest first) and then by original index
            filteredResults.sort((a, b) => {
                if (b.score !== a.score) {
                    return b.score - a.score;
                }
                return (a.metadata.decodedOriginalIndex || 0) - (b.metadata.decodedOriginalIndex || 0);
            });
            
            return filteredResults;

        } catch (error) {
            console.error(`[${MODULE_NAME}] Semantic search failed:`, error);
            return [];
        }
    }

    static async enhancedMemoryInjection() {
        // Enhanced version that includes semantic retrieval of relevant excluded messages
        const context = getContext();
        if (!context || !nemoLoreSettings.enableSummarization) {
            context?.setExtensionPrompt?.(`${MODULE_NAME}_summary_memory`, "");
            return;
        }

        // Get regular summaries
        const summaries = this.collectSummariesForInjection();
        
        // Get semantically relevant excluded messages if vectorization is enabled
        let relevantMessages = [];
        if (nemoLoreSettings.enableVectorization && summaries.length > 0) {
            // Use recent context as search query
            const recentMessages = context.chat.slice(-3);
            const queryText = recentMessages.map(m => m.mes).join(' ').substring(0, 500);
            
            if (queryText.trim()) {
                relevantMessages = await this.semanticSearchRelevantMessages(queryText);
            }
        }

        if (summaries.length === 0 && relevantMessages.length === 0) {
            context.setExtensionPrompt(`${MODULE_NAME}_summary_memory`, "");
            return;
        }

        let injectionText = '';

        // Add summaries
        if (summaries.length > 0) {
            injectionText += `[Previous events (summarized)]:\n${summaries.join('\n')}\n`;
        }

        // Add relevant full messages (with better formatting using decoded metadata)
        if (relevantMessages.length > 0) {
            injectionText += '\n[Relevant past conversations]:\n';
            relevantMessages.forEach((result, index) => {
                const speaker = result.metadata.decodedSpeaker || result.metadata.speaker || 'Unknown';
                const messageIndex = result.metadata.decodedOriginalIndex || result.metadata.floor || 'Unknown';
                const score = (result.score * 100).toFixed(1);
                injectionText += `${speaker} (message ${messageIndex}, relevance: ${score}%): ${result.text}\n`;
            });
        }

        // Inject enhanced memory
        context.setExtensionPrompt(
            `${MODULE_NAME}_summary_memory`, 
            injectionText, 
            2, // IN_PROMPT position (before main prompt)
            1, // depth
            false, // scan
            0  // SYSTEM role
        );
        
        console.log(`[${MODULE_NAME}] Enhanced injection: ${summaries.length} summaries + ${relevantMessages.length} relevant messages`);
    }
}

// Global message interceptor function - called by SillyTavern before sending to AI
// This must match the "generate_interceptor" key in manifest.json
globalThis.nemolore_intercept_messages = function (chat, contextSize, abort, type) {
    if (!nemoLoreSettings.enableSummarization || !nemoLoreSettings.hideMessagesWhenThreshold) {
        return; // Do nothing if summarization disabled
    }
    
    // Refresh enhanced memory injection first (includes semantic search if enabled)
    MessageSummarizer.enhancedMemoryInjection();
    
    let start = chat.length - 1;
    if (type === 'continue') start--; // If continuing, keep the most recent message
    
    // Get the ignore symbol to mark messages for exclusion
    const context = getContext();
    const IGNORE_SYMBOL = context.symbols.ignore;
    
    // Mark messages for exclusion from context if they have summaries and are beyond running memory
    for (let i = start; i >= 0; i--) {
        const message = chat[i];
        const shouldExclude = MessageSummarizer.shouldExcludeFromContext(i);
        
        if (shouldExclude) {
            // Clone the message to keep changes temporary for this generation only
            chat[i] = structuredClone(chat[i]);
            chat[i].extra = chat[i].extra || {};
            chat[i].extra[IGNORE_SYMBOL] = true; // Mark for exclusion from context
            
            // Vectorize the excluded message for semantic retrieval
            MessageSummarizer.vectorizeExcludedMessage(i).catch(error => {
                console.warn(`[${MODULE_NAME}] Failed to vectorize excluded message ${i}:`, error);
            });
            
            console.log(`[${MODULE_NAME}] Excluding message ${i} from context (replaced with summary injection)`);
        }
    }
};

// Chat monitoring and message processing
function initializeChatMonitoring() {
    if (messageObserver) {
        messageObserver.disconnect();
    }

    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    messageObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains('mes')) {
                        processNewMessage(node);
                    }
                });
            } else if (mutation.type === 'characterData') {
                // Handle text changes within message content
                let messageElement = mutation.target.parentElement;
                while (messageElement && !messageElement.classList?.contains('mes')) {
                    messageElement = messageElement.parentElement;
                }
                
                if (messageElement && messageElement.classList.contains('mes')) {
                    const textContent = messageElement.querySelector('.mes_text');
                    if (textContent && textContent.contains(mutation.target)) {
                        // Only reprocess if the text content actually changed
                        textContent.removeAttribute('data-nemolore-processed');
                        // Debounce to avoid excessive processing during typing
                        clearTimeout(textContent._nemoloreProcessTimeout);
                        textContent._nemoloreProcessTimeout = setTimeout(() => {
                            processNewMessage(messageElement);
                        }, 200);
                    }
                }
            }
        });
    });

    messageObserver.observe(chatContainer, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Clear all processed flags and reprocess existing messages
    const existingMessages = chatContainer.querySelectorAll('.mes');
    existingMessages.forEach((msg) => {
        const textContent = msg.querySelector('.mes_text');
        if (textContent) {
            textContent.removeAttribute('data-nemolore-processed');
        }
        processNewMessage(msg);
    });
}

function processNewMessage(messageElement) {
    if (!nemoLoreSettings.enabled) return;

    const textContent = messageElement.querySelector('.mes_text');
    if (!textContent) return;

    // Skip if already processed and not edited
    if (textContent.hasAttribute('data-nemolore-processed')) {
        return;
    }

    const text = textContent.textContent || '';
    
    // Process noun highlighting if enabled
    if (nemoLoreSettings.highlightNouns) {
        const detectedNouns = NounDetector.detectNouns(text);
        
        if (detectedNouns.length > 0) {
            NounDetector.highlightNouns(textContent, detectedNouns);
        }
    }

    // Queue message for summarization if enabled (summarize EVERY message as it happens)
    if (nemoLoreSettings.enableSummarization) {
        const messageIndex = Array.from(messageElement.parentElement.children).indexOf(messageElement);
        if (messageIndex >= 0) {
            console.log(`[${MODULE_NAME}] Processing new message at index ${messageIndex}`);
            MessageSummarizer.queueMessageForSummary(messageIndex);
            
            // After queuing, refresh summary display and enhanced memory injection
            setTimeout(() => {
                MessageSummarizer.refreshSummaryDisplay();
                MessageSummarizer.enhancedMemoryInjection();
            }, 200);
        }
    }
    
    // Mark as processed even if no processing occurred to prevent reprocessing
    if (!textContent.hasAttribute('data-nemolore-processed')) {
        textContent.setAttribute('data-nemolore-processed', 'true');
    }
}

function refreshChatHighlighting() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    
    const messages = chatContainer.querySelectorAll('.mes');
    messages.forEach((msg) => {
        const textContent = msg.querySelector('.mes_text');
        if (textContent) {
            // Clear processed flag to allow reprocessing
            textContent.removeAttribute('data-nemolore-processed');
            processNewMessage(msg);
        }
    });
    
    // Also refresh summary indicators
    MessageSummarizer.refreshSummaryIndicators();
}

function clearAllHighlighting() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;
    
    // Hide any active tooltip
    TooltipManager.hideTooltip();
    
    // Remove all highlighting spans
    const highlightedElements = chatContainer.querySelectorAll('.nemolore-highlighted-noun');
    highlightedElements.forEach(element => {
        const parent = element.parentNode;
        parent.insertBefore(document.createTextNode(element.textContent), element);
        parent.removeChild(element);
    });
    
    // Clear all processed flags
    const textElements = chatContainer.querySelectorAll('.mes_text[data-nemolore-processed]');
    textElements.forEach(element => {
        element.removeAttribute('data-nemolore-processed');
    });
    
    // Clear tracking sets
    highlightedNouns.clear();
    processedMessages = new WeakSet();
}

// Helper function to safely check if element matches selector
function elementMatches(element, selector) {
    if (!element || !element.matches) return false;
    try {
        return element.matches(selector);
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Error in element matches:`, error);
        return false;
    }
}

// Event handlers
function setupEventHandlers() {
    // Handle noun clicks
    document.addEventListener('click', async (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun')) {
            const noun = e.target.getAttribute('data-noun');
            await handleNounClick(noun, e.target);
        }
    });

    // Mobile detection
    const isMobileDevice = () => {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
               window.innerWidth <= 768 || 
               ('ontouchstart' in window);
    };
    
    let touchHoldTimer = null;
    let touchStartTime = 0;
    const TOUCH_HOLD_DURATION = 500; // 500ms for hold
    
    // Handle noun interactions - both desktop hover and mobile tap/hold
    document.addEventListener('mouseenter', async (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun') && !isMobileDevice()) {
            const noun = e.target.getAttribute('data-noun');
            await TooltipManager.showTooltip(e.target, noun, false);
        }
    }, true);

    document.addEventListener('mouseleave', (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun') && !isMobileDevice()) {
            TooltipManager.hideTooltip();
        }
    }, true);
    
    // Mobile touch events
    document.addEventListener('touchstart', async (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun')) {
            touchStartTime = Date.now();
            const noun = e.target.getAttribute('data-noun');
            
            // Set up hold timer for tooltip display
            touchHoldTimer = setTimeout(async () => {
                // Show tooltip on hold
                await TooltipManager.showTooltip(e.target, noun, true);
                
                // Add haptic feedback if available
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }, TOUCH_HOLD_DURATION);
        }
    }, { passive: true });
    
    document.addEventListener('touchend', async (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun')) {
            const touchDuration = Date.now() - touchStartTime;
            clearTimeout(touchHoldTimer);
            
            if (touchDuration < TOUCH_HOLD_DURATION) {
                // Short tap - show tooltip briefly then handle click
                const noun = e.target.getAttribute('data-noun');
                await TooltipManager.showTooltip(e.target, noun, true);
                
                // Hide tooltip after 2 seconds and handle click
                setTimeout(async () => {
                    TooltipManager.hideTooltip();
                    await handleNounClick(noun, e.target);
                }, 2000);
            }
            // Long hold already showed persistent tooltip, no additional action needed
        }
    });
    
    document.addEventListener('touchcancel', (e) => {
        if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }
    });

    // Hide tooltip when scrolling or clicking elsewhere
    document.addEventListener('scroll', () => {
        TooltipManager.hideTooltip();
    }, true);

    document.addEventListener('click', (e) => {
        if (!elementMatches(e.target, '.nemolore-highlighted-noun') && 
            !elementMatches(e.target, '.nemolore-tooltip') &&
            !e.target.closest('.nemolore-tooltip')) {
            TooltipManager.hideTooltip();
        }
    });
    
    // Mobile-specific: Hide tooltip on touch outside
    document.addEventListener('touchstart', (e) => {
        if (isMobileDevice() && 
            !elementMatches(e.target, '.nemolore-highlighted-noun') && 
            !elementMatches(e.target, '.nemolore-tooltip') &&
            !e.target.closest('.nemolore-tooltip')) {
            TooltipManager.hideTooltip();
        }
    }, { passive: true });
    
    // Keyboard accessibility for highlighted nouns
    document.addEventListener('keydown', async (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun')) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const noun = e.target.getAttribute('data-noun');
                await handleNounClick(noun, e.target);
            } else if (e.key === 'Escape') {
                TooltipManager.hideTooltip();
                e.target.blur();
            } else if (e.key === '?' || e.key === 'h') {
                // Show tooltip on ? or h key press
                const noun = e.target.getAttribute('data-noun');
                await TooltipManager.showTooltip(e.target, noun, false);
            }
        }
    });
    
    // Enhanced focus management
    document.addEventListener('focusin', async (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun')) {
            const noun = e.target.getAttribute('data-noun');
            await TooltipManager.showTooltip(e.target, noun, false);
        }
    });
    
    document.addEventListener('focusout', (e) => {
        if (elementMatches(e.target, '.nemolore-highlighted-noun')) {
            // Delay hiding to allow for focus transfers
            setTimeout(() => {
                if (!document.activeElement?.closest('.nemolore-tooltip') &&
                    !elementMatches(document.activeElement, '.nemolore-highlighted-noun')) {
                    TooltipManager.hideTooltip();
                }
            }, 100);
        }
    });

    // Handle chat changes
    eventSource.on(event_types.CHAT_CHANGED, () => {
        handleChatChanged();
    });

    // Handle chat clearing
    eventSource.on(event_types.CHAT_DELETED, () => {
        TooltipManager.hideTooltip();
        clearAllHighlighting();
        currentChatLorebook = null;
        messageCount = 0;
    });

    eventSource.on(event_types.MESSAGE_SENT, () => {
        checkForPeriodicUpdate();
    });

    // Handle message edits and updates
    eventSource.on(event_types.MESSAGE_UPDATED, () => {
        // Delay slightly to ensure DOM is updated
        setTimeout(() => {
            refreshChatHighlighting();
        }, 100);
    });
}

async function handleNounClick(noun, element) {
    const matchData = await LorebookManager.findEntryForNoun(noun);
    
    if (matchData) {
        const { entry, matchScore, matchType } = matchData;
        const isExactMatch = matchScore >= 80;
        
        if (isExactMatch) {
            // Show existing entry for exact matches
            await callPopup(`
                <div class="nemolore-entry-popup">
                    <h3>${entry.title || noun}</h3>
                    <p><strong>Keywords:</strong> ${entry.key ? entry.key.join(', ') : 'None'}</p>
                    <div class="nemolore-entry-content">${entry.content || 'No description available'}</div>
                    <div class="nemolore-popup-buttons">
                        <button class="menu_button" onclick="window.nemolore_editEntry('${entry.uid}')">Edit Entry</button>
                        <button class="menu_button" onclick="window.nemolore_closePopup()">Close</button>
                    </div>
                </div>
            `, 'text', '', { wide: false, large: false });
        } else {
            // For partial matches, offer to create dedicated entry or view related
            const action = await NotificationSystem.show(
                `"${noun}" found in related entry "${entry.title || 'Untitled'}". What would you like to do?`,
                [
                    { action: 'create', text: `Create entry for "${noun}"` },
                    { action: 'view', text: `View "${entry.title || 'Related entry'}"` },
                    { action: 'ignore', text: 'Cancel' }
                ],
                8000
            );

            if (action === 'create') {
                await createEntryForNoun(noun);
            } else if (action === 'view') {
                // Show the related entry
                await callPopup(`
                    <div class="nemolore-entry-popup">
                        <h3>${entry.title || 'Related Entry'}</h3>
                        <p><strong>Keywords:</strong> ${entry.key ? entry.key.join(', ') : 'None'}</p>
                        <div class="nemolore-entry-content">${entry.content || 'No description available'}</div>
                        <div class="nemolore-popup-buttons">
                            <button class="menu_button" onclick="window.nemolore_editEntry('${entry.uid}')">Edit Entry</button>
                            <button class="menu_button" onclick="window.nemolore_createForNoun('${noun}')">Create Entry for "${noun}"</button>
                            <button class="menu_button" onclick="window.nemolore_closePopup()">Close</button>
                        </div>
                    </div>
                `, 'text', '', { wide: false, large: false });
            }
        }
    } else {
        // Offer to create new entry
        const action = await NotificationSystem.show(
            `No lorebook entry found for "${noun}". Would you like to create one?`,
            [
                { action: 'create', text: 'Create Entry' },
                { action: 'ignore', text: 'Ignore' }
            ],
            5000
        );

        if (action === 'create') {
            await createEntryForNoun(noun);
        }
    }
}

async function createEntryForNoun(noun) {
    // Check if we have a current lorebook
    if (!currentChatLorebook) {
        console.warn(`[${MODULE_NAME}] No current lorebook found. Creating one...`);
        const chatId = getCurrentChatId();
        if (!chatId) {
            await NotificationSystem.show(`Error: No active chat found. Please start a chat first.`, [], 3000);
            return;
        }
        currentChatLorebook = await LorebookManager.createChatLorebook(chatId);
        if (!currentChatLorebook) {
            await NotificationSystem.show(`Error: Could not create lorebook. Please try again.`, [], 3000);
            return;
        }
    }

    // Verify lorebook exists
    if (!world_names.includes(currentChatLorebook)) {
        console.error(`[${MODULE_NAME}] Lorebook "${currentChatLorebook}" not found in world_names:`, world_names);
        await NotificationSystem.show(`Error: Lorebook "${currentChatLorebook}" not found. Please try again.`, [], 3000);
        return;
    }

    // Generate context-aware description
    const context = getChatContext();
    const prompt = `Based on the following chat context, create a lorebook entry for "${noun}".

Context:
${context}

Create a detailed description for "${noun}" that would be useful for future roleplay. Focus on:
- What/who ${noun} is
- Relevant details mentioned in the context
- Additional context that would enhance roleplay

Provide a 2-4 sentence description that captures the essence of ${noun} based on the available context.`;

    try {
        console.log(`[${MODULE_NAME}] Generating description for "${noun}" using lorebook: ${currentChatLorebook}`);
        const description = await generateQuietPrompt(prompt, false);
        
        // Load the lorebook data first
        const lorebookData = await loadWorldInfo(currentChatLorebook);
        if (!lorebookData) {
            throw new Error(`Could not load lorebook data for: ${currentChatLorebook}`);
        }

        console.log(`[${MODULE_NAME}] Creating world info entry for "${noun}"`);
        
        // Create the entry using SillyTavern's function
        const newEntry = createWorldInfoEntry(currentChatLorebook, lorebookData);
        
        if (!newEntry) {
            throw new Error(`Failed to create world info entry for "${noun}"`);
        }

        // Update the entry with our data
        newEntry.key = [noun];
        newEntry.keysecondary = [];
        newEntry.comment = `Generated by ${MODULE_NAME} for ${noun}`;
        newEntry.content = description.trim();
        newEntry.constant = false;
        newEntry.selective = true;
        newEntry.selectiveLogic = world_info_logic.AND_ANY;
        newEntry.addMemo = true;
        newEntry.order = 100;
        newEntry.position = world_info_position.before;
        newEntry.disable = false;
        newEntry.excludeRecursion = true;
        newEntry.preventRecursion = true;
        newEntry.probability = 100;
        newEntry.useProbability = false;
        newEntry.depth = DEFAULT_DEPTH;
        newEntry.group = '';
        newEntry.groupOverride = false;
        newEntry.groupWeight = DEFAULT_WEIGHT;
        newEntry.scanDepth = null;
        newEntry.caseSensitive = null;
        newEntry.matchWholeWords = null;
        newEntry.useGroupScoring = null;
        newEntry.automationId = '';
        newEntry.role = extension_prompt_roles.SYSTEM;
        newEntry.sticky = null;
        newEntry.cooldown = null;
        newEntry.delay = null;
        newEntry.delayUntilRecursion = false;
        newEntry.title = noun;

        console.log(`[${MODULE_NAME}] Created entry with UID: ${newEntry.uid}`);
        
        // Save the updated lorebook
        await saveWorldInfo(currentChatLorebook, lorebookData);
        await updateWorldInfoList();
        
        console.log(`[${MODULE_NAME}] Successfully created entry for "${noun}" in lorebook: ${currentChatLorebook}`);
        
        // Show success notification
        await NotificationSystem.show(`Created lorebook entry for "${noun}"!`, [], 3000);
        
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error creating entry for "${noun}":`, error);
        await NotificationSystem.show(`Error creating entry for "${noun}". Please try again.`, [], 3000);
    }
}

function getChatContext() {
    const recentMessages = chat.slice(-10); // Last 10 messages
    return recentMessages.map(msg => `${msg.name}: ${msg.mes}`).join('\n\n');
}

async function handleChatChanged() {
    if (!nemoLoreSettings.enabled) return;

    const chatId = getCurrentChatId();
    if (!chatId) return;

    // Check if we have a lorebook for this chat (using SillyTavern's standard field first)
    const existingLorebook = chat_metadata[METADATA_KEY];
    const hasValidLorebook = existingLorebook && world_names.includes(existingLorebook);
    const isNewChat = !chat_metadata.nemolore?.initialPromptShown;
    
    console.log(`[${MODULE_NAME}] Chat changed - ID: ${chatId}`);
    console.log(`[${MODULE_NAME}] Existing lorebook metadata: ${existingLorebook}`);
    console.log(`[${MODULE_NAME}] Has valid lorebook: ${hasValidLorebook}`);
    console.log(`[${MODULE_NAME}] Is new chat (no initial prompt shown): ${isNewChat}`);
    console.log(`[${MODULE_NAME}] Settings - createLorebookOnChat: ${nemoLoreSettings.createLorebookOnChat}, showInitialPrompt: ${nemoLoreSettings.showInitialPrompt}`);
    
    // Load summaries for this chat
    MessageSummarizer.loadSummariesFromPersistentStorage();
    
    // Always set current lorebook if one exists
    if (hasValidLorebook) {
        currentChatLorebook = existingLorebook;
        console.log(`[${MODULE_NAME}] Using existing lorebook: ${currentChatLorebook}`);
    } else if (chat_metadata.nemolore?.lorebook) {
        // Fallback to our custom field
        currentChatLorebook = chat_metadata.nemolore.lorebook;
        // Sync to standard field if lorebook exists
        if (world_names.includes(currentChatLorebook)) {
            chat_metadata[METADATA_KEY] = currentChatLorebook;
            await saveMetadata();
        }
        console.log(`[${MODULE_NAME}] Using custom field lorebook: ${currentChatLorebook}`);
    }
    
    // Show popup for new chats if settings allow, regardless of whether a lorebook exists
    if (isNewChat && nemoLoreSettings.createLorebookOnChat && nemoLoreSettings.showInitialPrompt) {
        console.log(`[${MODULE_NAME}] Showing world expansion prompt for new chat`);
        
        // Mark that we've shown the prompt for this chat
        if (!chat_metadata.nemolore) chat_metadata.nemolore = {};
        chat_metadata.nemolore.initialPromptShown = true;
        await saveMetadata();
        
        const message = hasValidLorebook 
            ? `This chat has an existing lorebook "${existingLorebook}". Would you like NemoLore to enhance it with additional world-building entries?`
            : 'Would you like to flesh out your world with automatic lorebook creation?';
            
        const buttons = hasValidLorebook
            ? [
                { action: 'enhance', text: 'Yes, enhance existing lorebook' },
                { action: 'create', text: 'Create new NemoLore lorebook' },
                { action: 'no', text: 'No, skip for now' },
            ]
            : [
                { action: 'yes', text: 'Yes, create lorebook' },
                { action: 'no', text: 'No, skip for now' },
            ];

        const action = await NotificationSystem.show(message, buttons, nemoLoreSettings.notificationTimeout);

        if (action === 'yes' || action === 'create') {
            await initializeWorldExpansion();
        } else if (action === 'enhance') {
            await enhanceExistingLorebook(currentChatLorebook);
        } else {
            console.log(`[${MODULE_NAME}] User declined world expansion`);
        }
    } else if (!isNewChat) {
        console.log(`[${MODULE_NAME}] Not a new chat - initial prompt already shown`);
    } else {
        console.log(`[${MODULE_NAME}] World expansion prompt not shown - settings disabled`);
    }

    // Reinitialize chat monitoring
    setTimeout(() => {
        initializeChatMonitoring();
        
        // Update enhanced memory injection for the new chat
        if (nemoLoreSettings.enableSummarization) {
            MessageSummarizer.enhancedMemoryInjection();
        }
    }, 1000);
}

async function initializeWorldExpansion() {
    const chatId = getCurrentChatId();
    const lorebookName = await LorebookManager.createChatLorebook(chatId);
    
    if (lorebookName && active_character) {
        // Use the same character finding logic as enhanceExistingLorebook
        let characterData = characters[active_character];
        
        // If not found directly, try without file extension
        if (!characterData && active_character.includes('.')) {
            const nameWithoutExt = active_character.replace(/\.[^/.]+$/, "");
            characterData = characters[nameWithoutExt];
        }
        
        // If still not found, try to find by character name
        if (!characterData) {
            const characterName = active_character.replace(/\.[^/.]+$/, "").replace(/[_-]/g, ' ');
            for (const [key, char] of Object.entries(characters)) {
                if (char.name === characterName || char.avatar === active_character) {
                    characterData = char;
                    break;
                }
            }
        }
        
        // If still not found, use first available character as fallback
        if (!characterData && Object.keys(characters).length > 0) {
            const firstKey = Object.keys(characters);
            characterData = characters[firstKey];
        }
        
        if (characterData) {
            await LorebookManager.generateInitialEntries(characterData, lorebookName);
            
            await NotificationSystem.show(
                'World expansion completed! Your lorebook has been populated with initial entries.',
                [],
                3000
            );
        } else {
            await NotificationSystem.show(
                'Cannot create lorebook entries: No character data available.',
                [],
                5000
            );
        }
    }
}

async function enhanceExistingLorebook(lorebookName) {
    if (!lorebookName) {
        console.error(`[${MODULE_NAME}] Cannot enhance lorebook - missing lorebook name`);
        return;
    }
    
    if (!active_character) {
        console.error(`[${MODULE_NAME}] Cannot enhance lorebook - no active character`);
        return;
    }

    console.log(`[${MODULE_NAME}] Active character:`, active_character);
    console.log(`[${MODULE_NAME}] Available character keys:`, Object.keys(characters));
    
    // Try multiple ways to find the character data
    let characterData = characters[active_character];
    
    // If not found directly, try without file extension
    if (!characterData && active_character.includes('.')) {
        const nameWithoutExt = active_character.replace(/\.[^/.]+$/, "");
        characterData = characters[nameWithoutExt];
        console.log(`[${MODULE_NAME}] Tried without extension (${nameWithoutExt}):`, !!characterData);
    }
    
    // If still not found, try to find by character name
    if (!characterData) {
        const characterName = active_character.replace(/\.[^/.]+$/, "").replace(/[_-]/g, ' ');
        for (const [key, char] of Object.entries(characters)) {
            if (char.name === characterName || char.avatar === active_character) {
                characterData = char;
                console.log(`[${MODULE_NAME}] Found character by name/avatar match:`, key);
                break;
            }
        }
    }
    
    // If still not found, just use the first available character as fallback
    if (!characterData && Object.keys(characters).length > 0) {
        const firstKey = Object.keys(characters);
        characterData = characters[firstKey];
        console.log(`[${MODULE_NAME}] Using first available character as fallback:`, firstKey);
    }
    
    if (!characterData) {
        console.error(`[${MODULE_NAME}] Cannot enhance lorebook - no character data found`);
        await NotificationSystem.show(
            'Cannot enhance lorebook: No character data available. Please ensure you have a character loaded.',
            [],
            5000
        );
        return;
    }
    
    console.log(`[${MODULE_NAME}] Enhancing existing lorebook: ${lorebookName}`);
    console.log(`[${MODULE_NAME}] Active character: ${active_character}`);
    console.log(`[${MODULE_NAME}] Character data:`, characterData);
    
    // Set this as our current lorebook for tracking
    currentChatLorebook = lorebookName;
    
    // Store reference in our custom metadata
    if (!chat_metadata.nemolore) chat_metadata.nemolore = {};
    chat_metadata.nemolore.lorebook = lorebookName;
    await saveMetadata();
    
    try {
        // Generate entries for the existing lorebook
        await LorebookManager.generateInitialEntries(characterData, lorebookName);
        
        await NotificationSystem.show(
            `Lorebook "${lorebookName}" has been enhanced with additional world-building entries from NemoLore!`,
            [],
            4000
        );
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error enhancing lorebook:`, error);
        await NotificationSystem.show(
            'Error enhancing lorebook. Please check the console for details.',
            [],
            3000
        );
    }
}

let messageCount = 0;
function checkForPeriodicUpdate() {
    if (!nemoLoreSettings.autoMode && !currentChatLorebook) return;
    
    messageCount++;
    
    if (messageCount >= nemoLoreSettings.updateInterval) {
        messageCount = 0;
        
        if (nemoLoreSettings.autoMode) {
            performPeriodicUpdate();
        } else {
            // Show update prompt
            NotificationSystem.show(
                `You've been chatting for a while. Would you like to update your lorebook?`,
                [
                    { action: 'update', text: 'Update' },
                    { action: 'later', text: 'Later' }
                ],
                nemoLoreSettings.notificationTimeout
            ).then(action => {
                if (action === 'update') {
                    performPeriodicUpdate();
                }
            });
        }
    }
}

async function performPeriodicUpdate() {
    // Implementation for periodic lorebook updates
    console.log(`[${MODULE_NAME}] Performing periodic lorebook update`);
    // This would involve analyzing recent chat content and updating/creating entries
}

// Settings management
function loadSettings() {
    if (extension_settings[MODULE_NAME]) {
        Object.assign(nemoLoreSettings, extension_settings[MODULE_NAME]);
    }
}

function saveSettings() {
    extension_settings[MODULE_NAME] = nemoLoreSettings;
    saveSettingsDebounced();
}

// Global functions for popup interactions
window.nemolore_editEntry = function(entryId) {
    openWorldInfoEditor(currentChatLorebook, entryId);
    window.nemolore_closePopup();
};

window.nemolore_createForNoun = function(noun) {
    window.nemolore_closePopup();
    createEntryForNoun(noun);
};

window.nemolore_closePopup = function() {
    document.querySelector('.popup').remove();
};

// Dropdown population functions
// Update connection profile dropdown - EXACT copy from MessageSummarize
async function updateConnectionProfileDropdown() {
    let $connectionSelect = $('#nemolore_connection_profile');
    let currentProfile = nemoLoreSettings.connectionProfile;
    let profiles = await MessageSummarizer.getConnectionProfiles();
    
    $connectionSelect.empty();
    $connectionSelect.append('<option value="">Same as Current</option>');
    
    if (profiles) {
        for (let profile of profiles) {
            $connectionSelect.append(`<option value="${profile}">${profile}</option>`);
        }
    }
    
    $connectionSelect.val(currentProfile);
    
    // Set a click event to refresh the dropdown
    $connectionSelect.off('click').on('click', () => updateConnectionProfileDropdown());
}

// Refresh settings - EXACT copy from MessageSummarize approach
function refreshNemoLoreSettings() {
    console.log(`[${MODULE_NAME}] Refreshing settings...`);
    
    // Connection profiles
    if (MessageSummarizer.checkConnectionProfilesActive()) {
        updateConnectionProfileDropdown();
        console.log(`[${MODULE_NAME}] Connection profiles active - showing dropdown`);
    } else {
        // If connection profiles extension isn't active, hide the connection profile dropdown
        $('#nemolore_connection_profile').parent().hide();
        console.log(`[${MODULE_NAME}] Connection profiles extension not active. Hiding connection profile dropdown.`);
    }
    
    // Completion presets
    updateCompletionPresetDropdown();
}

// Update completion preset dropdown - EXACT copy from MessageSummarize
async function updateCompletionPresetDropdown() {
    console.log(`[${MODULE_NAME}] Updating completion preset dropdown...`);
    
    let $presetSelect = $('#nemolore_completion_preset');
    let currentPreset = nemoLoreSettings.completionPreset;
    let presetOptions = await MessageSummarizer.getCompletionPresets();
    
    console.log(`[${MODULE_NAME}] Found ${presetOptions ? presetOptions.length : 0} completion presets:`, presetOptions);
    
    $presetSelect.empty();
    $presetSelect.append('<option value="">Same as Current</option>');
    
    for (let option of presetOptions) {
        console.log(`[${MODULE_NAME}] Adding preset option:`, option);
        $presetSelect.append(`<option value="${option}">${option}</option>`);
    }
    
    $presetSelect.val(currentPreset);
    console.log(`[${MODULE_NAME}] Completion preset dropdown populated, current value: "${currentPreset}"`);
    
    // Set a click event to refresh the preset dropdown for the currently available presets
    $presetSelect.off('click').on('click', () => updateCompletionPresetDropdown());
}

// Toggle visibility of embedding model dropdowns based on selected source
function toggleVectorizationModelUI(source) {
    // Hide all model containers first
    const containers = [
        'nemolore_openai_model_container',
        'nemolore_google_model_container', 
        'nemolore_cohere_model_container',
        'nemolore_ollama_model_container',
        'nemolore_vllm_model_container'
    ];
    
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            container.style.display = 'none';
        }
    });
    
    // Show the appropriate model container based on source
    const containerMap = {
        'openai': 'nemolore_openai_model_container',
        'google': 'nemolore_google_model_container',
        'cohere': 'nemolore_cohere_model_container', 
        'ollama': 'nemolore_ollama_model_container',
        'vllm': 'nemolore_vllm_model_container'
    };
    
    const targetContainer = containerMap[source];
    if (targetContainer) {
        const container = document.getElementById(targetContainer);
        if (container) {
            container.style.display = 'flex';
        }
    }
    
    console.log(`[${MODULE_NAME}] Toggled vectorization model UI for source: ${source}`);
}

// Get the selected embedding model for the current vectorization source
function getSelectedEmbeddingModel(source = null) {
    const currentSource = source || nemoLoreSettings.vectorizationSource;
    
    const modelMap = {
        'openai': nemoLoreSettings.openaiModel,
        'google': nemoLoreSettings.googleModel,
        'cohere': nemoLoreSettings.cohereModel,
        'ollama': nemoLoreSettings.ollamaModel,
        'vllm': nemoLoreSettings.vllmModel
    };
    
    return modelMap[currentSource] || '';
}

// Settings UI initialization (called automatically by SillyTavern when settings.html loads)
// Check UI compatibility and switch to fallback if needed
async function checkUICompatibility() {
    // Check for manual override in settings
    if (nemoLoreSettings.forceCompatibilityMode) {
        console.log(`[${MODULE_NAME}] Compatibility mode manually enabled in settings`);
        enableFallbackInterface();
        return true;
    }
    
    // First check: Do other extensions already use inline-drawer successfully?
    const existingDrawers = document.querySelectorAll('.inline-drawer');
    if (existingDrawers.length > 0) {
        // Check if any existing drawer is properly styled
        for (const drawer of existingDrawers) {
            const toggle = drawer.querySelector('.inline-drawer-toggle');
            if (toggle && getComputedStyle(toggle).cursor === 'pointer') {
                console.log(`[${MODULE_NAME}] Detected working inline-drawer from other extension, using modern interface`);
                enableModernInterface();
                return false;
            }
        }
    }
    
    // Fallback test: Create our own test drawer
    const testDrawer = document.createElement('div');
    testDrawer.className = 'inline-drawer';
    testDrawer.style.position = 'absolute';
    testDrawer.style.left = '-9999px';
    testDrawer.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down interactable"></div>
        </div>
        <div class="inline-drawer-content"></div>
    `;
    
    document.body.appendChild(testDrawer);
    
    // Wait for styles to apply
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Check if drawer styling is properly applied
    const toggle = testDrawer.querySelector('.inline-drawer-toggle');
    const icon = testDrawer.querySelector('.inline-drawer-icon');
    const content = testDrawer.querySelector('.inline-drawer-content');
    
    // Check for Font Awesome by looking for ::before pseudo-element content
    const iconStyles = icon ? getComputedStyle(icon, '::before') : null;
    const hasFontAwesome = iconStyles && (iconStyles.content !== 'none' && iconStyles.content !== '');
    
    // Check if CSS classes are defined (not just font-size which could be inherited)
    const hasDrawerClasses = toggle && getComputedStyle(toggle).position !== 'static';
    
    const hasDrawerSupport = (
        toggle && 
        icon && 
        content &&
        hasDrawerClasses &&
        (hasFontAwesome || getComputedStyle(icon).fontFamily.includes('FontAwesome') || getComputedStyle(icon).fontWeight === '900')
    );
    
    document.body.removeChild(testDrawer);
    
    if (!hasDrawerSupport) {
        console.log(`[${MODULE_NAME}] Inline drawer support not detected, switching to fallback UI`);
        enableFallbackInterface();
        return true; // Using fallback
    } else {
        console.log(`[${MODULE_NAME}] Using modern drawer interface`);
        enableModernInterface();
        return false; // Using modern interface
    }
}

function enableFallbackInterface() {
    // Hide modern interface
    const drawerInterfaces = document.querySelectorAll('.nemolore-drawer-interface');
    drawerInterfaces.forEach(el => el.style.display = 'none');
    
    // Show fallback interface
    const fallbackInterfaces = document.querySelectorAll('.nemolore-fallback-interface');
    fallbackInterfaces.forEach(el => el.style.display = 'block');
    
    // Show compatibility notice
    const notice = document.querySelector('.nemolore-compatibility-notice');
    if (notice) {
        notice.style.display = 'block';
    }
    
    // Set up fallback model container toggling
    setupFallbackModelToggling();
    
    // Set up fallback event bindings
    setupFallbackEventBindings();
}

function enableModernInterface() {
    // Hide fallback interface
    const fallbackInterfaces = document.querySelectorAll('.nemolore-fallback-interface');
    fallbackInterfaces.forEach(el => el.style.display = 'none');
    
    // Show modern interface
    const drawerInterfaces = document.querySelectorAll('.nemolore-drawer-interface');
    drawerInterfaces.forEach(el => el.style.display = 'block');
    
    // Hide compatibility notice
    const notice = document.querySelector('.nemolore-compatibility-notice');
    if (notice) {
        notice.style.display = 'none';
    }
}

// Set up model container toggling for fallback interface
function setupFallbackModelToggling() {
    const sourceSelect = document.getElementById('nemolore_vectorization_source_fallback');
    if (sourceSelect) {
        sourceSelect.addEventListener('change', (e) => {
            const source = e.target.value;
            const containers = document.querySelectorAll('[id*="nemolore_"][id*="_model_fallback_container"]');
            containers.forEach(container => {
                container.style.display = 'none';
            });
            
            const targetContainer = document.getElementById(`nemolore_${source}_model_fallback_container`);
            if (targetContainer) {
                targetContainer.style.display = 'block';
            }
        });
    }
}

// Set up event bindings for fallback interface
function setupFallbackEventBindings() {
    // This will mirror the main event bindings but for fallback controls
    const fallbackControls = {
        'nemolore_enabled_fallback': (e) => { nemoLoreSettings.enabled = e.target.checked; },
        'nemolore_highlight_fallback': (e) => { nemoLoreSettings.highlightNouns = e.target.checked; },
        'nemolore_auto_lorebook_fallback': (e) => { nemoLoreSettings.createLorebookOnChat = e.target.checked; },
        'nemolore_enable_summarization_fallback': (e) => { nemoLoreSettings.enableSummarization = e.target.checked; },
        'nemolore_enable_vectorization_fallback': (e) => { nemoLoreSettings.enableVectorization = e.target.checked; },
        'nemolore_force_compatibility_mode_fallback': (e) => { 
            nemoLoreSettings.forceCompatibilityMode = e.target.checked;
            if (e.target.checked) {
                toastr.info('Compatibility mode will take effect after reloading the page.');
            }
        }
    };
    
    Object.entries(fallbackControls).forEach(([id, handler]) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', (e) => {
                handler(e);
                saveSettings();
            });
        }
    });
}

async function initializeSettingsUI() {
    // Check UI compatibility and switch interfaces if needed
    const usingFallback = await checkUICompatibility();
    const suffix = usingFallback ? '_fallback' : '';
    
    // Helper function to get elements with or without fallback suffix
    const getElement = (id) => document.getElementById(id + suffix);
    
    // Set initial values for settings fields
    const enabledElement = getElement('nemolore_enabled');
    if (enabledElement) enabledElement.checked = nemoLoreSettings.enabled;
    const highlightElement = getElement('nemolore_highlight');
    if (highlightElement) highlightElement.checked = nemoLoreSettings.highlightNouns;
    
    const autoLorebookElement = getElement('nemolore_auto_lorebook');
    if (autoLorebookElement) autoLorebookElement.checked = nemoLoreSettings.createLorebookOnChat;
    
    const autoModeElement = getElement('nemolore_auto_mode');
    if (autoModeElement) autoModeElement.checked = nemoLoreSettings.autoMode;
    
    const updateIntervalElement = getElement('nemolore_update_interval');
    if (updateIntervalElement) updateIntervalElement.value = nemoLoreSettings.updateInterval;
    
    const notificationTimeoutElement = getElement('nemolore_notification_timeout');
    if (notificationTimeoutElement) notificationTimeoutElement.value = nemoLoreSettings.notificationTimeout;
    
    const enableSummarizationElement = getElement('nemolore_enable_summarization');
    if (enableSummarizationElement) enableSummarizationElement.checked = nemoLoreSettings.enableSummarization;
    
    const autoSummarizeElement = getElement('nemolore_auto_summarize');
    if (autoSummarizeElement) autoSummarizeElement.checked = nemoLoreSettings.autoSummarize;
    
    const connectionProfileElement = getElement('nemolore_connection_profile');
    if (connectionProfileElement) connectionProfileElement.value = nemoLoreSettings.connectionProfile;
    
    const completionPresetElement = getElement('nemolore_completion_preset');
    if (completionPresetElement) completionPresetElement.value = nemoLoreSettings.completionPreset;
    
    const prefillElement = getElement('nemolore_prefill');
    if (prefillElement) prefillElement.value = nemoLoreSettings.prefill;
    
    const summaryThresholdElement = getElement('nemolore_summary_threshold');
    if (summaryThresholdElement) summaryThresholdElement.value = nemoLoreSettings.summaryThreshold;
    
    const summaryMaxLengthElement = getElement('nemolore_summary_max_length');
    if (summaryMaxLengthElement) summaryMaxLengthElement.value = nemoLoreSettings.summaryMaxLength;
    
    const runningMemorySizeElement = getElement('nemolore_running_memory_size');
    if (runningMemorySizeElement) runningMemorySizeElement.value = nemoLoreSettings.runningMemorySize;
    
    const showSummariesElement = getElement('nemolore_show_summaries');
    if (showSummariesElement) showSummariesElement.checked = nemoLoreSettings.showSummariesInChat;
    
    const hideMessagesThresholdElement = getElement('nemolore_hide_messages_threshold');
    if (hideMessagesThresholdElement) hideMessagesThresholdElement.checked = nemoLoreSettings.hideMessagesWhenThreshold;
    
    const includeTimeLocationElement = getElement('nemolore_include_time_location');
    if (includeTimeLocationElement) includeTimeLocationElement.checked = nemoLoreSettings.includeTimeLocation;
    
    const includeNPCsElement = getElement('nemolore_include_npcs');
    if (includeNPCsElement) includeNPCsElement.checked = nemoLoreSettings.includeNPCs;
    
    const includeEventsElement = getElement('nemolore_include_events');
    if (includeEventsElement) includeEventsElement.checked = nemoLoreSettings.includeEvents;
    
    const includeDialogueElement = getElement('nemolore_include_dialogue');
    if (includeDialogueElement) includeDialogueElement.checked = nemoLoreSettings.includeDialogue;
    
    const forceCompatibilityModeElement = getElement('nemolore_force_compatibility_mode');
    if (forceCompatibilityModeElement) forceCompatibilityModeElement.checked = nemoLoreSettings.forceCompatibilityMode;

    // Core memory settings
    const enableCoreMemoriesElement = getElement('nemolore_enable_core_memories');
    if (enableCoreMemoriesElement) enableCoreMemoriesElement.checked = nemoLoreSettings.enableCoreMemories;
    
    const coreMemoryStartCountElement = getElement('nemolore_core_memory_start_count');
    if (coreMemoryStartCountElement) coreMemoryStartCountElement.value = nemoLoreSettings.coreMemoryStartCount;
    
    const coreMemoryPromptLorebookElement = getElement('nemolore_core_memory_prompt_lorebook');
    if (coreMemoryPromptLorebookElement) coreMemoryPromptLorebookElement.checked = nemoLoreSettings.coreMemoryPromptLorebook;
    
    const coreMemoryReplaceMessageElement = getElement('nemolore_core_memory_replace_message');
    if (coreMemoryReplaceMessageElement) coreMemoryReplaceMessageElement.checked = nemoLoreSettings.coreMemoryReplaceMessage;
    
    const coreMemoryAnimationDurationElement = getElement('nemolore_core_memory_animation_duration');
    if (coreMemoryAnimationDurationElement) coreMemoryAnimationDurationElement.value = nemoLoreSettings.coreMemoryAnimationDuration;

    // Vectorization settings
    const enableVectorizationElement = getElement('nemolore_enable_vectorization');
    if (enableVectorizationElement) enableVectorizationElement.checked = nemoLoreSettings.enableVectorization;
    
    const vectorizationSourceElement = getElement('nemolore_vectorization_source');
    if (vectorizationSourceElement) vectorizationSourceElement.value = nemoLoreSettings.vectorizationSource;
    
    const vectorSearchLimitElement = getElement('nemolore_vector_search_limit');
    if (vectorSearchLimitElement) vectorSearchLimitElement.value = nemoLoreSettings.vectorSearchLimit;
    
    const vectorSimilarityThresholdElement = getElement('nemolore_vector_similarity_threshold');
    if (vectorSimilarityThresholdElement) vectorSimilarityThresholdElement.value = nemoLoreSettings.vectorSimilarityThreshold;
    
    // Embedding model settings (only for non-fallback interface)
    if (!usingFallback) {
        const openaiModelElement = getElement('nemolore_openai_model');
        if (openaiModelElement) openaiModelElement.value = nemoLoreSettings.openaiModel;
        
        const googleModelElement = getElement('nemolore_google_model');
        if (googleModelElement) googleModelElement.value = nemoLoreSettings.googleModel;
        
        const cohereModelElement = getElement('nemolore_cohere_model');
        if (cohereModelElement) cohereModelElement.value = nemoLoreSettings.cohereModel;
        
        const ollamaModelElement = getElement('nemolore_ollama_model');
        if (ollamaModelElement) ollamaModelElement.value = nemoLoreSettings.ollamaModel;
        
        const vllmModelElement = getElement('nemolore_vllm_model');
        if (vllmModelElement) vllmModelElement.value = nemoLoreSettings.vllmModel;
    } else {
        // Initialize fallback model controls
        const fallbackOpenaiElement = document.getElementById('nemolore_openai_model_fallback');
        if (fallbackOpenaiElement) fallbackOpenaiElement.value = nemoLoreSettings.openaiModel;
        
        const fallbackGoogleElement = document.getElementById('nemolore_google_model_fallback');
        if (fallbackGoogleElement) fallbackGoogleElement.value = nemoLoreSettings.googleModel;
        
        const fallbackCohereElement = document.getElementById('nemolore_cohere_model_fallback');
        if (fallbackCohereElement) fallbackCohereElement.value = nemoLoreSettings.cohereModel;
        
        const fallbackOllamaElement = document.getElementById('nemolore_ollama_model_fallback');
        if (fallbackOllamaElement) fallbackOllamaElement.value = nemoLoreSettings.ollamaModel;
        
        const fallbackVllmElement = document.getElementById('nemolore_vllm_model_fallback');
        if (fallbackVllmElement) fallbackVllmElement.value = nemoLoreSettings.vllmModel;
    }
    
    // Show/hide model dropdowns based on selected source
    toggleVectorizationModelUI(nemoLoreSettings.vectorizationSource);

    // Bind settings events
    document.getElementById('nemolore_enabled').addEventListener('change', (e) => {
        nemoLoreSettings.enabled = e.target.checked;
        saveSettings();
        if (e.target.checked) {
            refreshChatHighlighting();
        } else {
            TooltipManager.hideTooltip();
            clearAllHighlighting();
        }
    });

    document.getElementById('nemolore_highlight').addEventListener('change', (e) => {
        nemoLoreSettings.highlightNouns = e.target.checked;
        saveSettings();
        if (e.target.checked) {
            refreshChatHighlighting();
        } else {
            TooltipManager.hideTooltip();
            clearAllHighlighting();
        }
    });

    document.getElementById('nemolore_auto_lorebook').addEventListener('change', (e) => {
        nemoLoreSettings.createLorebookOnChat = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_auto_mode').addEventListener('change', (e) => {
        nemoLoreSettings.autoMode = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_update_interval').addEventListener('input', (e) => {
        nemoLoreSettings.updateInterval = parseInt(e.target.value);
        saveSettings();
    });

    document.getElementById('nemolore_notification_timeout').addEventListener('input', (e) => {
        nemoLoreSettings.notificationTimeout = parseInt(e.target.value);
        saveSettings();
    });

    // Message Summarization settings
    document.getElementById('nemolore_enable_summarization').addEventListener('change', (e) => {
        nemoLoreSettings.enableSummarization = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_auto_summarize').addEventListener('change', (e) => {
        nemoLoreSettings.autoSummarize = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_connection_profile').addEventListener('change', (e) => {
        nemoLoreSettings.connectionProfile = e.target.value;
        saveSettings();
    });

    document.getElementById('nemolore_completion_preset').addEventListener('change', (e) => {
        nemoLoreSettings.completionPreset = e.target.value;
        saveSettings();
    });

    document.getElementById('nemolore_prefill').addEventListener('input', (e) => {
        nemoLoreSettings.prefill = e.target.value;
        saveSettings();
    });

    document.getElementById('nemolore_summary_threshold').addEventListener('input', (e) => {
        nemoLoreSettings.summaryThreshold = parseInt(e.target.value);
        saveSettings();
    });

    document.getElementById('nemolore_summary_max_length').addEventListener('input', (e) => {
        nemoLoreSettings.summaryMaxLength = parseInt(e.target.value);
        saveSettings();
    });

    document.getElementById('nemolore_running_memory_size').addEventListener('input', (e) => {
        nemoLoreSettings.runningMemorySize = parseInt(e.target.value);
        saveSettings();
        // Update enhanced memory injection when running memory size changes
        MessageSummarizer.enhancedMemoryInjection();
    });

    document.getElementById('nemolore_show_summaries').addEventListener('change', (e) => {
        nemoLoreSettings.showSummariesInChat = e.target.checked;
        saveSettings();
        if (e.target.checked) {
            MessageSummarizer.refreshSummaryDisplay();
        } else {
            const summaries = document.querySelectorAll('.nemolore-message-summary');
            summaries.forEach(s => s.remove());
        }
    });

    document.getElementById('nemolore_hide_messages_threshold').addEventListener('change', (e) => {
        nemoLoreSettings.hideMessagesWhenThreshold = e.target.checked;
        saveSettings();
        MessageSummarizer.enhancedMemoryInjection();
    });

    document.getElementById('nemolore_include_time_location').addEventListener('change', (e) => {
        nemoLoreSettings.includeTimeLocation = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_include_npcs').addEventListener('change', (e) => {
        nemoLoreSettings.includeNPCs = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_include_events').addEventListener('change', (e) => {
        nemoLoreSettings.includeEvents = e.target.checked;
        saveSettings();
    });

    document.getElementById('nemolore_include_dialogue').addEventListener('change', (e) => {
        nemoLoreSettings.includeDialogue = e.target.checked;
        saveSettings();
    });

    // Core memory settings event handlers
    document.getElementById('nemolore_enable_core_memories').addEventListener('change', (e) => {
        nemoLoreSettings.enableCoreMemories = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Core memories ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('nemolore_core_memory_start_count').addEventListener('input', (e) => {
        nemoLoreSettings.coreMemoryStartCount = parseInt(e.target.value);
        saveSettings();
        console.log(`[${MODULE_NAME}] Core memory start count changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_core_memory_prompt_lorebook').addEventListener('change', (e) => {
        nemoLoreSettings.coreMemoryPromptLorebook = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Core memory lorebook prompts ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('nemolore_core_memory_replace_message').addEventListener('change', (e) => {
        nemoLoreSettings.coreMemoryReplaceMessage = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Core memory message replacement ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('nemolore_core_memory_animation_duration').addEventListener('input', (e) => {
        nemoLoreSettings.coreMemoryAnimationDuration = parseInt(e.target.value);
        saveSettings();
        console.log(`[${MODULE_NAME}] Core memory animation duration changed to: ${e.target.value}ms`);
    });

    // Vectorization settings event handlers
    document.getElementById('nemolore_enable_vectorization').addEventListener('change', (e) => {
        nemoLoreSettings.enableVectorization = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Vectorization ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('nemolore_vectorization_source').addEventListener('change', (e) => {
        nemoLoreSettings.vectorizationSource = e.target.value;
        saveSettings();
        toggleVectorizationModelUI(e.target.value);
        console.log(`[${MODULE_NAME}] Vectorization source changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_vector_search_limit').addEventListener('input', (e) => {
        nemoLoreSettings.vectorSearchLimit = parseInt(e.target.value);
        saveSettings();
        console.log(`[${MODULE_NAME}] Vector search limit changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_vector_similarity_threshold').addEventListener('input', (e) => {
        nemoLoreSettings.vectorSimilarityThreshold = parseFloat(e.target.value);
        saveSettings();
        console.log(`[${MODULE_NAME}] Vector similarity threshold changed to: ${e.target.value}`);
    });

    // Embedding model event listeners
    document.getElementById('nemolore_openai_model').addEventListener('change', (e) => {
        nemoLoreSettings.openaiModel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] OpenAI model changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_google_model').addEventListener('change', (e) => {
        nemoLoreSettings.googleModel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Google model changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_cohere_model').addEventListener('change', (e) => {
        nemoLoreSettings.cohereModel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Cohere model changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_ollama_model').addEventListener('input', (e) => {
        nemoLoreSettings.ollamaModel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Ollama model changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_vllm_model').addEventListener('input', (e) => {
        nemoLoreSettings.vllmModel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] vLLM model changed to: ${e.target.value}`);
    });
    
    // Compatibility mode toggle (only bind if element exists - might be in fallback mode)
    const compatibilityToggle = document.getElementById('nemolore_force_compatibility_mode');
    if (compatibilityToggle) {
        compatibilityToggle.addEventListener('change', (e) => {
            nemoLoreSettings.forceCompatibilityMode = e.target.checked;
            saveSettings();
            if (e.target.checked) {
                toastr.info('Compatibility mode will take effect after reloading the page.');
            } else {
                toastr.info('Modern interface will be restored after reloading the page.');
            }
            console.log(`[${MODULE_NAME}] Compatibility mode ${e.target.checked ? 'enabled' : 'disabled'}`);
        });
    }

    // Populate dropdowns when SillyTavern is ready
    waitForSillyTavernReady();
}

// Wait for SillyTavern to be ready before populating dropdowns
async function waitForSillyTavernReady() {
    let attempts = 0;
    const maxAttempts = 20; // Wait up to 10 seconds (20 * 500ms)
    
    const checkReady = async () => {
        attempts++;
        console.log(`[${MODULE_NAME}] Checking SillyTavern readiness (attempt ${attempts}/${maxAttempts})`);
        console.log(`[${MODULE_NAME}] getContext available:`, typeof getContext);
        
        if (typeof getContext === 'function') {
            console.log(`[${MODULE_NAME}] SillyTavern is ready! Refreshing settings...`);
            
            // Use MessageSummarize approach - refresh settings
            refreshNemoLoreSettings();
            return;
        }
        
        if (attempts >= maxAttempts) {
            console.warn(`[${MODULE_NAME}] SillyTavern not ready after ${attempts} attempts. Hiding connection profile dropdown.`);
            $('#nemolore_connection_profile').parent().hide();
            
            // Still try to populate completion presets as they don't require getContext
            await updateCompletionPresetDropdown();
            return;
        }
        
        // Try again after 500ms
        setTimeout(checkReady, 500);
    };
    
    checkReady();
}

// Load settings HTML
async function loadSettingsHTML() {
    try {
        const response = await fetch('/scripts/extensions/third-party/Nemo-Lore/settings.html');
        if (!response.ok) {
            console.error(`[${MODULE_NAME}] Failed to load settings.html: ${response.status}`);
            return false;
        }
        const settingsHtml = await response.text();
        $('#extensions_settings2').append(settingsHtml);
        console.log(`[${MODULE_NAME}] Settings HTML loaded successfully`);
        return true;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error loading settings HTML:`, error);
        return false;
    }
}

// Inject CSS styles for core memory animations and tooltips
function injectCoreMemoryStyles() {
    const styleId = 'nemolore-styles';
    
    // Don't inject if already exists
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Tooltip Styles */
        .nemolore-tooltip {
            position: absolute;
            background: rgba(40, 44, 52, 0.95);
            color: #ffffff;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 250px;
            min-width: 200px;
            z-index: 9999;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
            pointer-events: none;
        }
        
        .nemolore-tooltip.show {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        
        .nemolore-tooltip-title {
            font-weight: 600;
            font-size: 15px;
            margin-bottom: 6px;
            color: #61dafb;
            border-bottom: 1px solid rgba(97, 218, 251, 0.3);
            padding-bottom: 4px;
        }
        
        .nemolore-tooltip-content {
            font-size: 13px;
            line-height: 1.4;
            color: #e6e6e6;
        }
        
        .nemolore-tooltip-related {
            font-size: 12px;
            color: #ffa726;
            font-style: italic;
            margin-bottom: 4px;
        }
        
        .nemolore-tooltip-create, .nemolore-tooltip-no-entry {
            font-size: 11px;
            color: #81c784;
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(129, 199, 132, 0.3);
        }
        
        .nemolore-tooltip-partial {
            border-left: 3px solid #ffa726;
        }
        
        /* Mobile tooltip styles */
        .nemolore-tooltip.mobile-active {
            position: fixed !important;
            bottom: 20px;
            left: 10px;
            right: 10px;
            width: calc(100vw - 20px) !important;
            max-width: none;
            min-width: none;
            transform: translateY(100px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
        }
        
        .nemolore-tooltip.mobile-active.show {
            transform: translateY(0);
        }
        
        /* Tooltip arrows */
        .nemolore-tooltip.above::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            margin-left: -6px;
            border-width: 6px 6px 0;
            border-style: solid;
            border-color: rgba(40, 44, 52, 0.95) transparent transparent;
        }
        
        .nemolore-tooltip.below::after {
            content: '';
            position: absolute;
            bottom: 100%;
            left: 50%;
            margin-left: -6px;
            border-width: 0 6px 6px;
            border-style: solid;
            border-color: transparent transparent rgba(40, 44, 52, 0.95);
        }
        
        /* Enhanced highlighted noun styles for mobile */
        .nemolore-highlighted-noun {
            padding: 2px 4px;
            margin: -1px;
            border-radius: 4px;
            transition: all 0.2s ease;
            cursor: pointer;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
            position: relative;
            outline: none;
            /* Accessibility improvements */
            role: button;
            tabindex: 0;
        }
        
        .nemolore-highlighted-noun:focus {
            outline: 2px solid #61dafb;
            outline-offset: 2px;
        }
        
        @media (max-width: 768px) {
            .nemolore-highlighted-noun {
                padding: 4px 6px;
                margin: -2px;
                min-height: 44px; /* iOS touch target minimum */
                display: inline-flex;
                align-items: center;
                border-radius: 6px;
            }
        }
        
        .nemolore-highlighted-noun:hover,
        .nemolore-highlighted-noun:focus {
            transform: scale(1.05);
            box-shadow: 0 2px 8px rgba(97, 218, 251, 0.3);
        }
        
        /* Core Memory Animations */
        @keyframes nemolore-golden-pulse {
            0% { transform: scale(1); box-shadow: 0 0 10px rgba(255, 215, 0, 0.6); }
            50% { transform: scale(1.05); box-shadow: 0 0 20px rgba(255, 215, 0, 0.9); }
            100% { transform: scale(1); box-shadow: 0 0 10px rgba(255, 215, 0, 0.6); }
        }
        
        @keyframes nemolore-sparkle-float {
            0% { 
                opacity: 0; 
                transform: translateY(0px) scale(0.5) rotate(0deg); 
            }
            25% { 
                opacity: 1; 
                transform: translateY(-10px) scale(1) rotate(90deg); 
            }
            75% { 
                opacity: 0.8; 
                transform: translateY(-20px) scale(0.8) rotate(270deg); 
            }
            100% { 
                opacity: 0; 
                transform: translateY(-30px) scale(0.3) rotate(360deg); 
            }
        }
        
        @keyframes nemolore-shimmer {
            0% { background-position: -200% center; }
            100% { background-position: 200% center; }
        }
        
        /* Core Memory Badge Styling */
        .nemolore-core-memory .nemolore-core-badge {
            background: linear-gradient(45deg, #ffd700, #ffed4e, #ffd700) !important;
            background-size: 200% auto !important;
            color: #8b4513 !important;
            border: 2px solid #ffc107 !important;
            box-shadow: 0 0 15px rgba(255, 215, 0, 0.7) !important;
            animation: nemolore-golden-pulse 2s infinite, nemolore-shimmer 3s infinite linear !important;
            font-weight: bold !important;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.3) !important;
        }
        
        .nemolore-core-memory .nemolore-core-badge:hover {
            background: linear-gradient(45deg, #ffed4e, #ffd700, #ffed4e) !important;
            box-shadow: 0 0 25px rgba(255, 215, 0, 0.9) !important;
            transform: scale(1.1) !important;
        }
        
        /* Sparkle Effect Styling */
        .nemolore-sparkle-container {
            z-index: 1000;
        }
        
        .nemolore-sparkle {
            font-size: 12px;
            color: #ffd700;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.8);
            filter: drop-shadow(0 0 3px #ffd700);
            user-select: none;
            pointer-events: none;
        }
        
        /* Enhanced regular summary badge */
        .nemolore-summary-badge {
            display: inline-block;
            padding: 2px 6px;
            background: linear-gradient(45deg, #6c757d, #868e96);
            color: white;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            border: 1px solid #495057;
            cursor: pointer;
            transition: all 0.3s ease;
            user-select: none;
        }
        
        .nemolore-summary-badge:hover {
            background: linear-gradient(45deg, #495057, #6c757d);
            transform: scale(1.05);
        }
        
        /* Summary indicator positioning */
        .nemolore-summary-indicator {
            position: relative;
            display: inline-block;
            margin-right: 5px;
            z-index: 100;
        }
        
        /* Core memory special glow effect */
        .nemolore-core-memory {
            position: relative;
        }
        
        .nemolore-core-memory::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, transparent, rgba(255, 215, 0, 0.2), transparent);
            border-radius: 15px;
            z-index: -1;
            animation: nemolore-shimmer 2s infinite linear;
        }
    `;
    
    document.head.appendChild(style);
    console.log(`[${MODULE_NAME}] NemoLore styles injected (tooltips + core memory + mobile support)`);
    
    // Add mobile-responsive settings styles
    injectMobileSettingsStyles();
}

// Extension initialization
// Inject mobile-responsive settings styles
function injectMobileSettingsStyles() {
    const mobileStyleId = 'nemolore-mobile-settings';
    if (document.getElementById(mobileStyleId)) return;
    
    const style = document.createElement('style');
    style.id = mobileStyleId;
    style.textContent = `
        /* Mobile-responsive settings panel */
        @media (max-width: 768px) {
            .nemolore_settings .flex-container {
                flex-direction: column;
                gap: 8px;
            }
            
            .nemolore_settings label {
                font-size: 14px;
                margin-bottom: 4px;
                display: block;
            }
            
            .nemolore_settings .text_pole,
            .nemolore_settings select,
            .nemolore_settings input[type="number"] {
                font-size: 16px; /* Prevent zoom on iOS */
                padding: 8px 12px;
                min-height: 44px;
                width: 100%;
                box-sizing: border-box;
            }
            
            .nemolore_settings .checkbox_label {
                padding: 8px 0;
                min-height: 44px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .nemolore_settings input[type="checkbox"] {
                width: 20px;
                height: 20px;
                flex-shrink: 0;
            }
            
            .nemolore_settings .inline-drawer-content {
                padding: 12px;
            }
            
            .nemolore_settings small {
                font-size: 13px;
                line-height: 1.4;
                margin: 8px 0;
                display: block;
            }
        }
        
        /* Touch-friendly button styles */
        .nemolore_settings .menu_button,
        .nemolore-popup-buttons .menu_button {
            min-height: 44px;
            padding: 8px 16px;
            touch-action: manipulation;
            font-size: 14px;
        }
        
        /* Fallback interface styling */
        .nemolore-fallback-interface {
            margin: 10px 0;
        }
        
        .nemolore-fallback-interface details {
            margin: 10px 0;
            border: 1px solid #ccc;
            border-radius: 5px;
            padding: 10px;
            background: #f9f9f9;
        }
        
        .nemolore-fallback-interface summary {
            font-weight: bold;
            cursor: pointer;
            padding: 5px 0;
            user-select: none;
        }
        
        .nemolore-fallback-interface summary:hover {
            background: rgba(0, 0, 0, 0.05);
        }
        
        .nemolore-settings-section {
            margin: 10px 0;
        }
        
        .nemolore-settings-section label {
            display: block;
            margin: 8px 0;
            line-height: 1.4;
        }
        
        .nemolore-settings-section input[type="checkbox"] {
            margin-right: 8px;
        }
        
        .nemolore-settings-section select,
        .nemolore-settings-section input[type="text"],
        .nemolore-settings-section input[type="number"] {
            padding: 4px 6px;
            border: 1px solid #ccc;
            border-radius: 3px;
            font-family: inherit;
        }
        
        .nemolore-compatibility-notice {
            background: #e3f2fd;
            border: 1px solid #2196f3;
            border-radius: 4px;
            padding: 8px;
            margin: 10px 0;
        }
        
        .nemolore-compatibility-notice small {
            color: #1976d2;
        }
        
        /* Improved modal popups for mobile */
        @media (max-width: 768px) {
            .popup {
                width: calc(100vw - 20px) !important;
                max-width: none !important;
                margin: 10px;
                max-height: calc(100vh - 40px);
                overflow-y: auto;
            }
            
            .nemolore-entry-content {
                font-size: 14px;
                line-height: 1.5;
                max-height: 200px;
                overflow-y: auto;
            }
            
            .nemolore-popup-buttons {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-top: 16px;
            }
            
            .nemolore-popup-buttons .menu_button {
                width: 100%;
            }
        }
    `;
    
    document.head.appendChild(style);
    console.log(`[${MODULE_NAME}] Mobile settings styles injected`);
}

async function init() {
    if (isInitialized) return;

    console.log(`[${MODULE_NAME}] Initializing...`);
    
    loadSettings();
    setupEventHandlers();
    injectCoreMemoryStyles();
    
    // Load settings HTML and then initialize
    const settingsLoaded = await loadSettingsHTML();
    if (settingsLoaded) {
        // Wait a moment for DOM to update, then initialize settings
        setTimeout(() => {
            initializeSettingsUI();
        }, 100);
    }
    
    // Load summaries for current chat after a short delay to ensure everything is ready
    setTimeout(() => {
        MessageSummarizer.loadSummariesFromPersistentStorage();
        
        // Clean up old summaries periodically
        MessageSummarizer.cleanupOldSummaries();
    }, 1000);
    
    isInitialized = true;
    console.log(`[${MODULE_NAME}] Initialized successfully`);
}

// Extension lifecycle - SillyTavern will call this automatically
jQuery(() => {
    init();
});

export { MODULE_NAME };
