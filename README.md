# NemoLore - Memory Management & Automated Lorebook Creation

NemoLore is a comprehensive SillyTavern extension that provides intelligent memory management and automated lorebook creation capabilities. It features advanced noun detection, interactive highlighting, and AI-powered content generation to enhance your roleplay experience.

## Features

### 🎯 Intelligent Noun Detection
- Advanced pattern recognition for proper nouns, names, locations, and fictional entities
- Context-aware filtering to exclude common words
- Support for fantasy/fictional naming conventions
- Configurable minimum length and exclusion rules

### ✨ Interactive Chat Enhancement
- Real-time highlighting of detected nouns in chat messages
- Click-to-interact functionality for highlighted terms
- Hover effects and visual feedback
- Non-intrusive integration with existing chat UI

### 📚 Automated Lorebook Management
- Automatic lorebook creation for new chats
- AI-powered initial content generation based on character sheets
- Context-aware lorebook entry creation
- Seamless integration with SillyTavern's world info system

### 🤖 Smart Content Generation
- Analyzes character information to create relevant lorebook entries
- Generates entries for people, locations, items, and lore elements
- Context-aware descriptions based on chat history
- Configurable generation prompts and templates

### 🔄 Periodic Updates
- Configurable message interval tracking
- Optional automatic lorebook updates
- Manual update prompts with user control
- Progressive enhancement of existing entries

### 🎛️ User-Friendly Interface
- Clean, integrated settings panel
- Non-blocking notification system
- Customizable timeouts and intervals
- Responsive design for all screen sizes

## Installation

1. Download or clone this extension into your SillyTavern extensions directory:
   ```
   /public/scripts/extensions/third-party/NemoLore/
   ```

2. Restart SillyTavern or reload the page

3. The extension will automatically initialize and appear in your extensions settings

## Usage

### Initial Setup
1. Enable NemoLore in the extensions settings
2. Configure your preferred settings (highlighting, auto-creation, intervals)
3. Start a new chat or load an existing one

### First Chat Experience
1. When you start a new chat, NemoLore will prompt you to create a lorebook
2. If you accept, it will analyze your character's information and generate initial entries
3. The lorebook will be automatically linked to your chat

### Interactive Features
1. **Noun Highlighting**: Detected nouns appear with colored highlighting
2. **Click Interaction**: Click any highlighted noun to:
   - View existing lorebook entries
   - Create new entries for unrecognized terms
   - Edit existing entries directly

### Periodic Updates
1. After the configured number of messages, NemoLore will offer to update your lorebook
2. You can accept, decline, or enable automatic mode
3. Updates analyze recent chat content to enhance existing entries

## Configuration Options

### Basic Settings
- **Enable NemoLore**: Master toggle for the extension
- **Highlight Nouns in Chat**: Toggle noun highlighting display
- **Auto-create Lorebook for New Chats**: Automatically create lorebooks
- **Automatic Update Mode**: Enable hands-off lorebook updates

### Advanced Settings
- **Update Interval**: Number of messages between update prompts (10-200)
- **Notification Timeout**: How long notifications remain visible (1-30 seconds)
- **Noun Detection Sensitivity**: Minimum word length and filtering options

## Technical Details

### Noun Detection Algorithm
NemoLore uses multiple pattern recognition techniques:
1. **Proper Noun Patterns**: Capitalized words and phrases
2. **Mixed Case Detection**: CamelCase and unusual capitalizations  
3. **Contextual Filtering**: Excludes common English words and sentence starters
4. **Fantasy Name Recognition**: Special patterns for fictional names

### Lorebook Integration
- Creates unique lorebooks per chat with timestamp naming
- Stores lorebook references in chat metadata
- Uses SillyTavern's native world info system
- Maintains compatibility with existing lorebook workflows

### AI Generation
- Uses SillyTavern's quiet prompt system for content generation
- Analyzes character sheets, descriptions, and chat context
- Generates structured JSON responses for reliable parsing
- Includes error handling and fallback mechanisms

## Troubleshooting

### Common Issues

**Extension doesn't load**
- Check that all files are in the correct directory structure
- Ensure SillyTavern is fully reloaded after installation
- Check browser console for JavaScript errors

**Nouns aren't being highlighted**
- Verify highlighting is enabled in settings
- Check that messages are being processed (new messages should highlight)
- Ensure minimum word length settings aren't too restrictive

**Lorebook creation fails**
- Verify you have an active API connection
- Check that world info permissions are properly configured
- Look for error messages in the browser console

**Performance issues**
- Consider reducing update frequency for very long chats
- Disable highlighting for better performance on slower devices
- Check chat length and lorebook size

### Debug Information

Enable browser developer tools to access console logs:
- Look for `[NemoLore]` prefixed messages
- Check for JavaScript errors during noun detection
- Monitor API calls during lorebook generation

## Compatibility

### SillyTavern Versions
- Compatible with SillyTavern 1.10.0+
- Tested with both stable and staging branches
- Works with all major SillyTavern themes

### API Compatibility  
- Works with all SillyTavern-supported APIs (OpenAI, Claude, local models, etc.)
- Requires API access for content generation features
- Noun highlighting works without API connection

### Extension Compatibility
- Compatible with other world info extensions
- Works alongside existing lorebook managers
- Non-conflicting with chat enhancement extensions

## Future Development

NemoLore is designed to be expandable. Planned features include:

- **Advanced Entity Recognition**: Better detection of relationships and concepts
- **Multi-language Support**: Noun detection for non-English content
- **Template System**: Customizable generation prompts and entry formats
- **Export/Import**: Share lorebook templates and configurations
- **Analytics Dashboard**: Track extension usage and lorebook growth
- **Integration APIs**: Allow other extensions to interact with NemoLore

## Contributing

This extension is designed to be the foundation for a comprehensive memory management toolkit. Contributions, suggestions, and feedback are welcome.

## License

This project is open source and available under the MIT License.

---

**NemoLore** - Enhancing your SillyTavern experience through intelligent memory management and automated content creation.