## TICKET-008: Index Tracking System

**Type:** Feature  
**Priority:** High  

### Description

Implement the index tracking system that manages which value index to use for each label during sync. Handles auto-increment, random selection, and reset behavior.

### Requirements

- Track current index per label during sync
- Implement auto-increment behavior (`.n` and default)
- Implement increment-ignoring-blanks behavior (`.i`)
- Implement random selection (`.x`) with optional blank skipping (`.r`)
- Reset to beginning when all values exhausted
- Handle random history to avoid immediate repeats

### Technical Specifications

**Index Tracker:**

```typescript
class IndexTracker {
  private incrementCounters: Map<string, number> = new Map();
  private incrementNonBlankCounters: Map<string, number> = new Map();
  private randomHistory: Map<string, Set<number>> = new Map();
  
  constructor(private sheetData: SheetData) {}
  
  getNextIndex(
    label: string, 
    indexType: IndexType, 
    worksheetName?: string
  ): number {
    const worksheet = worksheetName 
      ? this.sheetData.worksheets.find(w => w.name === worksheetName)
      : this.sheetData.worksheets[0];
      
    if (!worksheet) {
      throw new Error(`Worksheet not found: ${worksheetName}`);
    }
    
    const values = worksheet.rows[label] || [];
    const maxIndex = values.length;
    
    if (maxIndex === 0) {
      return -1; // No values available
    }
    
    switch (indexType.type) {
      case 'specific':
        // 1-based index from layer name
        return Math.min(indexType.value - 1, maxIndex - 1);
        
      case 'increment':
        return this.getIncrementIndex(label, maxIndex, false);
        
      case 'incrementNonBlank':
        return this.getIncrementIndex(label, maxIndex, true, values);
        
      case 'random':
        return this.getRandomIndex(label, maxIndex, false, values);
        
      case 'randomNonBlank':
        return this.getRandomIndex(label, maxIndex, true, values);
    }
  }
  
  private getIncrementIndex(
    label: string, 
    maxIndex: number, 
    skipBlanks: boolean,
    values?: string[]
  ): number {
    const counterMap = skipBlanks 
      ? this.incrementNonBlankCounters 
      : this.incrementCounters;
    
    let current = counterMap.get(label) ?? 0;
    
    if (skipBlanks && values) {
      // Find next non-blank value
      while (current < maxIndex && !values[current]?.trim()) {
        current++;
      }
    }
    
    // Reset if exhausted
    if (current >= maxIndex) {
      current = 0;
      if (skipBlanks && values) {
        while (current < maxIndex && !values[current]?.trim()) {
          current++;
        }
      }
    }
    
    counterMap.set(label, current + 1);
    return current;
  }
  
  private getRandomIndex(
    label: string, 
    maxIndex: number, 
    skipBlanks: boolean,
    values: string[]
  ): number {
    const historyKey = `${label}-${skipBlanks}`;
    let history = this.randomHistory.get(historyKey) ?? new Set();
    
    // Build available indices
    let available: number[] = [];
    for (let i = 0; i < maxIndex; i++) {
      if (skipBlanks && !values[i]?.trim()) continue;
      if (!history.has(i)) available.push(i);
    }
    
    // Reset if exhausted
    if (available.length === 0) {
      history = new Set();
      this.randomHistory.set(historyKey, history);
      for (let i = 0; i < maxIndex; i++) {
        if (skipBlanks && !values[i]?.trim()) continue;
        available.push(i);
      }
    }
    
    // Pick random from available
    const randomIdx = Math.floor(Math.random() * available.length);
    const selected = available[randomIdx];
    history.add(selected);
    this.randomHistory.set(historyKey, history);
    
    return selected;
  }
  
  reset(): void {
    this.incrementCounters.clear();
    this.incrementNonBlankCounters.clear();
    this.randomHistory.clear();
  }
}
```

### Dependencies

TICKET-004

### Acceptance Criteria

- [ ] Auto-increment returns sequential indices for same label
- [ ] Specific index returns correct (1-based to 0-based conversion)
- [ ] Increment wraps to beginning when values exhausted
- [ ] Non-blank increment skips empty values
- [ ] Random selection doesn't repeat until all values used
- [ ] Random non-blank skips empty values
- [ ] Reset clears all tracking state