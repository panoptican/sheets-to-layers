## TICKET-023: Unit Tests & Integration Tests

**Type:** Technical Task  
**Priority:** Medium  

### Description

Implement comprehensive test coverage for core plugin functionality including unit tests for parsers and integration tests for sync operations.

### Requirements

- Unit tests for URL parsing
- Unit tests for layer name parsing
- Unit tests for special data type parsing
- Unit tests for sheet data normalization
- Integration tests for sync scenarios
- Mock Figma API for testing

### Technical Specifications

**Test Setup:**

```typescript
// jest.config.js or vitest.config.ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./tests/setup.ts'],
  moduleNameMapper: {
    // Mock Figma globals
  }
};

// tests/setup.ts
import { mockFigmaAPI } from './mocks/figma';
globalThis.figma = mockFigmaAPI();
```

**Parser Tests:**

```typescript
// tests/parsers/layerName.test.ts
import { parseLayerName, normalizeLabel, matchLabel } from '../../src/core/parser';

describe('parseLayerName', () => {
  describe('label extraction', () => {
    it('extracts single label', () => {
      const result = parseLayerName('#Title');
      expect(result.hasBinding).toBe(true);
      expect(result.labels).toEqual(['Title']);
    });
    
    it('extracts multiple labels', () => {
      const result = parseLayerName('#status #colour');
      expect(result.labels).toEqual(['status', 'colour']);
    });
    
    it('handles no binding', () => {
      const result = parseLayerName('Regular Layer');
      expect(result.hasBinding).toBe(false);
    });
  });
  
  describe('worksheet extraction', () => {
    it('extracts worksheet reference', () => {
      const result = parseLayerName('Page 1 // Properties');
      expect(result.worksheet).toBe('Properties');
    });
  });
  
  describe('index extraction', () => {
    it('extracts specific index', () => {
      const result = parseLayerName('#Title.5');
      expect(result.index).toEqual({ type: 'specific', value: 5 });
    });
    
    it('extracts increment index', () => {
      const result = parseLayerName('#Title.n');
      expect(result.index).toEqual({ type: 'increment' });
    });
    
    // ... more index tests
  });
  
  describe('ignore prefix', () => {
    it('detects ignore prefix', () => {
      const result = parseLayerName('-Dashboard');
      expect(result.isIgnored).toBe(true);
    });
  });
});

describe('normalizeLabel', () => {
  it('removes spaces', () => {
    expect(normalizeLabel('First Name')).toBe('firstname');
  });
  
  it('removes underscores', () => {
    expect(normalizeLabel('first_name')).toBe('firstname');
  });
  
  it('lowercases', () => {
    expect(normalizeLabel('TITLE')).toBe('title');
  });
});

describe('matchLabel', () => {
  const sheetLabels = ['First Name', 'Email', 'Status'];
  
  it('matches exact case', () => {
    expect(matchLabel('First Name', sheetLabels)).toBe('First Name');
  });
  
  it('matches different case', () => {
    expect(matchLabel('FIRST NAME', sheetLabels)).toBe('First Name');
  });
  
  it('matches with underscores', () => {
    expect(matchLabel('first_name', sheetLabels)).toBe('First Name');
  });
  
  it('returns null for no match', () => {
    expect(matchLabel('Unknown', sheetLabels)).toBeNull();
  });
});
```

**Special Data Type Tests:**

```typescript
// tests/parsers/specialDataTypes.test.ts
import { 
  parseHexColor, 
  parseOpacity, 
  parseDimension,
  parseChainedSpecialTypes
} from '../../src/core/specialDataTypes';

describe('parseHexColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseHexColor('#FF0000')).toEqual({ r: 1, g: 0, b: 0 });
  });
  
  it('parses 3-digit hex', () => {
    expect(parseHexColor('#F00')).toEqual({ r: 1, g: 0, b: 0 });
  });
  
  it('parses 1-digit hex', () => {
    expect(parseHexColor('#A')).toEqual({ r: 0.667, g: 0.667, b: 0.667 });
  });
  
  it('returns null for non-hex', () => {
    expect(parseHexColor('red')).toBeNull();
  });
});

describe('parseChainedSpecialTypes', () => {
  it('parses multiple types', () => {
    const result = parseChainedSpecialTypes('#f00, 50%, 20º');
    expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
    expect(result.opacity).toBe(0.5);
    expect(result.rotation).toBe(20);
  });
});
```

**Integration Tests:**

```typescript
// tests/integration/sync.test.ts
import { runSync } from '../../src/core/syncEngine';
import { createMockDocument } from '../mocks/figma';

describe('Sync Integration', () => {
  beforeEach(() => {
    // Reset mock document
    figma.root = createMockDocument();
  });
  
  it('syncs text content correctly', async () => {
    // Setup mock sheet data
    // Setup mock text layer
    // Run sync
    // Assert text content updated
  });
  
  it('handles repeat frames', async () => {
    // Setup mock with auto-layout frame
    // Run sync
    // Assert children duplicated
  });
});
```

### Dependencies

All feature tickets

### Acceptance Criteria

- [ ] 80%+ code coverage on core modules
- [ ] All parser edge cases tested
- [ ] Integration tests cover main sync scenarios
- [ ] Tests run in CI pipeline
- [ ] Mock Figma API is comprehensive enough for testing