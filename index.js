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
    main_api,
    getRequestHeaders
} from '../../../../script.js';
import { model_list as openai_model_list } from '../../../openai.js';
import { selected_group } from '../../../group-chats.js';
import { extension_settings, renderExtensionTemplateAsync, writeExtensionField, getContext } from '../../../extensions.js';
import { MacrosParser } from '../../../macros.js';
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

// Debug configuration - Set to false for production to reduce console spam
const DEBUG_MODE = false; // Change to true for development debugging
const debugLog = DEBUG_MODE ? console.log : () => {};
const debugWarn = DEBUG_MODE ? console.warn : () => {};
const debugError = console.error; // Always keep error logging

// State management - Encapsulate global variables for better organization
const NemoLoreState = {
    // Extension state
    isInitialized: false,
    currentChatLorebook: null,
    lastHandledChatId: null,
    loadedSummariesChatId: null,
    messageCount: 0,
    totalChatTokens: 0,
    
    // Processing flags
    isProcessingSummaries: false,
    isLorebookCreationInProgress: false,
    isProcessingCoreMemory: false,
    isVectorizationEnabled: false,
    
    // Data collections
    messageSummaries: new Map(),
    vectorizedMessages: new Map(),
    highlightedNouns: new Set(),
    processedMessages: new WeakSet(),
    summaryProcessingQueue: [],
    
    // Timeout tracking for cleanup
    summaryTimeoutIds: new Set(),
    pairedSummaryTimeoutIds: new Set(),
    
    // UI elements
    currentTooltip: null,
    messageObserver: null,
    
    // Reset state method
    reset() {
        this.isProcessingSummaries = false;
        this.isLorebookCreationInProgress = false;
        this.isProcessingCoreMemory = false;
        this.summaryProcessingQueue.length = 0;
        this.messageSummaries.clear();
        this.vectorizedMessages.clear();
        this.highlightedNouns.clear();
        this.totalChatTokens = 0;
        this.clearTimeouts();
    },
    
    // Clear all pending timeouts
    clearTimeouts() {
        this.summaryTimeoutIds.forEach(id => clearTimeout(id));
        this.summaryTimeoutIds.clear();
        this.pairedSummaryTimeoutIds.forEach(id => clearTimeout(id));
        this.pairedSummaryTimeoutIds.clear();
    },
    
    // Add timeout with tracking for automatic cleanup
    addTimeout(callback, delay, timeoutType = 'summary') {
        const timeoutId = setTimeout(() => {
            try {
                callback();
            } catch (error) {
                debugError(`[${MODULE_NAME}] Error in timeout callback:`, error);
            } finally {
                // Auto-cleanup from tracking sets
                this.summaryTimeoutIds.delete(timeoutId);
                this.pairedSummaryTimeoutIds.delete(timeoutId);
            }
        }, delay);
        
        if (timeoutType === 'paired') {
            this.pairedSummaryTimeoutIds.add(timeoutId);
        } else {
            this.summaryTimeoutIds.add(timeoutId);
        }
        
        return timeoutId;
    },
    
    // Error recovery system - reset stuck flags after timeout
    initErrorRecovery() {
        // Reset stuck processing flags every 5 minutes
        setInterval(() => {
            if (this.isProcessingSummaries && this.summaryProcessingQueue.length === 0) {
                debugWarn(`[${MODULE_NAME}] Detected stuck isProcessingSummaries flag, clearing...`);
                this.isProcessingSummaries = false;
            }
            
            if (this.isLorebookCreationInProgress) {
                debugWarn(`[${MODULE_NAME}] Detected stuck isLorebookCreationInProgress flag, clearing...`);
                this.isLorebookCreationInProgress = false;
            }
            
            if (this.isProcessingCoreMemory) {
                debugWarn(`[${MODULE_NAME}] Detected stuck isProcessingCoreMemory flag, clearing...`);
                this.isProcessingCoreMemory = false;
            }
        }, 300000); // 5 minutes
    }
};

// Macro constants for summary injection
const NEMOLORE_MACRO = 'NemoLore';
const NEMOLORE_LOREBOOK_PREFIX = '_NemoLore_';

// Utility function for getting elements (with fallback)
function getElement(id) {
    return document.getElementById(id) || document.getElementById(id + '_fallback');
}

// NemoLore Macro Function for Summary Injection
function getNemoLoreSummaries() {
    if (!nemoLoreSettings.enableSummarization) return '';
    
    // Get current chat summaries in order
    const chatId = getCurrentChatId();
    if (!chatId) return '';
    
    const summariesInOrder = [];
    const context = getContext();
    if (!context || !context.chat) return '';
    
    // Collect summaries in message order
    for (let i = 0; i < context.chat.length; i++) {
        if (messageSummaries.has(i)) {
            const summaryData = messageSummaries.get(i);
            if (summaryData && summaryData.text) {
                // Format each summary with context
                let formattedSummary = summaryData.text;
                
                // Add pairing info if applicable
                if (summaryData.isPaired && summaryData.pairedIndices) {
                    const indices = summaryData.pairedIndices;
                    if (indices.length > 1) {
                        formattedSummary = `[Messages ${indices.join('+')}] ${formattedSummary}`;
                    }
                }
                
                // Add core memory indicator
                if (summaryData.isCoreMemory) {
                    formattedSummary = `⭐ ${formattedSummary}`;
                }
                
                summariesInOrder.push(formattedSummary);
            }
        }
    }
    
    if (summariesInOrder.length === 0) return '';
    
    // Format the complete summary injection
    const summaryText = summariesInOrder.join('\n\n');
    
    // Enhanced memory injection formatting with better AI context
    const currentTime = new Date().toLocaleString();
    const chatLength = context.chat.length;
    
    // Check if we should hide messages past the threshold
    if (nemoLoreSettings.hideMessagesWhenThreshold && chatLength > nemoLoreSettings.runningMemorySize) {
        const hiddenCount = chatLength - nemoLoreSettings.runningMemorySize;
        const visibleCount = nemoLoreSettings.runningMemorySize;
        
        return `[AI MEMORY SYSTEM - Conversation Context]
📅 Updated: ${currentTime}
📊 Total Messages: ${chatLength} (${hiddenCount} summarized, ${visibleCount} recent messages visible)
🧠 Memory Type: Compressed summaries of previous conversation events

PREVIOUS CONVERSATION CONTEXT (AI Memory):
${summaryText}

[End of Memory Context - Recent messages follow below]`;
    }
    
    return `[AI MEMORY SYSTEM - Conversation Summaries]
📅 Generated: ${currentTime}  
📊 ${summariesInOrder.length} memory entries from ${chatLength} total messages
🧠 Context: Key conversation moments preserved for continuity

CONVERSATION MEMORY:
${summaryText}

[End of Conversation Memory]`;
}

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
    prefill: '<think>\n\n</think>', // Default prefill for summarization
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
    
    // New paired message summarization settings
    enablePairedSummarization: true, // Group user+AI message pairs together
    linkSummariesToAI: true,        // Only link summaries to AI messages, not user messages
    
    // Automatic lorebook creation (independent of Lorebook Manager)
    autoCreateLorebook: true,       // Automatically create lorebook for new chats
    
    // Persistent storage for summaries (per chat)
    chatSummaries: {},       // { chatId: { messageIndex: summaryData } }
    
    // Core memory system settings
    enableCoreMemories: true,          // Enable core memory detection
    coreMemoryStartCount: 20,          // Start checking for core memories after N messages
    coreMemoryPromptLorebook: true,    // Prompt user to create lorebook entries for core memories
    coreMemoryReplaceMessage: true,    // Replace original message with core memory when aging out
    coreMemoryAnimationDuration: 2000, // Duration of golden animation in ms
    
    // Multi-tier memory system settings
    enableMultiTierMemory: true,       // Enable hierarchical memory organization
    memoryTokenLimit: 2000,            // Maximum tokens for memory injection
    memoryTierWeights: {               // Importance weights for each tier
        immediate: 1.0,
        shortTerm: 0.8, 
        mediumTerm: 0.6,
        longTerm: 0.9,
        permanent: 1.0
    },

    // Cross-chat character persistence settings
    enableCrossChatPersistence: false, // Enable character memory across different chats (OPTIONAL)
    crossChatMemoryScope: 'character', // Scope: 'character', 'user', or 'global'
    maxCrossChatMemories: 50,          // Maximum memories to store per character
    crossChatDecayDays: 90,            // Days before cross-chat memories start decaying
    enableCrossChatPrivacy: true,      // Respect privacy - don't share sensitive conversations
    crossChatSharingLevel: 'traits',   // What to share: 'none', 'traits', 'relationships', 'all'

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
    vllmModel: '', // vLLM embedding model
    
    // Async API Settings
    enableAsyncApi: false,
    asyncApiProvider: '',
    asyncApiKey: '',
    asyncApiModel: '',
    asyncApiEndpoint: ''
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
let lastHandledChatId = null; // Track the last chat ID we processed to prevent duplicate handling
let loadedSummariesChatId = null; // Track which chat's summaries are currently loaded in messageSummaries
// Context injection system replaces visual hiding - messages excluded from AI context but visible to user
let totalChatTokens = 0; // Track total token count for threshold checking

// Vectorization system for excluded messages
let vectorizedMessages = new Map(); // Track vectorized message hashes by index
let isVectorizationEnabled = false; // Flag to enable/disable vectorization

// Lorebook creation flow control
let isLorebookCreationInProgress = false;

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

    static showProgress(title, steps = []) {
        return new ProgressNotification(title, steps);
    }
}

class ProgressNotification {
    constructor(title, steps = []) {
        this.title = title;
        this.steps = steps;
        this.currentStep = 0;
        this.notification = null;
        this.progressBar = null;
        this.progressText = null;
        this.stepText = null;
        this.isComplete = false;
        this.create();
    }

    create() {
        this.notification = document.createElement('div');
        this.notification.className = 'nemolore-notification nemolore-progress-notification';
        this.notification.innerHTML = `
            <div class="nemolore-notification-content">
                <h4 style="margin: 0 0 10px 0; color: #6b46c1;">🌍 ${this.title}</h4>
                <div class="nemolore-progress-container">
                    <div class="nemolore-progress-bar">
                        <div class="nemolore-progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="nemolore-progress-text">0%</div>
                </div>
                <div class="nemolore-progress-step">Initializing...</div>
            </div>
        `;

        this.progressBar = this.notification.querySelector('.nemolore-progress-fill');
        this.progressText = this.notification.querySelector('.nemolore-progress-text');
        this.stepText = this.notification.querySelector('.nemolore-progress-step');

        document.body.appendChild(this.notification);
    }

    updateProgress(stepIndex, stepMessage = null) {
        if (this.isComplete) return;

        this.currentStep = stepIndex;
        const progress = Math.min(100, Math.round((stepIndex / Math.max(1, this.steps.length)) * 100));
        
        this.progressBar.style.width = `${progress}%`;
        this.progressText.textContent = `${progress}%`;
        
        if (stepMessage) {
            this.stepText.textContent = stepMessage;
        } else if (this.steps[stepIndex]) {
            this.stepText.textContent = this.steps[stepIndex];
        }
    }

    setCustomMessage(message) {
        if (this.stepText) {
            this.stepText.textContent = message;
        }
    }

