## TICKET-024: Documentation & README

**Type:** Technical Task  
**Priority:** Low  

### Description

Create comprehensive documentation for the plugin including user guide, developer documentation, and API reference.

### Requirements

- User-facing documentation (how to use)
- Developer setup instructions
- API/architecture documentation
- Inline code documentation
- Example use cases

### Technical Specifications

**README.md Structure:**

```markdown
# Sheets Sync for Figma

Sync content from Google Sheets into your Figma designs.

## Features
- Sync text content from spreadsheets
- Load images from URLs
- Swap components based on data
- Repeat layers automatically
- Apply styling (colors, opacity, size, etc.)

## Installation
[Instructions for installing from Figma Community]

## Quick Start
1. Make sure your Google Sheet is set to "Anyone with the link can view"
2. Name your Figma layers with `#` followed by the column name
3. Run the plugin and paste your sheet URL
4. Click "Fetch & Sync"

## Layer Naming Reference

### Basic Syntax
- `#ColumnName` - Sync content from the named column
- `//WorksheetName` - Use a specific worksheet tab
- `.N` - Use a specific row (1-based)
- `.n` - Auto-increment through rows
- `.x` - Random row selection

### Examples
| Layer Name | Result |
|------------|--------|
| `#Title` | First available title value |
| `#Price.5` | 5th price value |
| `Card // Products #Name.n` | Names from Products sheet, incrementing |

## Special Data Types
[Table of all special data types with examples]

## Development

### Setup
\`\`\`bash
npm install
npm run dev
\`\`\`

### Building
\`\`\`bash
npm run build
\`\`\`

### Testing
\`\`\`bash
npm test
\`\`\`

## Architecture
[High-level architecture diagram and explanation]

## Contributing
[Contribution guidelines]

## License
MIT
```

**Inline Documentation:**

```typescript
/**
 * Parses a Figma layer name to extract data binding instructions.
 * 
 * @param layerName - The name of the Figma layer
 * @returns Parsed binding information including labels, worksheet, and index
 * 
 * @example
 * // Basic label
 * parseLayerName('#Title')
 * // => { hasBinding: true, labels: ['Title'], ... }
 * 
 * @example
 * // With worksheet and index
 * parseLayerName('Card // Products #Name.5')
 * // => { hasBinding: true, labels: ['Name'], worksheet: 'Products', index: { type: 'specific', value: 5 } }
 */
function parseLayerName(layerName: string): ParsedLayerName {
  // ...
}
```

### Dependencies

All feature tickets

### Acceptance Criteria

- [ ] README covers all features with examples
- [ ] Developer can set up project from README
- [ ] All public functions have JSDoc comments
- [ ] Example use cases demonstrate common scenarios
- [ ] Architecture is documented for future maintenance