    complete(finalMessage = 'Complete!') {
        if (this.isComplete) return;
        
        this.isComplete = true;
        this.progressBar.style.width = '100%';
        this.progressText.textContent = '100%';
        this.stepText.textContent = finalMessage;
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            this.remove();
        }, 3000);
    }

    error(errorMessage) {
        if (!this.notification) return;
        
        this.progressBar.style.backgroundColor = '#dc3545';
        this.progressText.textContent = 'Error';
        this.stepText.textContent = errorMessage;
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            this.remove();
        }, 5000);
    }

    remove() {
        if (this.notification && this.notification.parentNode) {
            this.notification.remove();
        }
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
            const match = quotedMatch[1].trim(); // quotedMatch[1] is the captured group inside the quotes
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
                console.log(`[${MODULE_NAME}] Successfully applied highlighting, HTML updated`);
                
                // Verify the highlighting was applied
                setTimeout(() => {
                    const spans = element.querySelectorAll('.nemolore-highlighted-noun');
                    console.log(`[${MODULE_NAME}] Verification: ${spans.length} highlighted spans found in DOM`);
                    if (spans.length === 0) {
                        console.error(`[${MODULE_NAME}] ISSUE: Highlighting disappeared after applying!`);
                    }
                }, 50);
            } else {
                console.error(`[${MODULE_NAME}] Generated invalid HTML, reverting to original`);
                element.innerHTML = originalHtml;
                element.setAttribute('data-nemolore-processed', 'true');
            }
        } else {
            console.log(`[${MODULE_NAME}] No highlighting applied`);
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

    static async generateInitialEntries(characterData, lorebookName, progressCallback = null) {
        if (!characterData) {
            console.error(`[${MODULE_NAME}] No character data provided`);
            return;
        }

        if (!lorebookName) {
            console.error(`[${MODULE_NAME}] No lorebook name provided`);
            return;
        }

        console.log(`[${MODULE_NAME}] Starting generation for character: ${characterData.name}, lorebook: ${lorebookName}`);
        
        // Update progress
        if (progressCallback) progressCallback(0, 'Building generation prompt...');
        
        const prompt = this.buildInitialGenerationPrompt(characterData);
        console.log(`[${MODULE_NAME}] Generated prompt length: ${prompt.length} characters`);
        
        // Update progress
        if (progressCallback) progressCallback(1, 'Sending request to AI...');
        
        try {
            let response;
            
            // Check if async API is configured and enabled
            if (nemoLoreSettings.enableAsyncApi && 
                nemoLoreSettings.asyncApiProvider && 
                nemoLoreSettings.asyncApiKey && 
                nemoLoreSettings.asyncApiModel) {
                
                console.log(`[${MODULE_NAME}] === ASYNC API CALL START ===`);
                console.log(`[${MODULE_NAME}] Using Async API for lorebook generation`);
                console.log(`[${MODULE_NAME}] Provider: ${nemoLoreSettings.asyncApiProvider}`);
                console.log(`[${MODULE_NAME}] Model: ${nemoLoreSettings.asyncApiModel}`);
                console.log(`[${MODULE_NAME}] Prompt length: ${prompt.length} characters`);
                console.log(`[${MODULE_NAME}] Prompt preview:`, prompt.substring(0, 300) + '...');
                
                const startTime = Date.now();
                response = await AsyncAPI.makeRequest(
                    nemoLoreSettings.asyncApiProvider,
                    nemoLoreSettings.asyncApiKey,
                    nemoLoreSettings.asyncApiModel,
                    prompt,
                    nemoLoreSettings.asyncApiEndpoint
                );
                const duration = Date.now() - startTime;
                
                console.log(`[${MODULE_NAME}] === ASYNC API CALL COMPLETE ===`);
                console.log(`[${MODULE_NAME}] Async API response received in ${duration}ms`);
                console.log(`[${MODULE_NAME}] Response length: ${response?.length || 0} characters`);
                console.log(`[${MODULE_NAME}] Response preview:`, response?.substring(0, 300) + '...');
                
            } else {
                console.log(`[${MODULE_NAME}] === SILLYTAVERN API CALL START ===`);
                console.log(`[${MODULE_NAME}] Async API not configured, using SillyTavern generateQuietPrompt`);
                console.log(`[${MODULE_NAME}] Prompt length: ${prompt.length} characters`);
                console.log(`[${MODULE_NAME}] Prompt preview:`, prompt.substring(0, 300) + '...');
                
                const startTime = Date.now();
                response = await generateQuietPrompt(prompt, false);
                const duration = Date.now() - startTime;
                
                console.log(`[${MODULE_NAME}] === SILLYTAVERN API CALL COMPLETE ===`);
                console.log(`[${MODULE_NAME}] SillyTavern API response received in ${duration}ms`);
                console.log(`[${MODULE_NAME}] Response length: ${response?.length || 0} characters`);
                console.log(`[${MODULE_NAME}] Response preview:`, response?.substring(0, 300) + '...');
            }
            
            // Update progress
            if (progressCallback) progressCallback(2, 'Processing AI response...');
            
            if (!response || response.trim().length === 0) {
                console.error(`[${MODULE_NAME}] ERROR: Empty response from API`);
                throw new Error('Received empty response from AI API');
            }
            
            // Update progress
            if (progressCallback) progressCallback(3, 'Parsing lorebook entries...');
            
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
            
            // Update progress
            if (progressCallback) progressCallback(4, `Adding ${entries.length} entries to lorebook...`);
            
            await this.addEntriesToLorebook(lorebookName, entries);
            console.log(`[${MODULE_NAME}] Successfully generated ${entries.length} initial entries`);
            
            // Update progress - complete
            if (progressCallback) progressCallback(5, `Successfully created ${entries.length} lorebook entries!`);
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
        console.log(`[${MODULE_NAME}] findEntryForNoun called for "${noun}". currentChatLorebook:`, currentChatLorebook);
        if (!currentChatLorebook) {
            console.log(`[${MODULE_NAME}] No currentChatLorebook set, returning null`);
            return null;
        }
        
        try {
            console.log(`[${MODULE_NAME}] Loading world info for lorebook: ${currentChatLorebook}`);
            const worldInfo = await loadWorldInfo(currentChatLorebook);
            console.log(`[${MODULE_NAME}] Loaded worldInfo:`, worldInfo ? `${Object.keys(worldInfo.entries || {}).length} entries` : 'null');
            if (!worldInfo || !worldInfo.entries) {
                console.log(`[${MODULE_NAME}] No worldInfo or entries found`);
                return null;
            }
            
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
        const speaker = message.name || (message.is_user ? 'User' : 'Assistant');
        
        // Enhanced context-aware prompt
        let prompt = `You are an advanced narrative memory system for AI assistants. Analyze this roleplay message and create a structured summary for long-term memory storage.

CONVERSATION CONTEXT:
- Current Speaker: ${speaker}
- Previous Context: ${chatContext?.length > 0 ? 'Available' : 'None'}
- Setting Context: ${locationContext || 'Unknown location'}
- Time Context: ${timeContext || 'Unspecified time'}
- NPCs Present: ${npcContext || 'None specified'}

ENHANCED SUMMARIZATION REQUIREMENTS:
- Maximum ${nemoLoreSettings.summaryMaxLength} tokens
- Rate importance (1-10) based on character development, plot significance, and emotional impact
- Identify key topics/themes for categorization
- Note character relationships and dynamics
- Preserve emotional tone and context
- Use past tense, factual but engaging tone
- Focus on memorable moments that shape future interactions

ANALYSIS CATEGORIES:
1. CHARACTER DEVELOPMENT: How does this advance character growth?
2. PLOT SIGNIFICANCE: Does this advance the story or reveal important information?  
3. RELATIONSHIP DYNAMICS: How do character relationships change or develop?
4. WORLD BUILDING: What new information about the setting is revealed?
5. EMOTIONAL IMPACT: What emotional moments or tensions are present?

FORMAT YOUR RESPONSE AS:
[Importance: X/10] [Topics: topic1, topic2, topic3] [Characters: character1, character2] [Tone: emotional_tone]
${nemoLoreSettings.includeTimeLocation ? '[Context: time/location if relevant] ' : ''}Summary content here...`;

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

    static async extractContextFromChat(messageIndex, pairedIndices = null) {
        // Check if getContext is available (it's a global function)
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] getContext not available, cannot extract context`);
            return { timeContext: null, locationContext: null, npcContext: [] };
        }
        
        const context = getContext();
        if (!context || !context.chat) {
            console.warn(`[${MODULE_NAME}] Invalid context, cannot extract context`);
            return { timeContext: null, locationContext: null, npcContext: [] };
        }
        
        // Determine which messages to analyze
        const messagesToAnalyze = pairedIndices || [messageIndex];
        console.log(`[${MODULE_NAME}] Extracting context for messages: ${messagesToAnalyze.join('+')}`);
        
        // Validate all message indices
        for (const idx of messagesToAnalyze) {
            if (!context.chat[idx]) {
                console.warn(`[${MODULE_NAME}] Message ${idx} not found, cannot extract context`);
                return { timeContext: null, locationContext: null, npcContext: [] };
            }
        }
        
        let timeContext = null;
        let locationContext = null;
        let npcContext = [];

        try {
            // Extract time context (look for time-related patterns in target messages and recent context)
            const maxContextIndex = Math.max(...messagesToAnalyze);
            for (let i = Math.max(0, maxContextIndex - 5); i <= maxContextIndex; i++) {
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
                        timeContext = match[0]; // Get the matched text, not the array
                        console.log(`[${MODULE_NAME}] Found time context: "${timeContext}" from message ${i}: "${msg.mes.substring(0, 100)}..."`);
                        break;
                    }
                }
                if (timeContext) break; // Stop at first match
            }

            // Extract location context from lorebook entries and message content
            console.log(`[${MODULE_NAME}] Checking lorebook for location context. currentChatLorebook:`, currentChatLorebook);
            if (currentChatLorebook) {
                try {
                    const worldInfo = await loadWorldInfo(currentChatLorebook);
                    console.log(`[${MODULE_NAME}] Loaded world info:`, worldInfo ? `${Object.keys(worldInfo.entries || {}).length} entries` : 'null');
                    if (worldInfo && worldInfo.entries && Object.keys(worldInfo.entries).length > 0) {
                    for (const [uid, entry] of Object.entries(worldInfo.entries)) {
                        if (!entry || !entry.key) continue;
                        
                        // Check if this entry represents a location
                        const isLocation = entry.key.some(keyword => 
                            /\b(house|building|room|street|city|town|park|restaurant|cafe|store|office|school|hospital)\b/i.test(keyword) ||
                            entry.content.toLowerCase().includes('location') ||
                            entry.content.toLowerCase().includes('place')
                        );
                        
                        if (isLocation) {
                            // Check if location is mentioned in any of the target messages
                            let mentionedInMessages = false;
                            let mentionedInMessageIndex = -1;
                            
                            for (const idx of messagesToAnalyze) {
                                const message = context.chat[idx];
                                if (message && entry.key.some(keyword =>
                                    message.mes.toLowerCase().includes(keyword.toLowerCase())
                                )) {
                                    mentionedInMessages = true;
                                    mentionedInMessageIndex = idx;
                                    break;
                                }
                            }
                            
                            if (mentionedInMessages) {
                                locationContext = entry.title || (entry.key && entry.key[0]);
                                console.log(`[${MODULE_NAME}] Found location context: "${locationContext}" from message ${mentionedInMessageIndex}`);
                                break;
                            }
                        }
                    }
                    } else {
                        console.log(`[${MODULE_NAME}] Lorebook loaded but contains no entries - location context extraction skipped`);
                    }
                } catch (lorebookError) {
                    console.warn(`[${MODULE_NAME}] Error loading lorebook for location context:`, lorebookError);
                }
            } else {
                console.log(`[${MODULE_NAME}] No lorebook assigned - location context extraction skipped`);
            }

            // Extract NPCs from highlighted nouns and lorebook (analyze all messages in pair)
            const allDetectedNouns = new Set();
            
            for (const idx of messagesToAnalyze) {
                const message = context.chat[idx];
                if (message) {
                    const detectedNouns = NounDetector.detectNouns(message.mes);
                    console.log(`[${MODULE_NAME}] Detected ${detectedNouns.length} nouns from message ${idx}:`, detectedNouns);
                    detectedNouns.forEach(noun => allDetectedNouns.add(noun));
                }
            }
            
            console.log(`[${MODULE_NAME}] Total unique nouns for NPC analysis: ${allDetectedNouns.size}`);
            
            if (allDetectedNouns.size > 0 && currentChatLorebook) {
                console.log(`[${MODULE_NAME}] Processing nouns for NPC identification using lorebook: ${currentChatLorebook}`);
                
                for (const noun of allDetectedNouns) {
                    try {
                        console.log(`[${MODULE_NAME}] Looking up lorebook entry for noun: "${noun}"`);
                        const matchData = await LorebookManager.findEntryForNoun(noun);
                        console.log(`[${MODULE_NAME}] Lorebook match data for "${noun}":`, matchData);
                        
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
                                console.log(`[${MODULE_NAME}] Found NPC: "${noun}"`);
                            }
                        }
                    } catch (nounError) {
                        console.warn(`[${MODULE_NAME}] Error processing noun "${noun}" for NPC identification:`, nounError);
                    }
                }
            } else if (allDetectedNouns.size > 0) {
                console.log(`[${MODULE_NAME}] Cannot process nouns for NPC identification - no lorebook available`);
            } else {
                console.log(`[${MODULE_NAME}] No nouns detected for NPC analysis`);
            }
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Error extracting context:`, error);
        }

        console.log(`[${MODULE_NAME}] Context extraction complete:`, {
            timeContext,
            locationContext,
            npcContext
        });

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
            
            let response = null;
            
            // Try async API first if configured
            if (nemoLoreSettings.enableAsyncApi) {
                console.log(`[${MODULE_NAME}] Attempting async API summarization for message ${messageIndex}`);
                response = await AsyncAPI.summarizeAsync(messageIndex, prompt, contextData);
            }
            
            // Fall back to SillyTavern API if async failed or not configured
            if (!response) {
                console.log(`[${MODULE_NAME}] Using SillyTavern API for message ${messageIndex}`);
                
                // Generate summary using specified connection profile and preset
                const originalConnectionProfile = main_api;
                const originalPreset = extension_settings.preset;
                
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
                    
                    // Enhanced retry logic for API calls
                    let lastError = null;
                    const maxRetries = 3;
                    const retryDelays = [1000, 2000, 5000]; // Progressive delays in ms
                    
                    for (let attempt = 0; attempt < maxRetries; attempt++) {
                        try {
                            if (attempt > 0) {
                                console.log(`[${MODULE_NAME}] Retrying API call (attempt ${attempt + 1}/${maxRetries}) after ${retryDelays[attempt - 1]}ms delay`);
                                await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
                            }
                            
                            console.log(`[${MODULE_NAME}] Calling generateQuietPrompt with prompt length: ${fullPrompt.length}`);
                            response = await generateQuietPrompt(fullPrompt, false);
                            if (response && response.trim()) {
                                console.log(`[${MODULE_NAME}] generateQuietPrompt succeeded, response length: ${response.length}`);
                                break; // Success, exit retry loop
                            } else {
                                throw new Error('Empty response from generateQuietPrompt');
                            }
                        } catch (quietError) {
                            lastError = quietError;
                            console.log(`[${MODULE_NAME}] generateQuietPrompt failed (attempt ${attempt + 1}):`, quietError);
                            
                            // Try generateRaw as fallback on last attempt
                            if (attempt === maxRetries - 1) {
                                try {
                                    console.log(`[${MODULE_NAME}] Final attempt: trying generateRaw as fallback`);
                                    response = await generateRaw(fullPrompt, '', true, false, false, null, false);
                                    if (response && response.trim()) {
                                        console.log(`[${MODULE_NAME}] generateRaw succeeded, response length: ${response.length}`);
                                        break;
                                    }
                                } catch (rawError) {
                                    console.error(`[${MODULE_NAME}] generateRaw also failed:`, rawError);
                                    lastError = rawError;
                                }
                            }
                        }
                    }
                    
                    // If all attempts failed, throw the last error
                    if (!response || !response.trim()) {
                        throw new Error(`All API attempts failed for message ${messageIndex}. Last error: ${lastError?.message || 'Unknown error'}`);
                    }
                
                } finally {
                    // Always restore original settings - only if we actually changed them
                    try {
                        // Connection profiles might not support empty reset, so skip reset for now
                        // The user's current profile will remain active after summarization
                        
                        // Reset completion preset to original
                        if (nemoLoreSettings.completionPreset && originalPreset) {
                            await this.setCompletionPreset(nemoLoreSettings.completionPreset);
                        }
                    } catch (resetError) {
                        console.warn(`[${MODULE_NAME}] Error resetting settings:`, resetError);
                    }
                }
            }
            
            // Process the response (this code should be within the main try block)
            if (response && response.trim()) {
                const rawSummary = response.trim();
                console.log(`[${MODULE_NAME}] Generated summary: "${rawSummary.substring(0, 100)}..."`);
                
                // Check for core memory tag
                const isCoreMemory = this.detectCoreMemory(rawSummary);
                const cleanSummary = this.extractCleanSummary(rawSummary);
                
                // Enhanced metadata system - extract rich context information
                const enhancedMetadata = this.extractEnhancedMetadata(cleanSummary, message, messageIndex);
                
                // Store summary with enhanced metadata
                const summaryData = {
                    text: cleanSummary,
                    originalLength: message.mes.length,
                    timestamp: Date.now(),
                    messageHash: getStringHash(message.mes),
                    context: contextData,
                    isCoreMemory: isCoreMemory,
                    
                    // Enhanced metadata
                    importance: enhancedMetadata.importance,
                    confidence: enhancedMetadata.confidence,
                    topics: enhancedMetadata.topics,
                    characters: enhancedMetadata.characters,
                    emotionalTone: enhancedMetadata.emotionalTone,
                    relationships: enhancedMetadata.relationships,
                    worldBuilding: enhancedMetadata.worldBuilding,
                    
                    // Analysis scores
                    characterDevelopment: enhancedMetadata.characterDevelopment,
                    plotSignificance: enhancedMetadata.plotSignificance,
                    emotionalImpact: enhancedMetadata.emotionalImpact,
                    
                    // Memory classification
                    memoryType: enhancedMetadata.memoryType,
                    reinforcementCount: 1,
                    rawResponse: rawSummary // Keep original response for debugging
                };
                
                messageSummaries.set(messageIndex, summaryData);
                
                // Save summary to persistent storage
                this.saveSummaryToPersistentStorage(messageIndex, summaryData);
                
                // Update summary count in UI
                updateSummaryCount();
                
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

    // Paired Message Summarization - Groups user+AI message pairs (0, 1+2, 3+4, etc.)
    static async summarizePairedMessages(messageIndex) {
        if (!nemoLoreSettings.enableSummarization || !nemoLoreSettings.enablePairedSummarization) return null;
        
        // Check if messages are already summarized before proceeding
        if (this.isMessageSummarized(messageIndex)) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} already summarized (or part of summarized pair), skipping paired summarization`);
            return null;
        }
        
        // Check if getContext is available
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] getContext not available, cannot summarize paired messages`);
            return null;
        }
        
        const context = getContext();
        if (!context || !context.chat) {
            console.warn(`[${MODULE_NAME}] Invalid context, cannot summarize paired messages`);
            return null;
        }
        
        // Determine the message pair: even index = single message (0), odd index = pair with previous (1+2, 3+4, etc.)
        let messagesToSummarize;
        let targetIndex; // Index where summary will be linked
        
        if (messageIndex === 0) {
            // First message is always alone
            messagesToSummarize = [context.chat[0]];
            const firstMsg = context.chat[0];
            const firstIsUser = firstMsg && (firstMsg.is_user === true || firstMsg.is_system === false);
            
            console.log(`[${MODULE_NAME}] First message debug: Index 0 is ${firstIsUser ? 'USER' : 'AI'}`);
            
            // For first message, if it's a user message and we want to link to AI, we can't (no AI message yet)
            // So we keep it linked to itself regardless of the setting
            targetIndex = 0;
        } else if (messageIndex % 2 === 0 && messageIndex > 0) {
            // Even index > 0: pair with previous message (1+2, 3+4, etc.)
            // This creates the pattern: 0 alone, then 1+2, 3+4, 5+6, etc.
            messagesToSummarize = [context.chat[messageIndex - 1], context.chat[messageIndex]];
            
            // Determine which message is AI vs User
            const prevMsg = context.chat[messageIndex - 1];
            const currentMsg = context.chat[messageIndex];
            const prevIsUser = prevMsg && (prevMsg.is_user === true || prevMsg.is_system === false);
            const currentIsUser = currentMsg && (currentMsg.is_user === true || currentMsg.is_system === false);
            
            console.log(`[${MODULE_NAME}] Message pairing debug: Index ${messageIndex-1} is ${prevIsUser ? 'USER' : 'AI'}, Index ${messageIndex} is ${currentIsUser ? 'USER' : 'AI'}`);
            
            // If linking to AI messages, find which index contains the AI message
            if (nemoLoreSettings.linkSummariesToAI) {
                targetIndex = currentIsUser ? messageIndex - 1 : messageIndex;
            } else {
                // If not linking to AI, use the user message index
                targetIndex = prevIsUser ? messageIndex - 1 : messageIndex;
            }
        } else {
            // Odd index: skip for now, will be paired when the next even index arrives
            console.log(`[${MODULE_NAME}] Skipping odd index ${messageIndex}, will be paired with index ${messageIndex + 1} when it arrives`);
            return null;
        }
        
        if (!messagesToSummarize || messagesToSummarize.some(msg => !msg || !msg.mes)) {
            return null;
        }

        try {
            console.log(`[${MODULE_NAME}] Summarizing paired messages: indices ${messageIndex === 0 ? '0' : `${messageIndex - 1}+${messageIndex}`}`);
            
            // Extract contextual information from all messages in the pair
            const pairedIndices = messageIndex === 0 ? [0] : [messageIndex - 1, messageIndex];
            const contextData = await this.extractContextFromChat(targetIndex, pairedIndices);
            
            // Build paired message data
            const pairedData = {
                messages: messagesToSummarize,
                chatContext: context.chat.slice(Math.max(0, messageIndex - 3), Math.max(1, messageIndex - 1)), // Previous context
                isPaired: messagesToSummarize.length > 1,
                ...contextData
            };
            
            const prompt = this.buildPairedSummarizationPrompt(pairedData);
            
            let response = null;
            
            // Try async API first if configured
            if (nemoLoreSettings.enableAsyncApi) {
                console.log(`[${MODULE_NAME}] Attempting async API paired summarization for messages ${messageIndex === 0 ? '0' : `${messageIndex - 1}+${messageIndex}`}`);
                response = await AsyncAPI.summarizeAsync(messageIndex, prompt, contextData);
            }
            
            // Fall back to SillyTavern API if async failed or not configured  
            if (!response) {
                console.log(`[${MODULE_NAME}] Using SillyTavern API for paired summarization`);
                
                // Generate summary using existing API approach
                const originalConnectionProfile = main_api;
                const originalPreset = extension_settings.preset;
            
            try {
                // Switch to summarization connection profile if specified
                if (nemoLoreSettings.connectionProfile) {
                    await this.setConnectionProfile(nemoLoreSettings.connectionProfile);
                }
                
                // Switch to summarization completion preset if specified  
                if (nemoLoreSettings.completionPreset) {
                    await this.setCompletionPreset(nemoLoreSettings.completionPreset);
                }
                
                const fullPrompt = prompt + (nemoLoreSettings.prefill ? '\n\n' + nemoLoreSettings.prefill : '');
                
                console.log(`[${MODULE_NAME}] Sending paired summarization request for messages ${messageIndex === 0 ? '0' : `${messageIndex - 1}+${messageIndex}`}`);
                
                // Enhanced retry logic for API calls
                let lastError = null;
                const maxRetries = 3;
                const retryDelays = [1000, 2000, 5000]; // Progressive delays in ms
                
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        if (attempt > 0) {
                            console.log(`[${MODULE_NAME}] Retrying API call (attempt ${attempt + 1}/${maxRetries}) after ${retryDelays[attempt - 1]}ms delay`);
                            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
                        }
                        
                        response = await generateQuietPrompt(fullPrompt, false);
                        if (response && response.trim()) {
                            break; // Success, exit retry loop
                        } else {
                            throw new Error('Empty response from generateQuietPrompt');
                        }
                    } catch (quietError) {
                        lastError = quietError;
                        console.log(`[${MODULE_NAME}] generateQuietPrompt failed (attempt ${attempt + 1}):`, quietError);
                        
                        // Try generateRaw as fallback on last attempt
                        if (attempt === maxRetries - 1) {
                            try {
                                console.log(`[${MODULE_NAME}] Final attempt: trying generateRaw as fallback`);
                                response = await generateRaw(fullPrompt, '', true, false, false, null, false);
                                if (response && response.trim()) {
                                    break;
                                }
                            } catch (rawError) {
                                console.error(`[${MODULE_NAME}] generateRaw also failed:`, rawError);
                                lastError = rawError;
                            }
                        }
                    }
                }
                
                // If all attempts failed, throw the last error
                if (!response || !response.trim()) {
                    throw new Error(`All API attempts failed. Last error: ${lastError?.message || 'Unknown error'}`);
                }
                
            } finally {
                // Restore original settings
                try {
                    if (nemoLoreSettings.completionPreset && originalPreset) {
                        await this.setCompletionPreset(originalPreset);
                    }
                } catch (resetError) {
                    console.warn(`[${MODULE_NAME}] Error resetting settings:`, resetError);
                }
            }
            }
            
            if (response && response.trim()) {
                const rawSummary = response.trim();
                console.log(`[${MODULE_NAME}] Generated paired summary: "${rawSummary.substring(0, 100)}..."`);
                
                // Check for core memory tag
                const isCoreMemory = this.detectCoreMemory(rawSummary);
                const cleanSummary = this.extractCleanSummary(rawSummary);
                
                // Enhanced metadata for paired summaries
                const enhancedMetadata = this.extractEnhancedMetadata(cleanSummary, messagesToSummarize[0], messageIndex);
                
                // Store summary data with enhanced metadata
                const summaryData = {
                    text: cleanSummary,
                    originalLength: messagesToSummarize.reduce((sum, msg) => sum + msg.mes.length, 0),
                    timestamp: Date.now(),
                    messageHashes: messagesToSummarize.map(msg => getStringHash(msg.mes)),
                    context: contextData,
                    isCoreMemory: isCoreMemory,
                    
                    // Enhanced metadata
                    importance: enhancedMetadata.importance,
                    confidence: enhancedMetadata.confidence,
                    topics: enhancedMetadata.topics,
                    characters: enhancedMetadata.characters,
                    emotionalTone: enhancedMetadata.emotionalTone,
                    relationships: enhancedMetadata.relationships,
                    worldBuilding: enhancedMetadata.worldBuilding,
                    characterDevelopment: enhancedMetadata.characterDevelopment,
                    plotSignificance: enhancedMetadata.plotSignificance,
                    emotionalImpact: enhancedMetadata.emotionalImpact,
                    memoryType: enhancedMetadata.memoryType,
                    reinforcementCount: 1,
                    rawResponse: rawSummary,
                    isPaired: messagesToSummarize.length > 1,
                    pairedIndices: messageIndex === 0 ? [0] : [messageIndex - 1, messageIndex]
                };
                
                // Debug: Check what type of message we're attaching the summary to
                const targetMsg = context.chat[targetIndex];
                const targetIsUser = targetMsg && (targetMsg.is_user === true || targetMsg.is_system === false);
                console.log(`[${MODULE_NAME}] Attaching summary to message ${targetIndex} (${targetIsUser ? 'USER' : 'AI'} message). LinkSummariesToAI setting: ${nemoLoreSettings.linkSummariesToAI}`);
                
                // Store summary linked to the target index (AI message if enabled)
                messageSummaries.set(targetIndex, summaryData);
                
                // Save summary to persistent storage
                this.saveSummaryToPersistentStorage(targetIndex, summaryData);
                
                // Update summary count in UI
                updateSummaryCount();
                
                // Add visual indicator to the target message
                this.addSummaryIndicator(targetIndex, isCoreMemory);
                
                // Handle core memory special processing
                if (isCoreMemory) {
                    console.log(`[${MODULE_NAME}] 🌟 PAIRED CORE MEMORY DETECTED for messages ${messageIndex === 0 ? '0' : `${messageIndex - 1}+${messageIndex}`}!`);
                    this.handleCoreMemoryDetected(targetIndex, summaryData);
                }
                
                return cleanSummary;
            } else {
                console.log(`[${MODULE_NAME}] No valid response from API for paired messages`);
                return null;
            }
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error summarizing paired messages:`, error);
            return null;
        }
    }


    // Build prompt for paired message summarization
    static buildPairedSummarizationPrompt(pairedData) {
        const { messages, chatContext, timeContext, locationContext, npcContext, isPaired } = pairedData;
        
        const speakers = messages.map(m => m.name || (m.is_user ? 'User' : 'Assistant')).filter((v, i, a) => a.indexOf(v) === i);
        
        let prompt = `You are an advanced narrative memory system for AI assistants. Analyze this roleplay ${isPaired ? 'conversation exchange' : 'message'} and create a structured summary for long-term memory storage.

CONVERSATION EXCHANGE CONTEXT:
- Participants: ${speakers.join(', ')}
- Exchange Type: ${isPaired ? 'Multi-turn dialogue' : 'Single message'}

ENHANCED PAIRED SUMMARIZATION REQUIREMENTS:
- Maximum ${nemoLoreSettings.summaryMaxLength} tokens  
- Rate conversation importance (1-10) based on relationship development and plot significance
- Identify dialogue themes and emotional dynamics
- Track character relationship progression  
- Note any agreements, conflicts, or revelations
- Preserve the flow and outcome of the exchange
- Use past tense, engaging narrative style

EXCHANGE ANALYSIS FOCUS:
1. RELATIONSHIP DYNAMICS: How do the characters interact and relate?
2. DIALOGUE SIGNIFICANCE: What important information is exchanged?
3. EMOTIONAL PROGRESSION: How do emotions evolve during the exchange?
4. PLOT ADVANCEMENT: Does this conversation move the story forward?

FORMAT YOUR RESPONSE AS:
[Importance: X/10] [Participants: ${speakers.join(', ')}] [Topics: topic1, topic2] [Outcome: result_of_exchange] [Tone: emotional_tone]
Exchange summary here...`;

        if (chatContext && chatContext.length > 0) {
            prompt += `\n\nPREVIOUS CONTEXT:\n`;
            chatContext.forEach((msg, idx) => {
                const isUser = msg.is_user === true || msg.is_system === false;
                const speaker = isUser ? 'User' : 'Character';
                prompt += `${speaker}: ${msg.mes.substring(0, 200)}${msg.mes.length > 200 ? '...' : ''}\n`;
            });
        }

        if (nemoLoreSettings.includeTimeLocation && (timeContext || locationContext)) {
            prompt += `\n\nCONTEXT:`;
            if (timeContext) prompt += `\nTime: ${timeContext}`;
            if (locationContext) prompt += `\nLocation: ${locationContext}`;
        }

        if (nemoLoreSettings.includeNPCs && npcContext && npcContext.length > 0) {
            prompt += `\nPresent Characters/NPCs: ${npcContext.join(', ')}`;
        }

        prompt += `\n\n${isPaired ? 'CONVERSATION EXCHANGE' : 'MESSAGE'} TO SUMMARIZE:`;
        
        messages.forEach((msg, idx) => {
            const isUser = msg.is_user === true || msg.is_system === false;
            const speaker = isUser ? 'User' : 'Character';
            prompt += `\n\n${speaker}: ${msg.mes}`;
        });

        prompt += `\n\nSUMMARY FOCUS:`;
        if (nemoLoreSettings.includeEvents) prompt += `\n- What happened/occurred`;
        if (nemoLoreSettings.includeDialogue) prompt += `\n- Important dialogue or conversations`;
        
        prompt += `\n\nProvide only the summary, no additional commentary:`;
        
        return prompt;
    }

    // Automatic Lorebook Creation (independent of Lorebook Manager)
    static async createAutoLorebook(chatId) {
        if (!nemoLoreSettings.autoCreateLorebook) return null;
        
        try {
            // Generate unique lorebook name similar to Lorebook Manager pattern
            const characterName = active_character ? active_character.split(".")[0] : 'Unknown';
            const lorebookName = `${NEMOLORE_LOREBOOK_PREFIX}${characterName}_${chatId}`.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').substring(0, 64);
            
            // Check if lorebook already exists
            if (world_names.includes(lorebookName)) {
                console.log(`[${MODULE_NAME}] Lorebook ${lorebookName} already exists`);
                return lorebookName;
            }
            
            // Create new world info (lorebook)
            await createNewWorldInfo(lorebookName);
            
            // Update chat metadata
            chat_metadata[METADATA_KEY] = lorebookName;
            if (!chat_metadata.nemolore) {
                chat_metadata.nemolore = {};
            }
            chat_metadata.nemolore.lorebook = lorebookName;
            chat_metadata.nemolore.autoCreated = true;
            chat_metadata.nemolore.created_by = MODULE_NAME;
            chat_metadata.nemolore.created_at = Date.now();
            
            await saveMetadata();
            
            // Update UI to show lorebook is set
            $('.chat_lorebook_button').addClass('world_set');
            
            console.log(`[${MODULE_NAME}] Auto-created lorebook: ${lorebookName}`);
            return lorebookName;
            
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error creating auto lorebook:`, error);
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

    // Enhanced metadata extraction system
    static extractEnhancedMetadata(summaryText, originalMessage, messageIndex) {
        const metadata = {
            importance: 5,
            confidence: 0.8,
            topics: [],
            characters: [],
            emotionalTone: 'neutral',
            relationships: [],
            worldBuilding: [],
            characterDevelopment: 5,
            plotSignificance: 5,
            emotionalImpact: 5,
            memoryType: 'general'
        };

        // Extract importance score
        const importanceMatch = summaryText.match(/\[Importance:\s*(\d+)\/10\]/i);
        if (importanceMatch) {
            metadata.importance = parseInt(importanceMatch[1]);
        }

        // Extract topics
        const topicsMatch = summaryText.match(/\[Topics:\s*([^\]]+)\]/i);
        if (topicsMatch) {
            metadata.topics = topicsMatch[1].split(',').map(t => t.trim()).filter(t => t.length > 0);
        }

        // Extract characters
        const charactersMatch = summaryText.match(/\[Characters:\s*([^\]]+)\]/i);
        if (charactersMatch) {
            metadata.characters = charactersMatch[1].split(',').map(c => c.trim()).filter(c => c.length > 0);
        }

        // Extract emotional tone
        const toneMatch = summaryText.match(/\[Tone:\s*([^\]]+)\]/i);
        if (toneMatch) {
            metadata.emotionalTone = toneMatch[1].trim();
        }

        // Extract context information
        const contextMatch = summaryText.match(/\[Context:\s*([^\]]+)\]/i);
        if (contextMatch) {
            metadata.contextInfo = contextMatch[1].trim();
        }

        // Analyze content for additional metadata
        const content = summaryText.toLowerCase();

        // Determine memory type based on content
        if (content.includes('relationship') || content.includes('bond') || content.includes('friend')) {
            metadata.memoryType = 'relationship';
        } else if (content.includes('world') || content.includes('location') || content.includes('setting')) {
            metadata.memoryType = 'worldbuilding';
        } else if (content.includes('emotion') || content.includes('feel') || content.includes('sad') || content.includes('happy')) {
            metadata.memoryType = 'emotional';
        } else if (content.includes('plot') || content.includes('story') || content.includes('event')) {
            metadata.memoryType = 'plot';
        }

        // Calculate confidence based on summary quality indicators
        let confidenceScore = 0.8; // Base confidence
        
        if (summaryText.includes('[Importance:')) confidenceScore += 0.1;
        if (summaryText.includes('[Topics:')) confidenceScore += 0.05;
        if (summaryText.includes('[Characters:')) confidenceScore += 0.05;
        if (summaryText.length > 100) confidenceScore += 0.05; // Detailed summary
        if (summaryText.length < 50) confidenceScore -= 0.1; // Too short
        
        metadata.confidence = Math.min(0.95, Math.max(0.3, confidenceScore));

        // Extract relationship information
        const relationshipPatterns = [
            /(\w+)\s+and\s+(\w+)\s+(?:become|became|are|were)\s+([\w\s]+)/gi,
            /(\w+)\s+(?:trusts|loves|hates|fears|respects)\s+(\w+)/gi
        ];

        relationshipPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(summaryText)) !== null) {
                if (match[1] && match[2]) {
                    metadata.relationships.push({
                        character1: match[1],
                        character2: match[2],
                        type: match[3] || 'interaction'
                    });
                }
            }
        });

        // Extract world building elements
        const worldPatterns = [
            /(?:in|at|near)\s+([\w\s]+?)(?:\s|,|\.)/gi,
            /the\s+([\w\s]+?)\s+(?:is|was|has|contains)/gi
        ];

        worldPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(summaryText)) !== null) {
                if (match[1] && match[1].length > 3) {
                    metadata.worldBuilding.push({
                        element: match[1].trim(),
                        type: 'location'
                    });
                }
            }
        });

        // Calculate analysis scores based on content
        if (metadata.topics.includes('character') || content.includes('growth') || content.includes('change')) {
            metadata.characterDevelopment = Math.min(10, metadata.importance + 2);
        }

        if (metadata.topics.includes('plot') || content.includes('important') || content.includes('significant')) {
            metadata.plotSignificance = Math.min(10, metadata.importance + 1);
        }

        if (metadata.emotionalTone !== 'neutral' || content.includes('emotion')) {
            metadata.emotionalImpact = Math.min(10, metadata.importance + 1);
        }

        return metadata;
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
                    let result;
                    // Use paired summarization if enabled
                    if (nemoLoreSettings.enablePairedSummarization) {
                        result = await this.summarizePairedMessages(messageIndex);
                    } else {
                        result = await this.summarizeMessage(messageIndex);
                    }
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
        
        // Update our tracking variable to reflect that we have summaries for this chat
        loadedSummariesChatId = chatId;
        
        console.log(`[${MODULE_NAME}] Saved summary for message ${messageIndex} in chat ${chatId}`);
    }

    static loadSummariesFromPersistentStorage() {
        const chatId = getCurrentChatId();
        if (!chatId) {
            console.log(`[${MODULE_NAME}] No chatId available, cannot load summaries`);
            return;
        }
        
        console.log(`[${MODULE_NAME}] Loading summaries for chat ${chatId}`);
        console.log(`[${MODULE_NAME}] Current settings chatSummaries:`, nemoLoreSettings.chatSummaries ? Object.keys(nemoLoreSettings.chatSummaries) : 'null');
        console.log(`[${MODULE_NAME}] Chat ${chatId} has summaries:`, nemoLoreSettings.chatSummaries && nemoLoreSettings.chatSummaries[chatId] ? Object.keys(nemoLoreSettings.chatSummaries[chatId]).length : 0);
        
        // Only clear and reload summaries if we're switching to a different chat
        // This preserves summaries when the function is called multiple times for the same chat
        const currentSummariesCount = messageSummaries.size;
        
        if (loadedSummariesChatId === chatId && currentSummariesCount > 0) {
            console.log(`[${MODULE_NAME}] Summaries already loaded for chat ${chatId} (count: ${currentSummariesCount}), skipping reload`);
            return; // Don't reload if we already have summaries for this chat
        }
        
        console.log(`[${MODULE_NAME}] Loading summaries for chat switch from ${loadedSummariesChatId} to ${chatId} (current count: ${currentSummariesCount})`);
        
        // Before clearing, save what we had
        if (currentSummariesCount > 0) {
            console.log(`[${MODULE_NAME}] Had ${currentSummariesCount} summaries before clearing:`, Array.from(messageSummaries.keys()));
        }
        
        messageSummaries.clear();
        loadedSummariesChatId = chatId;
        
        // Load summaries for current chat
        if (nemoLoreSettings.chatSummaries && nemoLoreSettings.chatSummaries[chatId]) {
            const chatSummaries = nemoLoreSettings.chatSummaries[chatId];
            
            let loadedCount = 0;
            for (const [messageIndex, summaryData] of Object.entries(chatSummaries)) {
                const index = parseInt(messageIndex);
                
                // Validate the summary data
                if (this.validateSummaryData(index, summaryData)) {
                    messageSummaries.set(index, summaryData);
                    console.log(`[${MODULE_NAME}] Loaded summary for message ${index} (isPaired: ${summaryData.isPaired || false})`);
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
            console.log(`[${MODULE_NAME}] No existing summaries found for chat ${chatId}`);
            // No existing summaries found, check for bulk summarization
            setTimeout(() => {
                this.checkForBulkSummarization();
            }, 1000);
        }
    }

    static async checkForBulkSummarization() {
        console.log(`[${MODULE_NAME}] checkForBulkSummarization called - enableSummarization: ${nemoLoreSettings.enableSummarization}, autoSummarize: ${nemoLoreSettings.autoSummarize}`);
        
        if (!nemoLoreSettings.enableSummarization) {
            console.log(`[${MODULE_NAME}] Chat management detection skipped: summarization disabled`);
            return;
        }
        
        if (!nemoLoreSettings.autoSummarize) {
            console.log(`[${MODULE_NAME}] Chat management detection skipped: automatic detection disabled`);
            return;
        }

        const context = getContext();
        if (!context?.chat?.length) {
            console.log(`[${MODULE_NAME}] No chat context or empty chat`);
            return;
        }

        const totalMessages = context.chat.length;
        const unsummarizedMessages = [];

        // Find all messages that need summarization
        console.log(`[${MODULE_NAME}] Checking which messages need summarization...`);
        console.log(`[${MODULE_NAME}] Current messageSummaries keys:`, Array.from(messageSummaries.keys()).sort((a,b) => a-b));
        
        for (let i = 0; i < totalMessages; i++) {
            if (!this.isMessageSummarized(i)) {
                console.log(`[${MODULE_NAME}] Message ${i} needs summarization`);
                unsummarizedMessages.push(i);
            } else {
                console.log(`[${MODULE_NAME}] Message ${i} already summarized (or part of summarized pair)`);
            }
        }

        console.log(`[${MODULE_NAME}] Found ${unsummarizedMessages.length} unsummarized messages out of ${totalMessages} total`);

        if (unsummarizedMessages.length === 0) {
            console.log(`[${MODULE_NAME}] No messages need summarization`);
            return;
        }

        // Ask for user consent before proceeding with summarization
        console.log(`[${MODULE_NAME}] About to show chat management consent prompt for ${unsummarizedMessages.length} messages`);
        await this.promptForChatManagement(unsummarizedMessages);
    }

    static async promptForChatManagement(unsummarizedMessages) {
        console.log(`[${MODULE_NAME}] promptForChatManagement called with ${unsummarizedMessages.length} messages`);
        
        const action = await NotificationSystem.show(
            `🤖 NemoLore has detected <strong>${unsummarizedMessages.length}</strong> messages that are not summarized in this chat. Would you like NemoLore to manage this chat?`,
            [
                { action: 'yes', text: 'Yes, manage this chat' },
                { action: 'no', text: 'No, leave it as is' }
            ],
            15000 // Give user plenty of time to decide
        );
        
        if (action === 'yes') {
            console.log(`[${MODULE_NAME}] User accepted chat management`);
            await this.promptForWorldFleshing(unsummarizedMessages);
        } else {
            console.log(`[${MODULE_NAME}] User declined chat management`);
        }
    }

    static async promptForWorldFleshing(unsummarizedMessages, askChunkSummaries = true) {
        const action = await NotificationSystem.show(
            `🌍 Would you like to flesh out the world? This will generate additional lore entries based on the chat content.`,
            [
                { action: 'yes', text: 'Yes, flesh out the world' },
                { action: 'no', text: 'No, skip world building' }
            ],
            12000
        );
        
        if (action === 'yes') {
            console.log(`[${MODULE_NAME}] User accepted world fleshing - initiating lorebook generation`);
            // Trigger actual world expansion
            await initializeWorldExpansion();
            
            // Only ask about chunk summaries after successful world expansion
            if (askChunkSummaries && unsummarizedMessages && unsummarizedMessages.length > 0) {
                await this.promptForChunkSummaries(unsummarizedMessages);
            }
        } else {
            console.log(`[${MODULE_NAME}] User declined world fleshing`);
        }
    }

    static async promptForChunkSummaries(unsummarizedMessages) {
        const action = await NotificationSystem.show(
            `📝 Would you like to create chunk summaries for the <strong>${unsummarizedMessages.length}</strong> unsummarized messages? ⚠️ <em>This process may take some time and cannot be cancelled once started.</em>`,
            [
                { action: 'yes', text: 'Yes, start summarization' },
                { action: 'no', text: 'No, keep messages as-is' }
            ],
            0 // No timeout - user must make a choice since this is the final step
        );
        
        if (action === 'yes') {
            console.log(`[${MODULE_NAME}] User accepted chunk summaries - starting summarization`);
            
            // Show processing notification
            await NotificationSystem.show(
                `🔄 Starting message summarization... Please wait while ${unsummarizedMessages.length} messages are processed.`,
                [],
                3000
            );
            
            // Start the actual summarization process
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
        } else {
            console.log(`[${MODULE_NAME}] User declined chunk summaries`);
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

    // Helper function to check if a message is already summarized (accounting for paired summarization)
    static isMessageSummarized(messageIndex) {
        // For paired summarization, a message is considered summarized if:
        // 1. It has its own summary, OR
        // 2. It's part of a pair where the summary is stored at the pair partner's index
        
        if (!nemoLoreSettings.enablePairedSummarization) {
            // Simple case: just check if this message has a summary
            return messageSummaries.has(messageIndex);
        }
        
        // Paired summarization logic
        if (messageIndex === 0) {
            // First message is always alone
            return messageSummaries.has(0);
        } else if (messageIndex % 2 === 1) {
            // Odd index (1, 3, 5...): should be paired with next even index
            // Check if either this index or next index has summary
            return messageSummaries.has(messageIndex) || messageSummaries.has(messageIndex + 1);
        } else {
            // Even index > 0 (2, 4, 6...): should be paired with previous odd index  
            // Check if either previous index or this index has summary
            return messageSummaries.has(messageIndex - 1) || messageSummaries.has(messageIndex);
        }
    }

    static validateSummaryData(messageIndex, summaryData) {
        console.log(`[${MODULE_NAME}] Validating summary data for message ${messageIndex}:`, {
            hasData: !!summaryData,
            type: typeof summaryData,
            hasText: !!(summaryData && summaryData.text),
            hasHash: !!(summaryData && (summaryData.messageHash || summaryData.messageHashes)),
            isPaired: !!(summaryData && summaryData.isPaired)
        });
        
        // Check if summary data is valid
        if (!summaryData || typeof summaryData !== 'object') {
            console.log(`[${MODULE_NAME}] Invalid summary data structure for message ${messageIndex}`);
            return false;
        }
        if (!summaryData.text) {
            console.log(`[${MODULE_NAME}] Summary missing text for message ${messageIndex}`);
            return false;
        }
        
        // Check for hash data (support both old single and new paired format)
        const hasHash = summaryData.messageHash || summaryData.messageHashes;
        if (!hasHash) {
            console.log(`[${MODULE_NAME}] Summary missing hash data for message ${messageIndex}`);
            return false;
        }
        
        console.log(`[${MODULE_NAME}] Validating summary for message ${messageIndex}, isPaired: ${summaryData.isPaired}`);
        console.log(`[${MODULE_NAME}] Summary data keys:`, Object.keys(summaryData));
        
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
        if (!message) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} is null, removing summary`);
            return false;
        }
        
        // Validate message hash(es)
        if (summaryData.isPaired && summaryData.messageHashes && summaryData.pairedIndices) {
            // New paired format - validate all paired messages
            for (let i = 0; i < summaryData.pairedIndices.length; i++) {
                const pairIndex = summaryData.pairedIndices[i];
                if (pairIndex >= context.chat.length) {
                    console.log(`[${MODULE_NAME}] Paired message ${pairIndex} doesn't exist, removing summary`);
                    return false;
                }
                
                const pairMessage = context.chat[pairIndex];
                if (!pairMessage || getStringHash(pairMessage.mes) !== summaryData.messageHashes[i]) {
                    console.log(`[${MODULE_NAME}] Paired message ${pairIndex} changed, removing summary`);
                    return false;
                }
            }
        } else if (summaryData.messageHash) {
            // Old single message format
            if (getStringHash(message.mes) !== summaryData.messageHash) {
                console.log(`[${MODULE_NAME}] Message ${messageIndex} changed, removing summary`);
                return false;
            }
        } else {
            console.log(`[${MODULE_NAME}] Summary data missing valid hash format, removing summary`);
            return false;
        }
        
        console.log(`[${MODULE_NAME}] Summary validation passed for message ${messageIndex}`);
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
        if (!nemoLoreSettings.enableSummarization) {
            console.log(`[${MODULE_NAME}] Summarization disabled`);
            return;
        }
        
        // Block summarization if lorebook creation is in progress
        if (isLorebookCreationInProgress) {
            console.log(`[${MODULE_NAME}] Lorebook creation in progress, deferring summarization of message ${messageIndex}`);
            // Queue it for later processing when the flag is cleared
            setTimeout(() => {
                if (!isLorebookCreationInProgress) {
                    console.log(`[${MODULE_NAME}] Retrying queuing message ${messageIndex} after lorebook creation completed`);
                    this.queueMessageForSummary(messageIndex);
                }
            }, 2000);
            return;
        }
        
        // Check if SillyTavern is ready
        if (typeof getContext !== 'function') {
            console.warn(`[${MODULE_NAME}] Cannot queue message for summary - SillyTavern not ready`);
            return;
        }
        
        // Check if already processed (accounts for paired summarization)
        if (this.isMessageSummarized(messageIndex)) {
            console.log(`[${MODULE_NAME}] Message ${messageIndex} already summarized (or part of summarized pair), skipping`);
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
            // Fall back to local storage if vector API fails
            await this.storeVectorLocally(collectionId, item);
        }
    }

    // Enhanced vector storage with local fallback
    static async storeVectorLocally(collectionId, item) {
        try {
            const localVectors = JSON.parse(localStorage.getItem(`nemolore_vectors_${collectionId}`) || '{}');
            const vectorId = `${item.index}_${Date.now()}`;
            
            localVectors[vectorId] = {
                ...item,
                embedding: await this.generateLocalEmbedding(item.text),
                created: Date.now()
            };
            
            localStorage.setItem(`nemolore_vectors_${collectionId}`, JSON.stringify(localVectors));
            console.log(`[${MODULE_NAME}] Stored vector locally: ${vectorId}`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Local vector storage failed:`, error);
        }
    }

    // Generate simple local embedding as fallback
    static generateLocalEmbedding(text) {
        // Simple TF-IDF style embedding as fallback
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(384).fill(0); // 384-dimensional vector
        
        // Create embedding based on word positions and frequencies
        const wordFreq = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        Object.keys(wordFreq).forEach((word, index) => {
            const hash = getStringHash(word);
            const embeddingIndex = Math.abs(hash) % embedding.length;
            embedding[embeddingIndex] += wordFreq[word] / Math.sqrt(words.length);
        });
        
        // Normalize the vector
        const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (norm > 0) {
            for (let i = 0; i < embedding.length; i++) {
                embedding[i] /= norm;
            }
        }
        
        return embedding;
    }

    // Calculate cosine similarity between two vectors
    static calculateCosineSimilarity(vector1, vector2) {
        if (!vector1 || !vector2 || vector1.length !== vector2.length) {
            return 0;
        }

        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vector1.length; i++) {
            dotProduct += vector1[i] * vector2[i];
            norm1 += vector1[i] * vector1[i];
            norm2 += vector2[i] * vector2[i];
        }

        if (norm1 === 0 || norm2 === 0) {
            return 0;
        }

        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    // Enhanced semantic search with local fallback
    static async performLocalVectorSearch(collectionId, queryText, limit = 3) {
        try {
            const localVectors = JSON.parse(localStorage.getItem(`nemolore_vectors_${collectionId}`) || '{}');
            const queryEmbedding = this.generateLocalEmbedding(queryText);
            
            const results = [];
            
            for (const [vectorId, vectorData] of Object.entries(localVectors)) {
                const similarity = this.calculateCosineSimilarity(queryEmbedding, vectorData.embedding);
                
                if (similarity > (nemoLoreSettings.vectorSimilarityThreshold || 0.7)) {
                    results.push({
                        text: vectorData.text,
                        score: similarity,
                        metadata: vectorData.metadata
                    });
                }
            }
            
            // Sort by similarity and return top results
            return results
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);
                
        } catch (error) {
            console.error(`[${MODULE_NAME}] Local vector search failed:`, error);
            return [];
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
                console.warn(`[${MODULE_NAME}] Vector query API failed: ${response.statusText}, falling back to local search`);
                return await this.performLocalVectorSearch(collectionId, queryText, searchLimit);
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
            console.error(`[${MODULE_NAME}] Semantic search API failed:`, error);
            console.log(`[${MODULE_NAME}] Falling back to local vector search`);
            
            // Fallback to local search
            const collectionId = `nemolore_${getCurrentChatId()}`;
            const searchLimit = limit || nemoLoreSettings.vectorSearchLimit || 3;
            return await this.performLocalVectorSearch(collectionId, queryText, searchLimit);
        }
    }

    static async enhancedMemoryInjection() {
        // Enhanced version with multi-tier memory system and semantic retrieval
        const context = getContext();
        if (!context || !nemoLoreSettings.enableSummarization) {
            context?.setExtensionPrompt?.(`${MODULE_NAME}_summary_memory`, "");
            return;
        }

        // Update multi-tier memory system and importance scores
        await MultiTierMemorySystem.updateMemoryTiers();
        
        // Update dynamic importance scores based on current context
        MemoryWeightingSystem.updateMemoryImportanceScores();

        // Check if we have a multi-tier memory system preference
        const useMultiTier = nemoLoreSettings.enableMultiTierMemory !== false; // Default to true
        
        let injectionText = '';
        
        if (useMultiTier) {
            // Use advanced multi-tier memory system
            const maxTokens = nemoLoreSettings.memoryTokenLimit || 2000;
            injectionText = MultiTierMemorySystem.generateTieredMemoryInjection(maxTokens);
            
            // Add semantic search enhancement if enabled
            if (nemoLoreSettings.enableVectorization) {
                const recentMessages = context.chat.slice(-3);
                const queryText = recentMessages.map(m => m.mes).join(' ').substring(0, 500);
                
                if (queryText.trim()) {
                    const relevantMessages = await this.semanticSearchRelevantMessages(queryText);
                    if (relevantMessages.length > 0) {
                        injectionText += `\n\nSEMANTIC CONTEXT ENHANCEMENT (${relevantMessages.length} relevant memories):\n`;
                        relevantMessages.slice(0, 3).forEach((result, index) => {
                            const speaker = result.metadata.decodedSpeaker || result.metadata.speaker || 'Unknown';
                            const messageIndex = result.metadata.decodedOriginalIndex || result.metadata.floor || 'Unknown';
                            const score = (result.score * 100).toFixed(1);
                            injectionText += `🔍 ${speaker} (Msg #${messageIndex} | ${score}% match): ${result.text.substring(0, 200)}...\n`;
                        });
                    }
                }
            }
        } else {
            // Fallback to legacy system for compatibility
            const summaries = this.collectSummariesForInjection();
            let relevantMessages = [];
            
            if (nemoLoreSettings.enableVectorization && summaries.length > 0) {
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

            const currentTime = new Date().toLocaleString();
            const totalContext = summaries.length + relevantMessages.length;
            
            injectionText = `[AI ENHANCED MEMORY SYSTEM - Contextual Recall]
📅 Generated: ${currentTime}
🧠 Memory Sources: ${summaries.length > 0 ? 'Compressed Summaries' : ''}${summaries.length > 0 && relevantMessages.length > 0 ? ' + ' : ''}${relevantMessages.length > 0 ? 'Semantic Retrieval' : ''}
📊 Total Context Entries: ${totalContext}
🔍 Context Relevance: Automatically selected based on current conversation flow

`;

            // Add summaries with enhanced formatting
            if (summaries.length > 0) {
                injectionText += `COMPRESSED MEMORY (${summaries.length} summarized events):
${summaries.join('\n')}\n`;
            }

            // Add relevant full messages with enhanced context
            if (relevantMessages.length > 0) {
                injectionText += `${summaries.length > 0 ? '\n' : ''}SEMANTICALLY RELEVANT CONVERSATIONS (${relevantMessages.length} retrieved):
`;
                relevantMessages.forEach((result, index) => {
                    const speaker = result.metadata.decodedSpeaker || result.metadata.speaker || 'Unknown';
                    const messageIndex = result.metadata.decodedOriginalIndex || result.metadata.floor || 'Unknown';
                    const score = (result.score * 100).toFixed(1);
                    injectionText += `📝 ${speaker} (Message #${messageIndex} | Relevance: ${score}% | Context Match)\n${result.text}\n\n`;
                });
            }

            injectionText += `[End of Enhanced Memory Context - Current conversation continues below]`;
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

// Async API System for Independent Summarization
class AsyncAPI {
    static models = {
        openai: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
            { id: 'gpt-4', name: 'GPT-4' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
        ],
        gemini: [
            { id: 'gemini-2.5-pro-latest', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash-latest', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro' },
            { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash' },
            { id: 'gemini-pro', name: 'Gemini Pro' }
        ],
        claude: [
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
        ],
        openrouter: [] // Will be populated dynamically
    };

    static endpoints = {
        openai: 'https://api.openai.com/v1/chat/completions',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        claude: 'https://api.anthropic.com/v1/messages',
        openrouter: 'https://openrouter.ai/api/v1/chat/completions'
    };

    static async refreshModels(provider) {
        console.log(`[${MODULE_NAME}] Refreshing models for provider: ${provider}`);
        
        try {
            if (provider === 'openrouter') {
                return await this.fetchOpenRouterModels();
            } else {
                // Try to get models from SillyTavern's current API if possible
                const dynamicModels = await this.tryGetSillyTavernModels(provider);
                if (dynamicModels && dynamicModels.length > 0) {
                    console.log(`[${MODULE_NAME}] Using ${dynamicModels.length} models from SillyTavern for ${provider}`);
                    return dynamicModels;
                }
                
                // Fall back to hardcoded models
                console.log(`[${MODULE_NAME}] Using hardcoded models for ${provider}`);
                return this.models[provider] || [];
            }
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error refreshing models for ${provider}:`, error);
            return this.models[provider] || [];
        }
    }

    static async tryGetSillyTavernModels(provider) {
        try {
            // First try to get models from SillyTavern's DOM elements
            const domModels = this.getSillyTavernDOMModels(provider);
            if (domModels && domModels.length > 0) {
                console.log(`[${MODULE_NAME}] Found ${domModels.length} models from SillyTavern DOM for ${provider}`);
                return domModels;
            }

            // For OpenAI, also check the imported model list as fallback
            if (provider === 'openai' && openai_model_list && openai_model_list.length > 0) {
                // Filter to text generation models (exclude embedding models)
                const chatModels = openai_model_list.filter(model => 
                    model.id && !model.id.includes('embedding') && 
                    (model.id.includes('gpt') || model.id.includes('o1'))
                ).map(model => ({
                    id: model.id,
                    name: model.name || model.id
                }));
                
                if (chatModels.length > 0) {
                    return chatModels;
                }
            }
            
            return null;
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Could not get dynamic models for ${provider}:`, error);
            return null;
        }
    }

    static getSillyTavernDOMModels(provider) {
        try {
            let selectorId = '';
            
            // Map provider to SillyTavern's model select elements
            switch (provider) {
                case 'openai':
                    selectorId = '#model_openai_select';
                    break;
                case 'claude':
                    selectorId = '#model_claude_select';
                    break;
                case 'gemini':
                    selectorId = '#model_google_select';
                    break;
                case 'openrouter':
                    selectorId = '#model_openrouter_select';
                    break;
                default:
                    return null;
            }

            const selectElement = document.querySelector(selectorId);
            if (!selectElement) {
                console.log(`[${MODULE_NAME}] Could not find model select element: ${selectorId} (SillyTavern may still be loading)`);
                return null;
            }

            // Extract options from the select element, filtering out empty values and separators
            const options = Array.from(selectElement.querySelectorAll('option'))
                .filter(option => {
                    const value = option.value && option.value.trim();
                    const text = option.textContent && option.textContent.trim();
                    // Filter out empty values, separators, and disabled options
                    return value && value !== '' && !option.disabled && text && !text.startsWith('---');
                })
                .map(option => ({
                    id: option.value,
                    name: this.cleanModelName(option.textContent.trim(), option.value)
                }))
                .slice(0, 25); // Limit to top 25 models for performance

            console.log(`[${MODULE_NAME}] Extracted ${options.length} models from ${selectorId} for ${provider}`);
            return options.length > 0 ? options : null;
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Error extracting DOM models for ${provider}:`, error);
            return null;
        }
    }

    static cleanModelName(displayName, value) {
        // Clean up model display names
        if (!displayName || displayName === value) {
            return value;
        }
        
        // Remove arrows and redirects (e.g., "model → other-model")
        const cleanName = displayName.replace(/\s*→\s*.+$/, '').trim();
        
        // If the clean name is empty, use the value
        return cleanName || value;
    }


    static async fetchOpenRouterModels() {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                headers: {
                    'Authorization': `Bearer ${nemoLoreSettings.asyncApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data.data.map(model => ({
                id: model.id,
                name: model.name || model.id
            })).filter(model => 
                // Filter to popular chat models
                model.id.includes('claude') || 
                model.id.includes('gpt') || 
                model.id.includes('gemini') ||
                model.id.includes('llama')
            );
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error fetching OpenRouter models:`, error);
            return [];
        }
    }

    static async testConnection(provider, apiKey, model, endpoint) {
        console.log(`[${MODULE_NAME}] Testing API connection for ${provider}`);
        
        try {
            const testPrompt = "Please respond with 'API test successful' to confirm connection.";
            const response = await this.makeRequest(provider, apiKey, model, testPrompt, endpoint);
            
            if (response && response.includes('API test successful')) {
                return { success: true, message: 'API connection successful!' };
            } else {
                return { success: true, message: 'API connected but response may be filtered. This is normal.' };
            }
        } catch (error) {
            return { success: false, message: `Connection failed: ${error.message}` };
        }
    }

    static async makeRequest(provider, apiKey, model, prompt, customEndpoint = null) {
        const endpoint = customEndpoint || this.endpoints[provider];
        
        switch (provider) {
            case 'openai':
                return await this.makeOpenAIRequest(endpoint, apiKey, model, prompt);
            case 'gemini':
                return await this.makeGeminiRequest(endpoint, apiKey, model, prompt);
            case 'claude':
                return await this.makeClaudeRequest(endpoint, apiKey, model, prompt);
            case 'openrouter':
                return await this.makeOpenRouterRequest(endpoint, apiKey, model, prompt);
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    static async makeOpenAIRequest(endpoint, apiKey, model, prompt) {
        console.log(`[${MODULE_NAME}] === ASYNC API CALL START ===`);
        console.log(`[${MODULE_NAME}] Provider: OpenAI`);
        console.log(`[${MODULE_NAME}] Endpoint: ${endpoint}`);
        console.log(`[${MODULE_NAME}] Model: ${model}`);
        console.log(`[${MODULE_NAME}] Prompt length: ${prompt.length} characters`);
        console.log(`[${MODULE_NAME}] Prompt preview:`, prompt.substring(0, 200) + '...');
        
        const requestBody = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1000,
            temperature: 0.3
        };
        
        console.log(`[${MODULE_NAME}] Request body:`, {
            model: requestBody.model,
            messages: [{ role: 'user', content: `${prompt.substring(0, 100)}...` }],
            max_tokens: requestBody.max_tokens,
            temperature: requestBody.temperature
        });
        
        const startTime = Date.now();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey.substring(0, 8)}...`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const duration = Date.now() - startTime;
        console.log(`[${MODULE_NAME}] API response received in ${duration}ms`);
        console.log(`[${MODULE_NAME}] Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[${MODULE_NAME}] OpenAI API error: ${response.status} ${response.statusText}`);
            console.error(`[${MODULE_NAME}] Error response body:`, errorText);
            
            try {
                const errorData = JSON.parse(errorText);
                console.error(`[${MODULE_NAME}] Parsed error data:`, errorData);
                throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || errorText}`);
            } catch (parseError) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '';
        
        console.log(`[${MODULE_NAME}] === ASYNC API CALL COMPLETE ===`);
        console.log(`[${MODULE_NAME}] Response length: ${content.length} characters`);
        console.log(`[${MODULE_NAME}] Response preview:`, content.substring(0, 200) + '...');
        
        return content;
    }

    static async makeGeminiRequest(endpoint, apiKey, model, prompt) {
        console.log(`[${MODULE_NAME}] === ASYNC API CALL START ===`);
        console.log(`[${MODULE_NAME}] Provider: Gemini`);
        console.log(`[${MODULE_NAME}] Model: ${model}`);
        console.log(`[${MODULE_NAME}] Prompt length: ${prompt.length} characters`);
        console.log(`[${MODULE_NAME}] Prompt preview:`, prompt.substring(0, 200) + '...');
        
        const url = endpoint.replace('{model}', model) + `?key=${apiKey}`;
        console.log(`[${MODULE_NAME}] Request URL: ${url.split('?')[0]}?key=${apiKey.substring(0, 8)}...`);
        
        const startTime = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 64000
                }
            })
        });
        
        const duration = Date.now() - startTime;
        console.log(`[${MODULE_NAME}] API response received in ${duration}ms`);
        console.log(`[${MODULE_NAME}] Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[${MODULE_NAME}] Gemini API error: ${response.status} ${response.statusText}`);
            console.error(`[${MODULE_NAME}] Error response body:`, errorText);
            
            try {
                const errorData = JSON.parse(errorText);
                console.error(`[${MODULE_NAME}] Parsed error data:`, errorData);
                throw new Error(`Gemini API error: ${response.status} - ${errorData.error?.message || errorText}`);
            } catch (parseError) {
                throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
        }

        const data = await response.json();
        console.log(`[${MODULE_NAME}] Full API response:`, JSON.stringify(data, null, 2));
        
        if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
            console.error(`[${MODULE_NAME}] Invalid response structure: candidates missing or empty`);
            throw new Error(`Invalid Gemini API response: ${JSON.stringify(data)}`);
        }
        
        const candidate = data.candidates[0];
        const content = candidate?.content?.parts?.[0]?.text || '';
        
        if (!content && candidate?.finishReason === 'MAX_TOKENS') {
            console.warn(`[${MODULE_NAME}] Response was truncated due to max tokens limit`);
        }
        
        console.log(`[${MODULE_NAME}] === ASYNC API CALL COMPLETE ===`);
        console.log(`[${MODULE_NAME}] Response length: ${content.length} characters`);
        console.log(`[${MODULE_NAME}] Response preview:`, content.substring(0, 200) + '...');
        
        return content;
    }

    static async makeClaudeRequest(endpoint, apiKey, model, prompt) {
        console.log(`[${MODULE_NAME}] === ASYNC API CALL START ===`);
        console.log(`[${MODULE_NAME}] Provider: Claude`);
        console.log(`[${MODULE_NAME}] Endpoint: ${endpoint}`);
        console.log(`[${MODULE_NAME}] Model: ${model}`);
        console.log(`[${MODULE_NAME}] Prompt length: ${prompt.length} characters`);
        console.log(`[${MODULE_NAME}] Prompt preview:`, prompt.substring(0, 200) + '...');
        
        const startTime = Date.now();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey.substring(0, 8) + '...',
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 1000,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3
            })
        });
        
        const duration = Date.now() - startTime;
        console.log(`[${MODULE_NAME}] API response received in ${duration}ms`);
        console.log(`[${MODULE_NAME}] Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[${MODULE_NAME}] Claude API error: ${response.status} ${response.statusText}`);
            console.error(`[${MODULE_NAME}] Error response body:`, errorText);
            
            try {
                const errorData = JSON.parse(errorText);
                console.error(`[${MODULE_NAME}] Parsed error data:`, errorData);
                throw new Error(`Claude API error: ${response.status} - ${errorData.error?.message || errorText}`);
            } catch (parseError) {
                throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
        }

        const data = await response.json();
        const content = data.content[0]?.text || '';
        
        console.log(`[${MODULE_NAME}] === ASYNC API CALL COMPLETE ===`);
        console.log(`[${MODULE_NAME}] Response length: ${content.length} characters`);
        console.log(`[${MODULE_NAME}] Response preview:`, content.substring(0, 200) + '...');
        
        return content;
    }

    static async makeOpenRouterRequest(endpoint, apiKey, model, prompt) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'NemoLore Extension'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || '';
    }

    static async summarizeAsync(messageIndex, prompt, contextData = {}) {
        if (!nemoLoreSettings.enableAsyncApi || !nemoLoreSettings.asyncApiProvider || !nemoLoreSettings.asyncApiKey) {
            console.log(`[${MODULE_NAME}] Async API not configured, falling back to SillyTavern API`);
            return null;
        }

        try {
            console.log(`[${MODULE_NAME}] Making async API request for message ${messageIndex}`);
            
            const response = await this.makeRequest(
                nemoLoreSettings.asyncApiProvider,
                nemoLoreSettings.asyncApiKey,
                nemoLoreSettings.asyncApiModel,
                prompt,
                nemoLoreSettings.asyncApiEndpoint
            );

            if (response && response.trim()) {
                console.log(`[${MODULE_NAME}] Async API response received for message ${messageIndex}`);
                return response.trim();
            } else {
                throw new Error('Empty response from async API');
            }
        } catch (error) {
            console.error(`[${MODULE_NAME}] Async API request failed for message ${messageIndex}:`, error);
            return null; // Return null to allow fallback to SillyTavern API
        }
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

// Multi-Tier Memory System - Hierarchical memory organization
class MultiTierMemorySystem {
    static memoryTiers = {
        immediate: new Map(),     // Last 10 messages (full context)
        shortTerm: new Map(),     // Summaries of last 50 messages
        mediumTerm: new Map(),    // Important events from last 200 messages
        longTerm: new Map(),      // Core memories and key relationships
        permanent: new Map()      // Character traits and world facts
    };

    static memoryConfig = {
        immediate: { maxMessages: 10, fullContent: true, priority: 1 },
        shortTerm: { maxMessages: 50, summaryRequired: true, priority: 2 },
        mediumTerm: { maxMessages: 200, importanceThreshold: 6, priority: 3 },
        longTerm: { importanceThreshold: 8, priority: 4 },
        permanent: { importanceThreshold: 9, priority: 5 }
    };

    // Organize memories into appropriate tiers
    static async organizeMemories() {
        const context = getContext();
        if (!context?.chat?.length) return;

        console.log(`[${MODULE_NAME}] Organizing memories into tiers...`);

        // Clear existing tiers
        Object.keys(this.memoryTiers).forEach(tier => this.memoryTiers[tier].clear());

        const totalMessages = context.chat.length;
        
        // Organize immediate memory (last 10 messages)
        const immediateMessages = context.chat.slice(-this.memoryConfig.immediate.maxMessages);
        immediateMessages.forEach((msg, index) => {
            const actualIndex = totalMessages - immediateMessages.length + index;
            this.memoryTiers.immediate.set(actualIndex, {
                type: 'immediate',
                content: msg.mes,
                speaker: msg.name || (msg.is_user ? 'User' : 'Assistant'),
                timestamp: msg.send_date || Date.now(),
                messageIndex: actualIndex,
                importance: 5, // Default immediate importance
                tier: 'immediate'
            });
        });

        // Organize other tiers based on summaries and importance
        await this.organizeSummarizedMemories();
        await this.identifyPermanentMemories();

        console.log(`[${MODULE_NAME}] Memory organization complete:`, {
            immediate: this.memoryTiers.immediate.size,
            shortTerm: this.memoryTiers.shortTerm.size,
            mediumTerm: this.memoryTiers.mediumTerm.size,
            longTerm: this.memoryTiers.longTerm.size,
            permanent: this.memoryTiers.permanent.size
        });
    }

    // Organize summarized memories by importance and recency
    static async organizeSummarizedMemories() {
        const context = getContext();
        const summaries = messageSummaries;

        for (const [messageIndex, summaryData] of summaries) {
            const baseImportance = this.extractImportanceScore(summaryData.text);
            const age = this.calculateMessageAge(messageIndex, context.chat.length);
            
            // Use dynamic importance if available, fallback to base importance
            const dynamicImportance = summaryData.dynamicImportance || baseImportance;
            
            const memoryEntry = {
                type: 'summarized',
                content: summaryData.text,
                originalContent: context.chat[messageIndex]?.mes || '',
                speaker: summaryData.speaker || 'Unknown',
                timestamp: summaryData.timestamp || Date.now(),
                messageIndex: messageIndex,
                importance: dynamicImportance, // Use dynamic importance
                baseImportance: baseImportance, // Keep original for reference
                age: age,
                topics: summaryData.topics || this.extractTopics(summaryData.text),
                characters: summaryData.characters || this.extractCharacters(summaryData.text),
                emotionalTone: summaryData.emotionalTone || this.extractEmotionalTone(summaryData.text),
                isCoreMemory: summaryData.isCoreMemory || false,
                
                // Enhanced metadata from MemoryWeightingSystem
                confidence: summaryData.confidence || 0.8,
                contextRelevance: summaryData.contextRelevance || 0,
                reinforcementCount: summaryData.reinforcementCount || 1,
                memoryType: summaryData.memoryType || 'general'
            };

            // Assign to appropriate tier based on dynamic importance and age
            if (memoryEntry.isCoreMemory || dynamicImportance >= this.memoryConfig.permanent.importanceThreshold) {
                memoryEntry.tier = 'permanent';
                this.memoryTiers.permanent.set(messageIndex, memoryEntry);
            } else if (dynamicImportance >= this.memoryConfig.longTerm.importanceThreshold) {
                memoryEntry.tier = 'longTerm';
                this.memoryTiers.longTerm.set(messageIndex, memoryEntry);
            } else if (dynamicImportance >= this.memoryConfig.mediumTerm.importanceThreshold && age <= this.memoryConfig.mediumTerm.maxMessages) {
                memoryEntry.tier = 'mediumTerm';
                this.memoryTiers.mediumTerm.set(messageIndex, memoryEntry);
            } else if (age <= this.memoryConfig.shortTerm.maxMessages) {
                memoryEntry.tier = 'shortTerm';
                this.memoryTiers.shortTerm.set(messageIndex, memoryEntry);
            }
        }
    }

    // Extract importance score from summary text
    static extractImportanceScore(text) {
        const importanceMatch = text.match(/\[Importance:\s*(\d+)\/10\]/i);
        return importanceMatch ? parseInt(importanceMatch[1]) : 5; // Default to 5 if not found
    }

    // Extract topics from summary text
    static extractTopics(text) {
        const topicsMatch = text.match(/\[Topics:\s*([^\]]+)\]/i);
        return topicsMatch ? topicsMatch[1].split(',').map(t => t.trim()) : [];
    }

    // Extract characters from summary text
    static extractCharacters(text) {
        const charactersMatch = text.match(/\[Characters:\s*([^\]]+)\]/i);
        return charactersMatch ? charactersMatch[1].split(',').map(c => c.trim()) : [];
    }

    // Extract emotional tone from summary text
    static extractEmotionalTone(text) {
        const toneMatch = text.match(/\[Tone:\s*([^\]]+)\]/i);
        return toneMatch ? toneMatch[1].trim() : 'neutral';
    }

    // Calculate message age (how far back from current)
    static calculateMessageAge(messageIndex, totalMessages) {
        return totalMessages - messageIndex - 1;
    }

    // Identify permanent memories (character traits, world facts)
    static async identifyPermanentMemories() {
        const characterTraits = new Map();
        const worldFacts = new Map();

        // Analyze all memories for permanent information
        for (const tier of Object.values(this.memoryTiers)) {
            for (const [index, memory] of tier) {
                if (memory.type === 'summarized') {
                    // Extract character traits
                    const traits = this.extractCharacterTraits(memory.content);
                    traits.forEach(trait => {
                        const key = `${trait.character}_${trait.trait}`;
                        if (!characterTraits.has(key) || characterTraits.get(key).importance < trait.importance) {
                            characterTraits.set(key, {
                                type: 'character_trait',
                                character: trait.character,
                                trait: trait.trait,
                                evidence: memory.content,
                                importance: trait.importance,
                                messageIndex: index,
                                tier: 'permanent'
                            });
                        }
                    });

                    // Extract world facts
                    const facts = this.extractWorldFacts(memory.content);
                    facts.forEach(fact => {
                        const key = `world_${getStringHash(fact.content)}`;
                        if (!worldFacts.has(key) || worldFacts.get(key).importance < fact.importance) {
                            worldFacts.set(key, {
                                type: 'world_fact',
                                content: fact.content,
                                category: fact.category,
                                importance: fact.importance,
                                messageIndex: index,
                                tier: 'permanent'
                            });
                        }
                    });
                }
            }
        }

        // Add permanent memories to the permanent tier
        characterTraits.forEach((trait, key) => {
            this.memoryTiers.permanent.set(`trait_${key}`, trait);
        });

        worldFacts.forEach((fact, key) => {
            this.memoryTiers.permanent.set(`fact_${key}`, fact);
        });
    }

    // Extract character traits from content
    static extractCharacterTraits(content) {
        const traits = [];
        const traitPatterns = [
            /(\w+)\s+(?:is|was|became|appears to be|seems)\s+([\w\s]+?)(?:[\.;,]|$)/gi,
            /(\w+)'s\s+([\w\s]+?)(?:[\.;,]|$)/gi
        ];

        traitPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && match[2]) {
                    traits.push({
                        character: match[1],
                        trait: match[2].trim(),
                        importance: content.includes('important') || content.includes('significant') ? 8 : 6
                    });
                }
            }
        });

        return traits;
    }

    // Extract world facts from content
    static extractWorldFacts(content) {
        const facts = [];
        const factPatterns = [
            /The\s+([\w\s]+?)\s+(?:is|was|has|contains)\s+([\w\s]+?)(?:[\.;,]|$)/gi,
            /(?:In|At)\s+([\w\s]+?),\s*([\w\s]+?)(?:[\.;,]|$)/gi
        ];

        factPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1] && match[2]) {
                    facts.push({
                        content: `${match[1]} ${match[2]}`,
                        category: 'location', // Default category
                        importance: 7
                    });
                }
            }
        });

        return facts;
    }

    // Generate multi-tier memory injection
    static generateTieredMemoryInjection(maxTokens = 2000) {
        const currentTime = new Date().toLocaleString();
        let injection = `[AI MULTI-TIER MEMORY SYSTEM - Hierarchical Context]
📅 Generated: ${currentTime}
🧠 Memory Architecture: 5-tier hierarchical organization
🎯 Context Optimization: Importance and recency weighted

`;

        let tokenCount = injection.length;

        // Add cross-chat character memories first (if enabled and available)
        if (nemoLoreSettings.enableCrossChatPersistence) {
            const currentCharacter = characters[this_chid]?.name;
            if (currentCharacter) {
                const crossChatMemories = CrossChatPersistenceSystem.generateCrossChatMemoryInjection(currentCharacter);
                if (crossChatMemories && crossChatMemories.length > 10) {
                    if (tokenCount + crossChatMemories.length < maxTokens * 0.2) { // Reserve 20% for cross-chat
                        injection += crossChatMemories + '\n';
                        tokenCount += crossChatMemories.length;
                    }
                }
            }
        }

        // Add permanent memories second (highest priority for current chat)
        const permanentMemories = this.getMemoriesByTier('permanent', { limit: 10 });
        if (permanentMemories.length > 0) {
            let permanentSection = `PERMANENT MEMORY (${permanentMemories.length} core facts):\n`;
            permanentMemories.forEach(memory => {
                if (memory.type === 'character_trait') {
                    permanentSection += `🧑 ${memory.character}: ${memory.trait}\n`;
                } else if (memory.type === 'world_fact') {
                    permanentSection += `🌍 ${memory.content}\n`;
                } else {
                    permanentSection += `⭐ ${memory.content}\n`;
                }
            });
            permanentSection += '\n';

            if (tokenCount + permanentSection.length < maxTokens) {
                injection += permanentSection;
                tokenCount += permanentSection.length;
            }
        }

        // Add long-term memories with enhanced scoring
        const longTermMemories = this.getMemoriesByTier('longTerm', { limit: 5 });
        if (longTermMemories.length > 0 && tokenCount < maxTokens * 0.8) {
            let longTermSection = `LONG-TERM MEMORY (${longTermMemories.length} significant events):\n`;
            longTermMemories.forEach(memory => {
                const confidence = memory.confidence ? `${Math.round(memory.confidence * 100)}%` : '80%';
                const relevance = memory.contextRelevance ? `${Math.round(memory.contextRelevance * 100)}%` : '0%';
                const reinforcement = memory.reinforcementCount > 1 ? ` [Reinforced: ${memory.reinforcementCount}x]` : '';
                longTermSection += `📚 [Importance: ${Math.round(memory.importance)}/10 | Confidence: ${confidence} | Relevance: ${relevance}]${reinforcement} ${memory.content}\n`;
            });
            longTermSection += '\n';

            if (tokenCount + longTermSection.length < maxTokens) {
                injection += longTermSection;
                tokenCount += longTermSection.length;
            }
        }

        // Add medium-term memories if space allows
        const mediumTermMemories = this.getMemoriesByTier('mediumTerm', { limit: 3 });
        if (mediumTermMemories.length > 0 && tokenCount < maxTokens * 0.9) {
            let mediumTermSection = `MEDIUM-TERM MEMORY (${mediumTermMemories.length} recent events):\n`;
            mediumTermMemories.forEach(memory => {
                mediumTermSection += `📝 ${memory.content}\n`;
            });
            mediumTermSection += '\n';

            if (tokenCount + mediumTermSection.length < maxTokens) {
                injection += mediumTermSection;
                tokenCount += mediumTermSection.length;
            }
        }

        injection += `[End of Multi-Tier Memory Context - ${Math.round(tokenCount/4)} tokens used]`;

        return injection;
    }

    // Get memories by tier with optional filtering
    static getMemoriesByTier(tier, options = {}) {
        if (!this.memoryTiers[tier]) return [];

        let memories = Array.from(this.memoryTiers[tier].values());

        // Apply filters
        if (options.minImportance) {
            memories = memories.filter(m => m.importance >= options.minImportance);
        }

        if (options.topics) {
            memories = memories.filter(m => 
                m.topics && m.topics.some(topic => 
                    options.topics.some(filterTopic => 
                        topic.toLowerCase().includes(filterTopic.toLowerCase())
                    )
                )
            );
        }

        if (options.characters) {
            memories = memories.filter(m => 
                m.characters && m.characters.some(char => 
                    options.characters.some(filterChar => 
                        char.toLowerCase().includes(filterChar.toLowerCase())
                    )
                )
            );
        }

        // Sort by importance and recency
        memories.sort((a, b) => {
            if (b.importance !== a.importance) {
                return b.importance - a.importance; // Higher importance first
            }
            return (b.messageIndex || 0) - (a.messageIndex || 0); // More recent first
        });

        return memories.slice(0, options.limit || memories.length);
    }

    // Update memory system when new summaries are created
    static async updateMemoryTiers() {
        await this.organizeMemories();
    }
}

// Advanced Memory Importance Weighting System
class MemoryWeightingSystem {
    static weightingConfig = {
        // Base importance factors
        recencyWeight: 0.3,           // How much recency affects importance
        reinforcementWeight: 0.2,     // How much repetition increases importance
        emotionalWeight: 0.25,        // How much emotional impact matters
        plotWeight: 0.15,             // How much plot significance matters
        relationshipWeight: 0.1,      // How much relationship changes matter
        
        // Decay factors
        recencyDecayRate: 0.1,        // How quickly memories fade with time
        maxDecayDays: 30,             // Maximum days before full decay
        
        // Reinforcement factors
        maxReinforcement: 5,          // Maximum reinforcement multiplier
        reinforcementThreshold: 3,    // Mentions needed for reinforcement
        
        // Context boosting
        contextRelevanceBoost: 0.3,   // Boost for contextually relevant memories
        characterPresenceBoost: 0.2   // Boost when character is mentioned
    };

    // Calculate dynamic importance score for a memory
    static calculateDynamicImportance(memoryData, currentContext = {}) {
        let baseImportance = memoryData.importance || 5;
        let weightedScore = baseImportance;
        
        // Apply recency weighting
        const recencyFactor = this.calculateRecencyFactor(memoryData.timestamp);
        weightedScore += (recencyFactor * this.weightingConfig.recencyWeight * 10);
        
        // Apply reinforcement weighting  
        const reinforcementFactor = this.calculateReinforcementFactor(memoryData.reinforcementCount || 1);
        weightedScore *= reinforcementFactor;
        
        // Apply emotional weighting
        const emotionalFactor = this.calculateEmotionalFactor(memoryData);
        weightedScore += (emotionalFactor * this.weightingConfig.emotionalWeight * 10);
        
        // Apply plot significance weighting
        const plotFactor = this.calculatePlotFactor(memoryData);
        weightedScore += (plotFactor * this.weightingConfig.plotWeight * 10);
        
        // Apply relationship weighting
        const relationshipFactor = this.calculateRelationshipFactor(memoryData);
        weightedScore += (relationshipFactor * this.weightingConfig.relationshipWeight * 10);
        
        // Apply context relevance boost
        const contextBoost = this.calculateContextRelevance(memoryData, currentContext);
        weightedScore += (contextBoost * this.weightingConfig.contextRelevanceBoost * 10);
        
        // Ensure score stays within reasonable bounds
        return Math.max(1, Math.min(15, weightedScore));
    }

    // Calculate how recency affects importance (newer = more important, with decay)
    static calculateRecencyFactor(timestamp) {
        const now = Date.now();
        const ageInDays = (now - timestamp) / (1000 * 60 * 60 * 24);
        const maxDecayDays = this.weightingConfig.maxDecayDays;
        
        if (ageInDays <= 1) return 1.0; // Last 24 hours = full weight
        if (ageInDays >= maxDecayDays) return 0.1; // After max days = minimal weight
        
        // Exponential decay between 1 day and max days
        const decayFactor = Math.exp(-this.weightingConfig.recencyDecayRate * ageInDays);
        return Math.max(0.1, decayFactor);
    }

    // Calculate reinforcement factor (repeated mentions increase importance)
    static calculateReinforcementFactor(reinforcementCount) {
        if (reinforcementCount <= 1) return 1.0;
        
        const factor = 1 + Math.log(reinforcementCount) * 0.2;
        return Math.min(this.weightingConfig.maxReinforcement, factor);
    }

    // Calculate emotional impact factor
    static calculateEmotionalFactor(memoryData) {
        const emotionalImpact = memoryData.emotionalImpact || 5;
        const emotionalTone = memoryData.emotionalTone || 'neutral';
        
        let factor = (emotionalImpact - 5) / 10; // Convert 1-10 to -0.4 to 0.5
        
        // Boost for strong emotional tones
        const strongEmotions = ['angry', 'sad', 'happy', 'excited', 'fearful', 'loving', 'tense', 'dramatic'];
        if (strongEmotions.includes(emotionalTone.toLowerCase())) {
            factor += 0.3;
        }
        
        return Math.max(0, factor);
    }

    // Calculate plot significance factor
    static calculatePlotFactor(memoryData) {
        const plotSignificance = memoryData.plotSignificance || 5;
        const memoryType = memoryData.memoryType || 'general';
        
        let factor = (plotSignificance - 5) / 10; // Convert 1-10 to -0.4 to 0.5
        
        // Boost for plot-relevant memory types
        if (memoryType === 'plot' || memoryType === 'worldbuilding') {
            factor += 0.2;
        }
        
        return Math.max(0, factor);
    }

    // Calculate relationship significance factor
    static calculateRelationshipFactor(memoryData) {
        const relationshipCount = memoryData.relationships?.length || 0;
        const memoryType = memoryData.memoryType || 'general';
        
        let factor = relationshipCount * 0.1; // Each relationship adds weight
        
        // Boost for relationship-focused memories
        if (memoryType === 'relationship') {
            factor += 0.3;
        }
        
        return Math.min(0.5, factor);
    }

    // Calculate contextual relevance to current conversation
    static calculateContextRelevance(memoryData, currentContext) {
        let relevanceScore = 0;
        
        if (!currentContext || Object.keys(currentContext).length === 0) {
            return 0;
        }
        
        // Check topic overlap
        if (currentContext.topics && memoryData.topics) {
            const topicOverlap = this.calculateTopicOverlap(currentContext.topics, memoryData.topics);
            relevanceScore += topicOverlap * 0.4;
        }
        
        // Check character presence
        if (currentContext.characters && memoryData.characters) {
            const characterOverlap = this.calculateCharacterOverlap(currentContext.characters, memoryData.characters);
            relevanceScore += characterOverlap * 0.3;
        }
        
        // Check emotional tone similarity
        if (currentContext.emotionalTone && memoryData.emotionalTone) {
            if (currentContext.emotionalTone === memoryData.emotionalTone) {
                relevanceScore += 0.2;
            }
        }
        
        // Check memory type relevance
        if (currentContext.memoryType && memoryData.memoryType) {
            if (currentContext.memoryType === memoryData.memoryType) {
                relevanceScore += 0.1;
            }
        }
        
        return Math.min(1.0, relevanceScore);
    }

    // Calculate topic overlap between current context and memory
    static calculateTopicOverlap(currentTopics, memoryTopics) {
        if (!currentTopics.length || !memoryTopics.length) return 0;
        
        const intersection = currentTopics.filter(topic => 
            memoryTopics.some(memTopic => 
                topic.toLowerCase().includes(memTopic.toLowerCase()) ||
                memTopic.toLowerCase().includes(topic.toLowerCase())
            )
        );
        
        return intersection.length / Math.max(currentTopics.length, memoryTopics.length);
    }

    // Calculate character overlap between current context and memory
    static calculateCharacterOverlap(currentCharacters, memoryCharacters) {
        if (!currentCharacters.length || !memoryCharacters.length) return 0;
        
        const intersection = currentCharacters.filter(char => 
            memoryCharacters.some(memChar => 
                char.toLowerCase() === memChar.toLowerCase()
            )
        );
        
        return intersection.length / Math.max(currentCharacters.length, memoryCharacters.length);
    }

    // Get current conversation context for relevance calculation
    static getCurrentContext() {
        const context = getContext();
        if (!context?.chat?.length) return {};
        
        // Analyze last few messages for current context
        const recentMessages = context.chat.slice(-3);
        const currentContext = {
            topics: [],
            characters: [],
            emotionalTone: 'neutral',
            memoryType: 'general'
        };
        
        // Extract topics and characters from recent messages
        recentMessages.forEach(msg => {
            const speaker = msg.name || (msg.is_user ? 'User' : 'Assistant');
            if (!currentContext.characters.includes(speaker)) {
                currentContext.characters.push(speaker);
            }
            
            // Simple topic extraction from message content
            const content = msg.mes.toLowerCase();
            if (content.includes('relationship') || content.includes('friend')) {
                if (!currentContext.topics.includes('relationship')) {
                    currentContext.topics.push('relationship');
                }
            }
            if (content.includes('world') || content.includes('place')) {
                if (!currentContext.topics.includes('worldbuilding')) {
                    currentContext.topics.push('worldbuilding');
                }
            }
            if (content.includes('plot') || content.includes('story')) {
                if (!currentContext.topics.includes('plot')) {
                    currentContext.topics.push('plot');
                }
            }
        });
        
        return currentContext;
    }

    // Update importance scores for all memories based on current context
    static updateMemoryImportanceScores() {
        const currentContext = this.getCurrentContext();
        const updatedMemories = new Map();
        
        for (const [messageIndex, memoryData] of messageSummaries) {
            const dynamicImportance = this.calculateDynamicImportance(memoryData, currentContext);
            
            // Update memory with new importance score
            const updatedMemory = {
                ...memoryData,
                dynamicImportance: dynamicImportance,
                lastUpdated: Date.now(),
                contextRelevance: this.calculateContextRelevance(memoryData, currentContext)
            };
            
            updatedMemories.set(messageIndex, updatedMemory);
        }
        
        // Update the global memory store
        for (const [index, memory] of updatedMemories) {
            messageSummaries.set(index, memory);
        }
        
        console.log(`[${MODULE_NAME}] Updated importance scores for ${updatedMemories.size} memories`);
    }

    // Reinforce a memory when it's referenced or becomes relevant
    static reinforceMemory(messageIndex, reinforcementType = 'mention') {
        const memoryData = messageSummaries.get(messageIndex);
        if (!memoryData) return;
        
        const reinforcementValue = {
            'mention': 1,
            'direct_reference': 2,
            'plot_continuation': 3,
            'emotional_callback': 2
        }[reinforcementType] || 1;
        
        const updatedMemory = {
            ...memoryData,
            reinforcementCount: (memoryData.reinforcementCount || 1) + reinforcementValue,
            lastReinforced: Date.now(),
            reinforcementType: reinforcementType
        };
        
        // Recalculate dynamic importance with new reinforcement
        const currentContext = this.getCurrentContext();
        updatedMemory.dynamicImportance = this.calculateDynamicImportance(updatedMemory, currentContext);
        
        messageSummaries.set(messageIndex, updatedMemory);
        
        console.log(`[${MODULE_NAME}] Reinforced memory ${messageIndex} (type: ${reinforcementType}, new count: ${updatedMemory.reinforcementCount})`);
    }
}

// Cross-Chat Character Persistence System (OPTIONAL)
class CrossChatPersistenceSystem {
    static crossChatMemories = new Map(); // { characterId: { traits: [], relationships: [], memories: [] } }
    static storageKey = 'nemolore_cross_chat_memories';
    static lastCleanup = Date.now();
    static cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours

    // Initialize cross-chat system (only if enabled)
    static async initialize() {
        if (!nemoLoreSettings.enableCrossChatPersistence) {
            console.log(`[${MODULE_NAME}] Cross-chat persistence disabled`);
            return;
        }

        console.log(`[${MODULE_NAME}] Initializing cross-chat character persistence...`);
        await this.loadCrossChatMemories();
        await this.performMaintenanceIfNeeded();
    }

    // Load cross-chat memories from storage
    static async loadCrossChatMemories() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const data = JSON.parse(stored);
                this.crossChatMemories = new Map(Object.entries(data.memories || {}));
                this.lastCleanup = data.lastCleanup || Date.now();
                console.log(`[${MODULE_NAME}] Loaded cross-chat memories for ${this.crossChatMemories.size} characters`);
            }
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error loading cross-chat memories:`, error);
        }
    }

    // Save cross-chat memories to storage
    static async saveCrossChatMemories() {
        if (!nemoLoreSettings.enableCrossChatPersistence) return;

        try {
            const data = {
                memories: Object.fromEntries(this.crossChatMemories),
                lastCleanup: this.lastCleanup,
                version: '1.0'
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
            console.log(`[${MODULE_NAME}] Saved cross-chat memories for ${this.crossChatMemories.size} characters`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error saving cross-chat memories:`, error);
        }
    }

    // Extract shareable information from current chat
    static async extractShareableMemories(characterName) {
        if (!nemoLoreSettings.enableCrossChatPersistence || !characterName) return;

        const sharingLevel = nemoLoreSettings.crossChatSharingLevel;
        if (sharingLevel === 'none') return;

        const shareableData = {
            traits: [],
            relationships: [],
            memories: [],
            lastUpdated: Date.now(),
            chatId: getCurrentChatId()
        };

        // Extract character traits from permanent memories
        if (sharingLevel === 'traits' || sharingLevel === 'all') {
            const permanentMemories = MultiTierMemorySystem.getMemoriesByTier('permanent');
            permanentMemories.forEach(memory => {
                if (memory.type === 'character_trait' && 
                    memory.character && 
                    memory.character.toLowerCase() === characterName.toLowerCase()) {
                    shareableData.traits.push({
                        trait: memory.trait,
                        evidence: this.sanitizeMemoryContent(memory.evidence),
                        importance: memory.importance,
                        confidence: memory.confidence || 0.8,
                        lastSeen: Date.now()
                    });
                }
            });
        }

        // Extract relationship information
        if (sharingLevel === 'relationships' || sharingLevel === 'all') {
            for (const [messageIndex, memoryData] of messageSummaries) {
                if (memoryData.relationships && memoryData.relationships.length > 0) {
                    memoryData.relationships.forEach(rel => {
                        if (rel.character1?.toLowerCase() === characterName.toLowerCase() ||
                            rel.character2?.toLowerCase() === characterName.toLowerCase()) {
                            shareableData.relationships.push({
                                type: rel.type,
                                with: rel.character1?.toLowerCase() === characterName.toLowerCase() ? rel.character2 : rel.character1,
                                description: this.sanitizeMemoryContent(rel.type),
                                importance: memoryData.importance || 5,
                                lastSeen: Date.now()
                            });
                        }
                    });
                }
            }
        }

        // Extract general memories (only if sharing level is 'all')
        if (sharingLevel === 'all') {
            const longTermMemories = MultiTierMemorySystem.getMemoriesByTier('longTerm', { limit: 10 });
            longTermMemories.forEach(memory => {
                if (memory.characters && 
                    memory.characters.some(char => char.toLowerCase() === characterName.toLowerCase()) &&
                    this.isMemoryPrivacySafe(memory)) {
                    shareableData.memories.push({
                        content: this.sanitizeMemoryContent(memory.content),
                        topics: memory.topics || [],
                        emotionalTone: memory.emotionalTone || 'neutral',
                        importance: memory.importance || 5,
                        memoryType: memory.memoryType || 'general',
                        lastSeen: Date.now()
                    });
                }
            });
        }

        // Store the shareable data
        if (shareableData.traits.length > 0 || shareableData.relationships.length > 0 || shareableData.memories.length > 0) {
            this.crossChatMemories.set(characterName.toLowerCase(), shareableData);
            await this.saveCrossChatMemories();
            console.log(`[${MODULE_NAME}] Extracted shareable memories for ${characterName}:`, {
                traits: shareableData.traits.length,
                relationships: shareableData.relationships.length,
                memories: shareableData.memories.length
            });
        }
    }

    // Get cross-chat memories for character injection
    static getCrossChatMemories(characterName) {
        if (!nemoLoreSettings.enableCrossChatPersistence || !characterName) return null;

        const memories = this.crossChatMemories.get(characterName.toLowerCase());
        if (!memories) return null;

        // Check if memories are too old
        const maxAge = nemoLoreSettings.crossChatDecayDays * 24 * 60 * 60 * 1000;
        if (Date.now() - memories.lastUpdated > maxAge) {
            console.log(`[${MODULE_NAME}] Cross-chat memories for ${characterName} are too old, skipping`);
            return null;
        }

        return memories;
    }

    // Generate cross-chat memory injection
    static generateCrossChatInjection(characterName) {
        const memories = this.getCrossChatMemories(characterName);
        if (!memories) return '';

        const currentChatId = getCurrentChatId();
        
        // Don't inject memories from the same chat
        if (memories.chatId === currentChatId) return '';

        let injection = `\n[CROSS-CHAT CHARACTER MEMORY - Previous Interactions]\n`;
        injection += `🔗 Character: ${characterName}\n`;
        injection += `📅 Last Updated: ${new Date(memories.lastUpdated).toLocaleDateString()}\n`;
        injection += `🔒 Privacy Level: ${nemoLoreSettings.crossChatSharingLevel}\n\n`;

        // Add character traits
        if (memories.traits && memories.traits.length > 0) {
            injection += `CHARACTER TRAITS (${memories.traits.length} known):\n`;
            memories.traits.slice(0, 5).forEach(trait => {
                injection += `🧑 ${trait.trait} (confidence: ${Math.round(trait.confidence * 100)}%)\n`;
            });
            injection += '\n';
        }

        // Add relationships
        if (memories.relationships && memories.relationships.length > 0) {
            injection += `RELATIONSHIPS (${memories.relationships.length} known):\n`;
            memories.relationships.slice(0, 3).forEach(rel => {
                injection += `🤝 ${rel.type} with ${rel.with}\n`;
            });
            injection += '\n';
        }

        // Add general memories
        if (memories.memories && memories.memories.length > 0) {
            injection += `PREVIOUS INTERACTIONS (${memories.memories.length} memories):\n`;
            memories.memories.slice(0, 2).forEach(memory => {
                injection += `💭 [${memory.memoryType}] ${memory.content.substring(0, 100)}...\n`;
            });
            injection += '\n';
        }

        injection += `[End of Cross-Chat Memory]`;

        return injection;
    }

    // Check if memory content is safe to share (privacy protection)
    static isMemoryPrivacySafe(memory) {
        if (!nemoLoreSettings.enableCrossChatPrivacy) return true;

        const content = memory.content.toLowerCase();
        const sensitiveKeywords = [
            'secret', 'private', 'confidential', 'personal', 'intimate',
            'password', 'address', 'phone', 'email', 'real name',
            'nsfw', 'sexual', 'romantic', 'kiss', 'love confession'
        ];

        return !sensitiveKeywords.some(keyword => content.includes(keyword));
    }

    // Sanitize memory content for cross-chat sharing
    static sanitizeMemoryContent(content) {
        if (!content) return '';

        // Remove overly specific details that might be too personal
        return content
            .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]') // Remove emails
            .replace(/\b\d{3}-\d{3}-\d{4}\b/g, '[phone]') // Remove phone numbers
            .replace(/\b\d{1,5}\s\w+\s(Street|St|Avenue|Ave|Road|Rd|Drive|Dr)\b/gi, '[address]') // Remove addresses
            .substring(0, 200); // Limit length
    }

    // Perform maintenance - cleanup old memories
    static async performMaintenanceIfNeeded() {
        const now = Date.now();
        if (now - this.lastCleanup < this.cleanupInterval) return;

        console.log(`[${MODULE_NAME}] Performing cross-chat memory maintenance...`);

        const maxAge = nemoLoreSettings.crossChatDecayDays * 24 * 60 * 60 * 1000;
        let cleanedCount = 0;

        for (const [characterName, memories] of this.crossChatMemories) {
            if (now - memories.lastUpdated > maxAge) {
                this.crossChatMemories.delete(characterName);
                cleanedCount++;
            }
        }

        this.lastCleanup = now;
        await this.saveCrossChatMemories();

        console.log(`[${MODULE_NAME}] Cross-chat maintenance complete. Cleaned ${cleanedCount} old character memories.`);
    }

    // Manual cleanup function
    static async clearCrossChatMemories(characterName = null) {
        if (characterName) {
            this.crossChatMemories.delete(characterName.toLowerCase());
            console.log(`[${MODULE_NAME}] Cleared cross-chat memories for ${characterName}`);
        } else {
            this.crossChatMemories.clear();
            console.log(`[${MODULE_NAME}] Cleared all cross-chat memories`);
        }
        await this.saveCrossChatMemories();
    }

    // Update memories when chat ends or changes
    static async onChatEnd() {
        if (!nemoLoreSettings.enableCrossChatPersistence) return;

        const context = getContext();
        if (!context?.chat?.length) return;

        // Extract character names from the current chat
        const characters = new Set();
        context.chat.forEach(msg => {
            const speaker = msg.name || (msg.is_user ? 'User' : 'Assistant');
            if (speaker !== 'User' && speaker !== 'Assistant') {
                characters.add(speaker);
            }
        });

        // Extract and store memories for each character
        for (const characterName of characters) {
            await this.extractShareableMemories(characterName);
        }
    }
}

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
                        console.log(`[${MODULE_NAME}] New message detected, processing...`);
                        processNewMessage(node);
                    }
                });
            } else if (mutation.type === 'characterData') {
                // Skip if the change is within our own highlighting spans
                let element = mutation.target.parentElement;
                while (element) {
                    if (element.classList?.contains('nemolore-highlighted-noun')) {
                        console.log(`[${MODULE_NAME}] Ignoring change within highlighting span`);
                        return; // Skip processing changes within our own highlights
                    }
                    if (element.classList?.contains('mes')) break;
                    element = element.parentElement;
                }
                
                // Handle text changes within message content
                let messageElement = mutation.target.parentElement;
                while (messageElement && !messageElement.classList?.contains('mes')) {
                    messageElement = messageElement.parentElement;
                }
                
                if (messageElement && messageElement.classList.contains('mes')) {
                    const textContent = messageElement.querySelector('.mes_text');
                    if (textContent && textContent.contains(mutation.target)) {
                        // Only reprocess if the message isn't already being processed and text content actually changed
                        if (!textContent.hasAttribute('data-nemolore-processing')) {
                            console.log(`[${MODULE_NAME}] Text change detected, reprocessing message`);
                            textContent.removeAttribute('data-nemolore-processed');
                            textContent.setAttribute('data-nemolore-processing', 'true');
                            
                            // Debounce to avoid excessive processing during typing
                            clearTimeout(textContent._nemoloreProcessTimeout);
                            textContent._nemoloreProcessTimeout = setTimeout(() => {
                                textContent.removeAttribute('data-nemolore-processing');
                                processNewMessage(messageElement);
                            }, 200);
                        }
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
        console.log(`[${MODULE_NAME}] Detected ${detectedNouns.length} nouns:`, detectedNouns);
        
        if (detectedNouns.length > 0) {
            NounDetector.highlightNouns(textContent, detectedNouns);
            console.log(`[${MODULE_NAME}] Applied highlighting to ${detectedNouns.length} nouns`);
        }
    }

    // Note: Individual message summarization is now handled through user consent flow
    // in checkForBulkSummarization() rather than automatically here
    if (nemoLoreSettings.enableSummarization) {
        const messageIndex = Array.from(messageElement.parentElement.children).indexOf(messageElement);
        if (messageIndex >= 0) {
            // Check if message already has a summary and refresh display
            if (MessageSummarizer.isMessageSummarized(messageIndex)) {
                console.log(`[${MODULE_NAME}] Message ${messageIndex} already summarized (or part of summarized pair)`);
                // Refresh summary display for already summarized messages
                setTimeout(() => {
                    MessageSummarizer.refreshSummaryDisplay();
                    MessageSummarizer.enhancedMemoryInjection();
                }, 200);
            } else {
                console.log(`[${MODULE_NAME}] Message ${messageIndex} detected but not auto-queuing (awaiting user consent)`);
            }
        }
    }
    
    // Mark as processed even if no processing occurred to prevent reprocessing
    if (!textContent.hasAttribute('data-nemolore-processed')) {
        textContent.setAttribute('data-nemolore-processed', 'true');
    }
}

function refreshChatHighlighting() {
    console.log(`[${MODULE_NAME}] Refreshing chat highlighting`);
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
    console.log(`[${MODULE_NAME}] Clearing all highlighting`);
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

// Handle chat changes - create lorebook and load existing summaries
async function handleChatChanged() {
    // Check if extension is enabled
    if (!nemoLoreSettings.enabled) return;
    
    const newChatId = getCurrentChatId();
    console.log(`[${MODULE_NAME}] handleChatChanged called for chat: ${newChatId}`);
    
    // Skip if we're already handling this chat (prevent duplicate processing)
    // But allow processing if chat ID is null/undefined (chat cleared/loading)
    if (newChatId && lastHandledChatId === newChatId) {
        console.log(`[${MODULE_NAME}] Already handled chat ${newChatId}, skipping duplicate call`);
        return;
    }
    
    console.log(`[${MODULE_NAME}] Processing chat change from ${lastHandledChatId} to ${newChatId}`);
    console.log(`[${MODULE_NAME}] Current messageSummaries size: ${messageSummaries.size}`);
    
    // Update the last handled chat ID
    lastHandledChatId = newChatId;
    
    // Reset UI state (but preserve summaries - they'll be managed by load/save functions)
    TooltipManager.hideTooltip();
    clearAllHighlighting();
    messageCount = 0;
    
    const chatId = getCurrentChatId();
    if (!chatId) {
        currentChatLorebook = null;
        lastHandledChatId = null; // Reset since no chat is active
        loadedSummariesChatId = null; // Reset loaded summaries tracking
        // Only clear summaries when no chat is active
        messageSummaries.clear();
        debugLog(`[${MODULE_NAME}] No active chat - cleared messageSummaries and reset tracking`);
        return;
    }
    
    debugLog(`[${MODULE_NAME}] Chat changed to: ${chatId}`);
    
    // Handle lorebook creation for new chats
    const existingLorebook = chat_metadata[METADATA_KEY];
    
    if (existingLorebook && world_names.includes(existingLorebook)) {
        // Use existing lorebook
        console.log(`[${MODULE_NAME}] Using existing lorebook: ${existingLorebook}`);
        currentChatLorebook = existingLorebook;
    } else if (nemoLoreSettings.createLorebookOnChat) {
        // Create lorebook immediately when chat starts (before any summarization)
        console.log(`[${MODULE_NAME}] Creating lorebook immediately for new chat...`);
        isLorebookCreationInProgress = true; // Block summarization during this process
        currentChatLorebook = await LorebookManager.createChatLorebook(chatId);
        
        if (currentChatLorebook) {
            console.log(`[${MODULE_NAME}] Successfully created lorebook at chat start: ${currentChatLorebook}`);
            
            // Show "flesh out the world" prompt to user
            setTimeout(async () => {
                const action = await NotificationSystem.show(
                    `📚 Lorebook "${currentChatLorebook}" created! Would you like to flesh out the world with people, places, and items from the character?`,
                    [
                        { action: 'yes', text: 'Yes, flesh out the world' },
                        { action: 'no', text: 'No, I\'ll add entries manually' }
                    ],
                    10000 // Give user time to decide
                );
                
                if (action === 'yes') {
                    console.log(`[${MODULE_NAME}] User chose to flesh out the world, generating initial entries...`);
                    await generateInitialLorebookEntries(currentChatLorebook);
                } else {
                    console.log(`[${MODULE_NAME}] User chose to manually add entries`);
                    await NotificationSystem.show(
                        `Lorebook is ready for manual entries. You can enhance it later from the settings.`,
                        [],
                        3000
                    );
                }
                
                // Clear the flag to allow normal summarization to proceed
                isLorebookCreationInProgress = false;
                debugLog(`[${MODULE_NAME}] Lorebook creation flow completed, summarization now enabled`);
            }, 1000); // Short delay to let UI settle and ensure chat is fully loaded
        } else {
            console.error(`[${MODULE_NAME}] Failed to create lorebook at chat start`);
            // Clear the flag even if lorebook creation failed
            isLorebookCreationInProgress = false;
        }
    } else if (nemoLoreSettings.autoCreateLorebook) {
        // Auto-create independent lorebook (separate from chat-based lorebook creation)
        console.log(`[${MODULE_NAME}] Creating auto lorebook for new chat...`);
        currentChatLorebook = await MessageSummarizer.createAutoLorebook(chatId);
    } else {
        // No lorebook creation enabled
        currentChatLorebook = null;
    }
    
    // Load existing summaries for this chat
    if (nemoLoreSettings.enableSummarization) {
        console.log(`[${MODULE_NAME}] Loading summaries for chat ${chatId}...`);
        MessageSummarizer.loadSummariesFromPersistentStorage();
        console.log(`[${MODULE_NAME}] After loading, messageSummaries size: ${messageSummaries.size}`);
        // Update summary count after loading
        setTimeout(() => updateSummaryCount(), 100);
    }
    
    // Refresh highlighting after a short delay to ensure DOM is ready
    setTimeout(() => {
        refreshChatHighlighting();
    }, 500);
    
    // Reinitialize chat monitoring
    setTimeout(() => {
        initializeChatMonitoring();
        
        // Update enhanced memory injection for the new chat
        if (nemoLoreSettings.enableSummarization) {
            MessageSummarizer.enhancedMemoryInjection();
        }
    }, 1000);
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
        
        // Save cross-chat memories for the previous chat (if enabled)
        if (nemoLoreSettings.enableCrossChatPersistence) {
            setTimeout(() => {
                CrossChatPersistenceSystem.extractAndSaveMemories();
            }, 1000); // Small delay to ensure chat data is stable
        }
    });

    // Handle chat clearing
    eventSource.on(event_types.CHAT_DELETED, () => {
        debugLog(`[${MODULE_NAME}] Chat deleted - clearing summaries and resetting state`);
        TooltipManager.hideTooltip();
        clearAllHighlighting();
        // Enhanced cleanup using state management system
        NemoLoreState.reset();
        NemoLoreState.currentChatLorebook = null;
        NemoLoreState.lastHandledChatId = null;
        NemoLoreState.loadedSummariesChatId = null;
        NemoLoreState.messageCount = 0;
        
        // Keep legacy global variables in sync for backward compatibility
        currentChatLorebook = null;
        messageCount = 0;
        messageSummaries.clear();
        vectorizedMessages.clear();
        highlightedNouns.clear();
        lastHandledChatId = null;
        loadedSummariesChatId = null;
        isLorebookCreationInProgress = false;
        isProcessingSummaries = false;
        summaryProcessingQueue.length = 0;
        totalChatTokens = 0;
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


// Generate initial lorebook entries for a newly created lorebook
async function generateInitialLorebookEntries(lorebookName) {
    if (!lorebookName) {
        console.error(`[${MODULE_NAME}] Cannot generate entries - no lorebook name provided`);
        return;
    }
    
    if (!active_character) {
        console.error(`[${MODULE_NAME}] Cannot generate entries - no active character`);
        await NotificationSystem.show(
            'Cannot generate lorebook entries: No character data available.',
            [],
            3000
        );
        return;
    }
    
    console.log(`[${MODULE_NAME}] Generating initial entries for lorebook: ${lorebookName}`);
    
    // Use the same character finding logic as enhanceExistingLorebook
    let characterData = characters[active_character];
    
    // If not found directly, try without file extension
    if (!characterData && active_character.includes('.')) {
        const nameWithoutExt = active_character.replace(/\.[^/.]+$/, "");
        characterData = characters[nameWithoutExt];
    }
    
    if (!characterData) {
        console.error(`[${MODULE_NAME}] Cannot generate entries - no character data found`);
        await NotificationSystem.show(
            'Cannot generate lorebook entries: Character data not available.',
            [],
            3000
        );
        return;
    }
    
    try {
        console.log(`[${MODULE_NAME}] Starting entry generation for character: ${characterData.name}`);
        
        // Show progress notification
        await NotificationSystem.show(
            `🎲 Generating world entries for ${characterData.name}... This may take a moment.`,
            [],
            3000
        );
        
        // Generate the entries using LorebookManager
        await LorebookManager.generateInitialEntries(characterData, lorebookName);
        
        // Success notification
        await NotificationSystem.show(
            `✨ World building complete! Your lorebook now contains rich entries for people, places, and items.`,
            [],
            4000
        );
        
        console.log(`[${MODULE_NAME}] Successfully generated initial entries for ${lorebookName}`);
        
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error generating initial entries:`, error);
        await NotificationSystem.show(
            `Error generating world entries: ${error.message}`,
            [],
            5000
        );
    }
}

async function initializeWorldExpansion() {
    console.log(`[${MODULE_NAME}] Direct world expansion triggered - skipping consent prompts`);
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

async function initializeWorldExpansionWithProgress(progressNotification) {
    console.log(`[${MODULE_NAME}] Direct world expansion triggered with progress tracking`);
    const chatId = getCurrentChatId();
    const lorebookName = await LorebookManager.createChatLorebook(chatId);
    
    if (lorebookName && active_character) {
        // Use the same character finding logic as initializeWorldExpansion
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
            // Create progress callback function
            const progressCallback = (step, message) => {
                progressNotification.updateProgress(step, message);
            };
            
            await LorebookManager.generateInitialEntries(characterData, lorebookName, progressCallback);
        } else {
            throw new Error('Cannot create lorebook entries: No character data available.');
        }
    } else {
        throw new Error('Cannot create lorebook: Missing chat ID or active character.');
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

// Summary Viewer Functions
function showSummaryViewer() {
    const chatId = getCurrentChatId();
    if (!chatId) {
        toastr.error('No active chat found', 'NemoLore');
        return;
    }

    const summariesInOrder = [];
    const context = getContext();
    if (!context || !context.chat) {
        toastr.error('Cannot access chat context', 'NemoLore');
        return;
    }

    // Collect summaries in message order
    for (let i = 0; i < context.chat.length; i++) {
        if (messageSummaries.has(i)) {
            const summaryData = messageSummaries.get(i);
            if (summaryData && summaryData.text) {
                const messageInfo = context.chat[i];
                const isUser = messageInfo.is_user === true || messageInfo.is_system === false;
                
                summariesInOrder.push({
                    messageIndex: i,
                    speaker: isUser ? 'User' : 'Character',
                    summary: summaryData.text,
                    timestamp: summaryData.timestamp ? new Date(summaryData.timestamp).toLocaleString() : 'Unknown',
                    isCoreMemory: summaryData.isCoreMemory || false,
                    isPaired: summaryData.isPaired || false,
                    pairedIndices: summaryData.pairedIndices || [i],
                    originalLength: summaryData.originalLength || messageInfo.mes.length
                });
            }
        }
    }

    if (summariesInOrder.length === 0) {
        toastr.info('No summaries found for this chat', 'NemoLore');
        return;
    }

    // Create the summary viewer HTML
    const summaryHtml = `
        <div style="max-height: 70vh; overflow-y: auto; padding: 10px;">
            <h3>Chat Summaries (${summariesInOrder.length} total)</h3>
            <div style="margin-bottom: 15px; padding: 10px; background: #f0f8ff; border-radius: 5px;">
                <strong>Usage:</strong> Copy <code>{{NemoLore}}</code> macro into prompts to inject these summaries.
            </div>
            ${summariesInOrder.map((item, index) => `
                <div style="margin-bottom: 15px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; ${item.isCoreMemory ? 'background: linear-gradient(145deg, #fff9c4, #fff3b0); border-color: #ffd700;' : 'background: white;'}">
                    <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: bold; color: #333;">
                            ${item.isCoreMemory ? '⭐ ' : ''}
                            Message ${item.isPaired ? item.pairedIndices.join('+') : item.messageIndex} 
                            (${item.speaker})
                        </span>
                        <small style="color: #666;">${item.timestamp}</small>
                    </div>
                    <div style="padding: 8px; background: #f9f9f9; border-left: 3px solid ${item.isCoreMemory ? '#ffd700' : '#007bff'}; margin: 8px 0;">
                        ${item.summary}
                    </div>
                    <small style="color: #888;">Original length: ${item.originalLength} chars | ${item.isPaired ? 'Paired' : 'Single'} message${item.isCoreMemory ? ' | Core Memory' : ''}</small>
                </div>
            `).join('')}
        </div>
    `;

    callPopup(summaryHtml, 'text', '', { wide: true, large: true });
}

function exportSummariesToJSON() {
    const chatId = getCurrentChatId();
    if (!chatId) {
        toastr.error('No active chat found', 'NemoLore');
        return;
    }

    const context = getContext();
    if (!context || !context.chat) {
        toastr.error('Cannot access chat context', 'NemoLore');
        return;
    }

    const exportData = {
        chatId: chatId,
        exportedAt: new Date().toISOString(),
        totalMessages: context.chat.length,
        summaryCount: messageSummaries.size,
        summaries: []
    };

    // Collect all summary data
    for (let i = 0; i < context.chat.length; i++) {
        if (messageSummaries.has(i)) {
            const summaryData = messageSummaries.get(i);
            if (summaryData && summaryData.text) {
                const messageInfo = context.chat[i];
                const isUser = messageInfo.is_user === true || messageInfo.is_system === false;
                
                exportData.summaries.push({
                    messageIndex: i,
                    speaker: isUser ? 'User' : 'Character',
                    summary: summaryData.text,
                    timestamp: summaryData.timestamp,
                    isCoreMemory: summaryData.isCoreMemory || false,
                    isPaired: summaryData.isPaired || false,
                    pairedIndices: summaryData.pairedIndices || [i],
                    originalLength: summaryData.originalLength || messageInfo.mes.length,
                    messageHash: summaryData.messageHash || summaryData.messageHashes,
                    rawResponse: summaryData.rawResponse
                });
            }
        }
    }

    if (exportData.summaries.length === 0) {
        toastr.info('No summaries to export for this chat', 'NemoLore');
        return;
    }

    // Download as JSON file
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `nemolore-summaries-${chatId}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toastr.success(`Exported ${exportData.summaries.length} summaries`, 'NemoLore');
}

function updateSummaryCount() {
    const count = messageSummaries.size;
    const countElements = [
        document.getElementById('nemolore_summary_count'),
        document.getElementById('nemolore_summary_count_fallback')
    ];
    
    countElements.forEach(element => {
        if (element) {
            if (count === 0) {
                element.textContent = 'No summaries available';
                element.style.color = '#888';
            } else {
                element.textContent = `${count} summaries available`;
                element.style.color = '#007bff';
            }
        }
    });
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

// Async API helper functions
async function refreshAsyncApiModels(provider) {
    console.log(`[${MODULE_NAME}] Refreshing models for ${provider}`);
    
    const modelSelect = document.getElementById('nemolore_async_api_model');
    const fallbackModelSelect = document.getElementById('nemolore_async_api_model_fallback');
    
    if (!modelSelect && !fallbackModelSelect) {
        console.error(`[${MODULE_NAME}] Could not find model select element`);
        return;
    }
    
    // Clear existing options
    [modelSelect, fallbackModelSelect].forEach(select => {
        if (select) {
            select.innerHTML = '<option value="">Loading models...</option>';
        }
    });
    
    try {
        const models = await AsyncAPI.refreshModels(provider);
        
        [modelSelect, fallbackModelSelect].forEach(select => {
            if (select) {
                select.innerHTML = '<option value="">Select a model</option>';
                let modelFound = false;
                
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name;
                    if (model.id === nemoLoreSettings.asyncApiModel) {
                        option.selected = true;
                        modelFound = true;
                        console.log(`[${MODULE_NAME}] Restored saved model selection: ${model.id}`);
                    }
                    select.appendChild(option);
                });
                
                // If saved model wasn't found, log this fact
                if (nemoLoreSettings.asyncApiModel && !modelFound) {
                    console.warn(`[${MODULE_NAME}] Saved model "${nemoLoreSettings.asyncApiModel}" not found in available models for ${provider}`);
                }
                
                // Ensure the dropdown value matches the setting
                if (modelFound) {
                    select.value = nemoLoreSettings.asyncApiModel;
                }
            }
        });
        
        console.log(`[${MODULE_NAME}] Loaded ${models.length} models for ${provider}`);
        
        if (models.length === 0) {
            toastr.warning(`No models found for ${provider}. You may need to configure your API key.`);
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error refreshing models:`, error);
        [modelSelect, fallbackModelSelect].forEach(select => {
            if (select) {
                select.innerHTML = '<option value="">Error loading models</option>';
            }
        });
        toastr.error(`Failed to load models for ${provider}: ${error.message}`);
    }
}

async function testAsyncApiConnection() {
    const provider = nemoLoreSettings.asyncApiProvider;
    const apiKey = nemoLoreSettings.asyncApiKey;
    const model = nemoLoreSettings.asyncApiModel;
    const endpoint = nemoLoreSettings.asyncApiEndpoint;
    
    if (!provider || !apiKey || !model) {
        toastr.warning('Please configure provider, API key, and model first');
        return;
    }
    
    console.log(`[${MODULE_NAME}] Testing API connection for ${provider}`);
    
    const testButton = document.getElementById('nemolore_test_async_api') || document.getElementById('nemolore_test_async_api_fallback');
    const originalText = testButton ? testButton.textContent : '';
    
    if (testButton) {
        testButton.textContent = '🔄 Testing...';
        testButton.disabled = true;
    }
    
    try {
        const result = await AsyncAPI.testConnection(provider, apiKey, model, endpoint);
        
        if (result.success) {
            toastr.success(result.message);
            console.log(`[${MODULE_NAME}] API test successful for ${provider}`);
        } else {
            toastr.error(result.message);
            console.error(`[${MODULE_NAME}] API test failed for ${provider}:`, result.message);
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] API test error:`, error);
        toastr.error(`Connection test failed: ${error.message}`);
    } finally {
        if (testButton) {
            testButton.textContent = originalText;
            testButton.disabled = false;
        }
    }
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
        'nemolore_auto_create_lorebook_fallback': (e) => { nemoLoreSettings.autoCreateLorebook = e.target.checked; },
        'nemolore_enable_summarization_fallback': (e) => { nemoLoreSettings.enableSummarization = e.target.checked; },
        'nemolore_enable_paired_summarization_fallback': (e) => { nemoLoreSettings.enablePairedSummarization = e.target.checked; },
        'nemolore_link_summaries_to_ai_fallback': (e) => { nemoLoreSettings.linkSummariesToAI = e.target.checked; },
        'nemolore_enable_vectorization_fallback': (e) => { nemoLoreSettings.enableVectorization = e.target.checked; },
        'nemolore_force_compatibility_mode_fallback': (e) => { 
            nemoLoreSettings.forceCompatibilityMode = e.target.checked;
            if (e.target.checked) {
                toastr.info('Compatibility mode will take effect after reloading the page.');
            }
        },
        'nemolore_enable_async_api_fallback': (e) => { 
            nemoLoreSettings.enableAsyncApi = e.target.checked;
            const container = document.getElementById('nemolore_async_api_container_fallback');
            if (container) {
                container.style.display = e.target.checked ? 'block' : 'none';
            }
        },
        'nemolore_async_api_provider_fallback': async (e) => { 
            nemoLoreSettings.asyncApiProvider = e.target.value;
            if (e.target.value) {
                await refreshAsyncApiModels(e.target.value);
            }
        },
        'nemolore_async_api_key_fallback': (e) => { nemoLoreSettings.asyncApiKey = e.target.value; },
        'nemolore_async_api_model_fallback': (e) => { nemoLoreSettings.asyncApiModel = e.target.value; },
        'nemolore_async_api_endpoint_fallback': (e) => { nemoLoreSettings.asyncApiEndpoint = e.target.value; }
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

    // Fallback summary viewer buttons
    const fallbackViewSummariesBtn = document.getElementById('nemolore_view_summaries_fallback');
    if (fallbackViewSummariesBtn) {
        fallbackViewSummariesBtn.addEventListener('click', showSummaryViewer);
    }

    const fallbackExportSummariesBtn = document.getElementById('nemolore_export_summaries_fallback');
    if (fallbackExportSummariesBtn) {
        fallbackExportSummariesBtn.addEventListener('click', exportSummariesToJSON);
    }

    const fallbackSystemCheckBtn = document.getElementById('nemolore_system_check_fallback');
    if (fallbackSystemCheckBtn) {
        fallbackSystemCheckBtn.addEventListener('click', runSystemCheck);
    }

    const fallbackWorldExpansionBtn = document.getElementById('nemolore_manual_world_expansion_fallback');
    if (fallbackWorldExpansionBtn) {
        fallbackWorldExpansionBtn.addEventListener('click', async () => {
            console.log(`[${MODULE_NAME}] Manual world expansion triggered by user (fallback)`);
            
            const steps = [
                'Building generation prompt...',
                'Sending request to AI...',
                'Processing AI response...',
                'Parsing lorebook entries...',
                'Adding entries to lorebook...',
                'Complete!'
            ];
            
            const progress = NotificationSystem.showProgress('World Expansion', steps);
            
            try {
                await initializeWorldExpansionWithProgress(progress);
                progress.complete('🌍 World expansion completed! Your lorebook has been updated with new entries.');
            } catch (error) {
                console.error(`[${MODULE_NAME}] Error during manual world expansion:`, error);
                progress.error(`❌ World expansion failed: ${error.message}`);
            }
        });
    }

    const fallbackRefreshModelsBtn = document.getElementById('nemolore_refresh_models_fallback');
    if (fallbackRefreshModelsBtn) {
        fallbackRefreshModelsBtn.addEventListener('click', async () => {
            if (nemoLoreSettings.asyncApiProvider) {
                await refreshAsyncApiModels(nemoLoreSettings.asyncApiProvider);
            } else {
                toastr.warning('Please select an API provider first');
            }
        });
    }

    const fallbackTestAsyncBtn = document.getElementById('nemolore_test_async_api_fallback');
    if (fallbackTestAsyncBtn) {
        fallbackTestAsyncBtn.addEventListener('click', testAsyncApiConnection);
    }
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
    
    const autoCreateLorebookElement = getElement('nemolore_auto_create_lorebook');
    if (autoCreateLorebookElement) autoCreateLorebookElement.checked = nemoLoreSettings.autoCreateLorebook;
    
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
    
    // New paired summarization settings
    const enablePairedSummarizationElement = getElement('nemolore_enable_paired_summarization');
    if (enablePairedSummarizationElement) enablePairedSummarizationElement.checked = nemoLoreSettings.enablePairedSummarization;
    
    const linkSummariesToAIElement = getElement('nemolore_link_summaries_to_ai');
    if (linkSummariesToAIElement) linkSummariesToAIElement.checked = nemoLoreSettings.linkSummariesToAI;
    
    const forceCompatibilityModeElement = getElement('nemolore_force_compatibility_mode');
    if (forceCompatibilityModeElement) forceCompatibilityModeElement.checked = nemoLoreSettings.forceCompatibilityMode;

    // Async API settings
    const enableAsyncApiElement = getElement('nemolore_enable_async_api');
    if (enableAsyncApiElement) {
        enableAsyncApiElement.checked = nemoLoreSettings.enableAsyncApi;
        // Show/hide container based on setting
        const asyncApiContainer = document.getElementById('nemolore_async_api_container') || document.getElementById('nemolore_async_api_container_fallback');
        if (asyncApiContainer) {
            asyncApiContainer.style.display = nemoLoreSettings.enableAsyncApi ? 'block' : 'none';
        }
    }
    
    const asyncApiProviderElement = getElement('nemolore_async_api_provider');
    if (asyncApiProviderElement) asyncApiProviderElement.value = nemoLoreSettings.asyncApiProvider;
    
    const asyncApiKeyElement = getElement('nemolore_async_api_key');
    if (asyncApiKeyElement) asyncApiKeyElement.value = nemoLoreSettings.asyncApiKey;
    
    const asyncApiModelElement = getElement('nemolore_async_api_model');
    if (asyncApiModelElement) {
        asyncApiModelElement.value = nemoLoreSettings.asyncApiModel;
        console.log(`[${MODULE_NAME}] Loading saved async API model: "${nemoLoreSettings.asyncApiModel}"`);
        console.log(`[${MODULE_NAME}] Model element value set to: "${asyncApiModelElement.value}"`);
    }
    
    const asyncApiEndpointElement = getElement('nemolore_async_api_endpoint');
    if (asyncApiEndpointElement) asyncApiEndpointElement.value = nemoLoreSettings.asyncApiEndpoint;
    
    // If a provider is already configured, refresh models to populate dropdown and restore selection
    if (nemoLoreSettings.asyncApiProvider) {
        console.log(`[${MODULE_NAME}] Provider already configured (${nemoLoreSettings.asyncApiProvider}), refreshing models...`);
        setTimeout(async () => {
            await refreshAsyncApiModels(nemoLoreSettings.asyncApiProvider);
        }, 500); // Small delay to ensure DOM is ready
    }

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

    // Cross-chat character persistence settings
    const enableCrossChatPersistenceElement = getElement('nemolore_enable_cross_chat_persistence');
    if (enableCrossChatPersistenceElement) enableCrossChatPersistenceElement.checked = nemoLoreSettings.enableCrossChatPersistence;
    
    const crossChatSharingLevelElement = getElement('nemolore_cross_chat_sharing_level');
    if (crossChatSharingLevelElement) crossChatSharingLevelElement.value = nemoLoreSettings.crossChatSharingLevel;
    
    const crossChatDecayDaysElement = getElement('nemolore_cross_chat_decay_days');
    if (crossChatDecayDaysElement) crossChatDecayDaysElement.value = nemoLoreSettings.crossChatDecayDays;
    
    const enableCrossChatPrivacyElement = getElement('nemolore_enable_cross_chat_privacy');
    if (enableCrossChatPrivacyElement) enableCrossChatPrivacyElement.checked = nemoLoreSettings.enableCrossChatPrivacy;

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

    // Initial summary count update
    updateSummaryCount();

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

    document.getElementById('nemolore_auto_create_lorebook').addEventListener('change', (e) => {
        nemoLoreSettings.autoCreateLorebook = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Auto-create independent lorebooks ${e.target.checked ? 'enabled' : 'disabled'}`);
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

    // New paired summarization settings
    document.getElementById('nemolore_enable_paired_summarization').addEventListener('change', (e) => {
        nemoLoreSettings.enablePairedSummarization = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Paired summarization ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    document.getElementById('nemolore_link_summaries_to_ai').addEventListener('change', (e) => {
        nemoLoreSettings.linkSummariesToAI = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Link summaries to AI ${e.target.checked ? 'enabled' : 'disabled'}`);
    });

    // Async API settings event handlers
    const asyncApiToggle = document.getElementById('nemolore_enable_async_api');
    const asyncApiContainer = document.getElementById('nemolore_async_api_container');
    
    if (asyncApiToggle && asyncApiContainer) {
        asyncApiToggle.addEventListener('change', (e) => {
            nemoLoreSettings.enableAsyncApi = e.target.checked;
            asyncApiContainer.style.display = e.target.checked ? 'block' : 'none';
            saveSettings();
            console.log(`[${MODULE_NAME}] Async API ${e.target.checked ? 'enabled' : 'disabled'}`);
        });
    }

    document.getElementById('nemolore_async_api_provider').addEventListener('change', async (e) => {
        nemoLoreSettings.asyncApiProvider = e.target.value;
        saveSettings();
        
        // Refresh models when provider changes
        if (e.target.value) {
            await refreshAsyncApiModels(e.target.value);
        }
        console.log(`[${MODULE_NAME}] Async API provider changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_async_api_key').addEventListener('input', (e) => {
        nemoLoreSettings.asyncApiKey = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Async API key updated`);
    });

    document.getElementById('nemolore_async_api_model').addEventListener('change', (e) => {
        nemoLoreSettings.asyncApiModel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Async API model changed to: ${e.target.value}`);
        console.log(`[${MODULE_NAME}] Model saved to settings:`, nemoLoreSettings.asyncApiModel);
    });

    document.getElementById('nemolore_async_api_endpoint').addEventListener('input', (e) => {
        nemoLoreSettings.asyncApiEndpoint = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Async API endpoint changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_refresh_models').addEventListener('click', async () => {
        if (nemoLoreSettings.asyncApiProvider) {
            await refreshAsyncApiModels(nemoLoreSettings.asyncApiProvider);
        } else {
            toastr.warning('Please select an API provider first');
        }
    });

    document.getElementById('nemolore_test_async_api').addEventListener('click', async () => {
        await testAsyncApiConnection();
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

    // Cross-chat character persistence event handlers
    document.getElementById('nemolore_enable_cross_chat_persistence').addEventListener('change', (e) => {
        nemoLoreSettings.enableCrossChatPersistence = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Cross-chat character persistence ${e.target.checked ? 'enabled' : 'disabled'}`);
        
        // Initialize or cleanup cross-chat system based on setting
        if (e.target.checked) {
            setTimeout(async () => {
                await CrossChatPersistenceSystem.initialize();
            }, 100);
        } else {
            CrossChatPersistenceSystem.clearAllMemories();
        }
    });

    document.getElementById('nemolore_cross_chat_sharing_level').addEventListener('change', (e) => {
        nemoLoreSettings.crossChatSharingLevel = e.target.value;
        saveSettings();
        console.log(`[${MODULE_NAME}] Cross-chat sharing level changed to: ${e.target.value}`);
    });

    document.getElementById('nemolore_cross_chat_decay_days').addEventListener('input', (e) => {
        nemoLoreSettings.crossChatDecayDays = parseInt(e.target.value);
        saveSettings();
        console.log(`[${MODULE_NAME}] Cross-chat memory retention changed to: ${e.target.value} days`);
    });

    document.getElementById('nemolore_enable_cross_chat_privacy').addEventListener('change', (e) => {
        nemoLoreSettings.enableCrossChatPrivacy = e.target.checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Cross-chat privacy protection ${e.target.checked ? 'enabled' : 'disabled'}`);
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

    // Summary Viewer event handlers
    document.getElementById('nemolore_view_summaries').addEventListener('click', () => {
        showSummaryViewer();
    });

    document.getElementById('nemolore_export_summaries').addEventListener('click', () => {
        exportSummariesToJSON();
    });

    document.getElementById('nemolore_system_check').addEventListener('click', () => {
        runSystemCheck();
    });

    document.getElementById('nemolore_manual_world_expansion').addEventListener('click', async () => {
        console.log(`[${MODULE_NAME}] Manual world expansion triggered by user`);
        
        const steps = [
            'Building generation prompt...',
            'Sending request to AI...',
            'Processing AI response...',
            'Parsing lorebook entries...',
            'Adding entries to lorebook...',
            'Complete!'
        ];
        
        const progress = NotificationSystem.showProgress('World Expansion', steps);
        
        try {
            await initializeWorldExpansionWithProgress(progress);
            progress.complete('🌍 World expansion completed! Your lorebook has been updated with new entries.');
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error during manual world expansion:`, error);
            progress.error(`❌ World expansion failed: ${error.message}`);
        }
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
        // Use import.meta.url to get the current module path
        let extensionPath = '/scripts/extensions/third-party/Nemo-Lore'; // fallback
        
        if (import.meta && import.meta.url) {
            try {
                const moduleUrl = new URL(import.meta.url);
                const pathParts = moduleUrl.pathname.split('/');
                const indexPos = pathParts.findIndex(part => part === 'third-party');
                if (indexPos !== -1 && pathParts[indexPos + 1]) {
                    extensionPath = `/scripts/extensions/third-party/${pathParts[indexPos + 1]}`;
                }
            } catch (e) {
                console.warn(`[${MODULE_NAME}] Could not determine extension path, using fallback`);
            }
        }
        
        const response = await fetch(`${extensionPath}/settings.html`);
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
        
        /* Progress notification styles */
        .nemolore-progress-notification {
            min-width: 350px;
            max-width: 500px;
        }
        
        .nemolore-progress-container {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 10px 0;
        }
        
        .nemolore-progress-bar {
            flex: 1;
            height: 8px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .nemolore-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #6b46c1, #8b5cf6);
            border-radius: 4px;
            transition: width 0.3s ease;
        }
        
        .nemolore-progress-text {
            font-weight: 600;
            font-size: 12px;
            min-width: 35px;
            text-align: right;
            color: #6b46c1;
        }
        
        .nemolore-progress-step {
            font-size: 13px;
            color: #666;
            margin-top: 5px;
            font-style: italic;
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
    
    // Initialize error recovery system
    NemoLoreState.initErrorRecovery();
    
    // Initialize chat monitoring for highlighting and message processing
    initializeChatMonitoring();
    
    // Refresh highlighting for existing messages (only if chat is already loaded)
    setTimeout(() => {
        const chatContainer = document.getElementById('chat');
        if (chatContainer && chatContainer.children.length > 0) {
            console.log(`[${MODULE_NAME}] Initial highlighting refresh for ${chatContainer.children.length} messages`);
            refreshChatHighlighting();
        }
    }, 1000); // Increased delay to avoid race conditions
    
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
    
    // Initialize cross-chat character persistence system (optional feature)
    setTimeout(async () => {
        await CrossChatPersistenceSystem.initialize();
    }, 1500);
    
    isInitialized = true;
    console.log(`[${MODULE_NAME}] Initialized successfully`);
}

// Extension lifecycle - SillyTavern will call this automatically
jQuery(() => {
    init();
    
    // Register NemoLore macro for summary injection
    MacrosParser.registerMacro(NEMOLORE_MACRO, () => getNemoLoreSummaries());
    MacrosParser.registerMacro('NemoLoreFleshWorld', () => {
        initializeWorldExpansion();
        return 'NemoLore world expansion initiated...';
    });
    
    console.log(`[${MODULE_NAME}] Macros registered: {{${NEMOLORE_MACRO}}} and {{NemoLoreFleshWorld}}}`);
});

// System Check Function - Tests all core NemoLore functionality
async function runSystemCheck() {
    console.log(`[${MODULE_NAME}] ================================`);
    console.log(`[${MODULE_NAME}] Starting NemoLore System Check`);
    console.log(`[${MODULE_NAME}] ================================`);
    
    const results = {
        passed: 0,
        failed: 0,
        warnings: 0,
        details: []
    };
    
    function addResult(category, test, status, message, details = null) {
        const result = { category, test, status, message, details };
        results.details.push(result);
        
        if (status === 'PASS') {
            results.passed++;
            console.log(`[${MODULE_NAME}] ✅ ${category} - ${test}: ${message}`);
        } else if (status === 'FAIL') {
            results.failed++;
            console.log(`[${MODULE_NAME}] ❌ ${category} - ${test}: ${message}`, details || '');
        } else if (status === 'WARN') {
            results.warnings++;
            console.log(`[${MODULE_NAME}] ⚠️ ${category} - ${test}: ${message}`, details || '');
        }
    }
    
    try {
        // 1. Core Dependencies Check
        addResult('Dependencies', 'getContext', 
            typeof getContext === 'function' ? 'PASS' : 'FAIL',
            typeof getContext === 'function' ? 'Available' : 'Missing - core SillyTavern function not available'
        );
        
        addResult('Dependencies', 'getCurrentChatId', 
            typeof getCurrentChatId === 'function' ? 'PASS' : 'FAIL',
            typeof getCurrentChatId === 'function' ? 'Available' : 'Missing - chat ID function not available'
        );
        
        addResult('Dependencies', 'loadWorldInfo', 
            typeof loadWorldInfo === 'function' ? 'PASS' : 'FAIL',
            typeof loadWorldInfo === 'function' ? 'Available' : 'Missing - lorebook functions not available'
        );
        
        // 2. Settings Check
        addResult('Settings', 'NemoLore Settings', 
            nemoLoreSettings ? 'PASS' : 'FAIL',
            nemoLoreSettings ? 'Loaded successfully' : 'Failed to load settings'
        );
        
        addResult('Settings', 'Extension Enabled', 
            nemoLoreSettings && nemoLoreSettings.enabled ? 'PASS' : 'WARN',
            nemoLoreSettings && nemoLoreSettings.enabled ? 'Extension is enabled' : 'Extension is disabled'
        );
        
        // 3. Chat Context Check
        const chatId = typeof getCurrentChatId === 'function' ? getCurrentChatId() : null;
        addResult('Context', 'Active Chat', 
            chatId ? 'PASS' : 'WARN',
            chatId ? `Chat ID: ${chatId}` : 'No active chat - some tests may be limited'
        );
        
        if (typeof getContext === 'function') {
            const context = getContext();
            const messageCount = context && context.chat ? context.chat.length : 0;
            addResult('Context', 'Messages Available', 
                messageCount > 0 ? 'PASS' : 'WARN',
                messageCount > 0 ? `${messageCount} messages in chat` : 'No messages available for testing'
            );
        }
        
        // 4. Lorebook System Check
        addResult('Lorebook', 'Current Chat Lorebook', 
            currentChatLorebook ? 'PASS' : 'WARN',
            currentChatLorebook ? `Using lorebook: ${currentChatLorebook}` : 'No lorebook assigned to current chat'
        );
        
        if (currentChatLorebook && typeof loadWorldInfo === 'function') {
            try {
                const worldInfo = await loadWorldInfo(currentChatLorebook);
                const entryCount = worldInfo && worldInfo.entries ? Object.keys(worldInfo.entries).length : 0;
                addResult('Lorebook', 'Lorebook Data', 
                    worldInfo ? 'PASS' : 'FAIL',
                    worldInfo ? `Loaded with ${entryCount} entries` : 'Failed to load lorebook data'
                );
            } catch (error) {
                addResult('Lorebook', 'Lorebook Data', 'FAIL', 'Error loading lorebook', error.message);
            }
        }
        
        // 5. Noun Detection System
        const testText = "Hello, Alex! How are you doing today in the park? The weather looks great.";
        try {
            const detectedNouns = NounDetector.detectNouns(testText);
            addResult('Noun Detection', 'Basic Detection', 
                Array.isArray(detectedNouns) && detectedNouns.length > 0 ? 'PASS' : 'WARN',
                Array.isArray(detectedNouns) ? `Detected ${detectedNouns.length} nouns: ${detectedNouns.join(', ')}` : 'Noun detection failed'
            );
        } catch (error) {
            addResult('Noun Detection', 'Basic Detection', 'FAIL', 'Error in noun detection', error.message);
        }
        
        // 6. Summary System Check
        addResult('Summaries', 'Summarization Enabled', 
            nemoLoreSettings && nemoLoreSettings.enableSummarization ? 'PASS' : 'WARN',
            nemoLoreSettings && nemoLoreSettings.enableSummarization ? 'Enabled' : 'Disabled'
        );
        
        addResult('Summaries', 'Paired Summarization', 
            nemoLoreSettings && nemoLoreSettings.enablePairedSummarization ? 'PASS' : 'WARN',
            nemoLoreSettings && nemoLoreSettings.enablePairedSummarization ? 'Enabled' : 'Disabled'
        );
        
        const summaryCount = messageSummaries ? messageSummaries.size : 0;
        addResult('Summaries', 'Loaded Summaries', 
            summaryCount >= 0 ? 'PASS' : 'FAIL',
            `${summaryCount} summaries currently loaded`
        );
        
        // 6.5. Async API System Check
        addResult('Async API', 'Configuration', 
            nemoLoreSettings && nemoLoreSettings.enableAsyncApi ? 
                (nemoLoreSettings.asyncApiProvider && nemoLoreSettings.asyncApiKey && nemoLoreSettings.asyncApiModel ? 'PASS' : 'WARN') : 
                'WARN',
            nemoLoreSettings && nemoLoreSettings.enableAsyncApi ? 
                `Enabled: ${nemoLoreSettings.asyncApiProvider} - ${nemoLoreSettings.asyncApiModel}` : 
                'Disabled - using SillyTavern API'
        );
        
        if (nemoLoreSettings && nemoLoreSettings.enableAsyncApi && nemoLoreSettings.asyncApiProvider && nemoLoreSettings.asyncApiKey && nemoLoreSettings.asyncApiModel) {
            try {
                console.log(`[${MODULE_NAME}] System Check: Testing async API connection...`);
                const testResult = await AsyncAPI.testConnection(
                    nemoLoreSettings.asyncApiProvider,
                    nemoLoreSettings.asyncApiKey,
                    nemoLoreSettings.asyncApiModel,
                    nemoLoreSettings.asyncApiEndpoint
                );
                
                addResult('Async API', 'Connection Test', 
                    testResult.success ? 'PASS' : 'FAIL',
                    testResult.message
                );
            } catch (error) {
                addResult('Async API', 'Connection Test', 'FAIL', 'Connection test failed', error.message);
            }
        }
        
        // 7. Memory System Check
        addResult('Memory', 'Running Memory Size', 
            nemoLoreSettings && nemoLoreSettings.runningMemorySize > 0 ? 'PASS' : 'WARN',
            nemoLoreSettings ? `Set to ${nemoLoreSettings.runningMemorySize} messages` : 'Not configured'
        );
        
        // 8. Context Extraction Check
        if (typeof getContext === 'function') {
            try {
                const testContext = await MessageSummarizer.extractContextFromChat(0);
                addResult('Context Extraction', 'Time/Location/NPC Tracking', 
                    testContext ? 'PASS' : 'WARN',
                    testContext ? `Found: time=${testContext.timeContext || 'none'}, location=${testContext.locationContext || 'none'}, NPCs=${testContext.npcContext ? testContext.npcContext.length : 0}` : 'Context extraction failed'
                );
            } catch (error) {
                console.warn(`[${MODULE_NAME}] Context extraction check failed:`, error);
                addResult('Context Extraction', 'Time/Location/NPC Tracking', 'WARN', 'Context extraction check skipped - function may not be available');
            }
        } else {
            addResult('Context Extraction', 'Time/Location/NPC Tracking', 'WARN', 'getContext function not available');
        }
        
        // 9. UI Elements Check
        const uiElements = [
            'nemolore_enabled',
            'nemolore_highlight', 
            'nemolore_enable_summarization',
            'nemolore_view_summaries',
            'nemolore_system_check'
        ];
        
        let uiElementsFound = 0;
        uiElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) uiElementsFound++;
        });
        
        addResult('UI', 'Settings Elements', 
            uiElementsFound === uiElements.length ? 'PASS' : uiElementsFound > 0 ? 'WARN' : 'FAIL',
            `${uiElementsFound}/${uiElements.length} UI elements found`
        );
        
        // 10. Macro System Check
        try {
            const macroExists = typeof MacrosParser !== 'undefined' && MacrosParser.getAll && MacrosParser.getAll().hasOwnProperty(NEMOLORE_MACRO);
            addResult('Macros', 'NemoLore Macro', 
                macroExists ? 'PASS' : 'WARN',
                `{{${NEMOLORE_MACRO}}} macro registration`
            );
        } catch (macroError) {
            console.warn(`[${MODULE_NAME}] Macro check failed:`, macroError);
            addResult('Macros', 'NemoLore Macro', 'WARN', 'Macro check failed - MacrosParser may not be available');
        }
        
    } catch (error) {
        console.error(`[${MODULE_NAME}] System check error:`, error);
        addResult('System', 'Overall Check', 'FAIL', `System check encountered an error: ${error.message}`, error.stack);
    }
    
    // Generate Summary Report
    console.log(`[${MODULE_NAME}] ================================`);
    console.log(`[${MODULE_NAME}] System Check Summary:`);
    console.log(`[${MODULE_NAME}] ✅ Passed: ${results.passed}`);
    console.log(`[${MODULE_NAME}] ⚠️ Warnings: ${results.warnings}`);
    console.log(`[${MODULE_NAME}] ❌ Failed: ${results.failed}`);
    console.log(`[${MODULE_NAME}] ================================`);
    
    // Show user-friendly popup with results
    const statusEmoji = results.failed > 0 ? '❌' : results.warnings > 0 ? '⚠️' : '✅';
    const statusText = results.failed > 0 ? 'Issues Found' : results.warnings > 0 ? 'Warnings' : 'All Good';
    
    const detailsHtml = results.details.map(r => {
        const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
        return `<div style="margin: 5px 0; font-size: 12px; color: #333;"><strong>${icon} ${r.category} - ${r.test}:</strong> ${r.message}</div>`;
    }).join('');
    
    await callPopup(`
        <div class="nemolore-system-check-popup" style="color: #333; background: #fff; padding: 20px; border-radius: 8px;">
            <h3 style="color: #222; margin-top: 0;">${statusEmoji} NemoLore System Check - ${statusText}</h3>
            <div style="margin: 15px 0; color: #333;">
                <strong>Results:</strong> ${results.passed} passed, ${results.warnings} warnings, ${results.failed} failed
            </div>
            <div style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 15px; background: #f8f9fa; color: #333; border-radius: 4px;">
                ${detailsHtml}
            </div>
            <div style="margin-top: 15px; font-size: 11px; color: #666;">
                Check the console for detailed logs and technical information.
            </div>
        </div>
    `);
    
    return results;
}

export { MODULE_NAME };
