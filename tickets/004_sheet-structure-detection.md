## TICKET-004: Sheet Structure Detection & Orientation

**Type:** Feature  
**Priority:** High  

### Description

Implement automatic detection of sheet structure including label positions (top row vs. left column) based on bold formatting conventions, and normalize data into a consistent internal format regardless of orientation.

### Requirements

- Detect whether labels are in the top row or left column
- Use bold formatting as the orientation indicator (bolded left column = row-based labels)
- Handle edge cases (no bold formatting defaults to column headers)
- Parse and normalize data into consistent Label → Values structure
- Detect the data bounds (avoid including stray content outside the grid)

### Technical Specifications

**Orientation Detection Logic:**

```typescript
interface SheetMetadata {
  orientation: 'columns' | 'rows';
  labels: string[];
  valueCount: number;
}

function detectOrientation(rawData: string[][], formatting?: CellFormatting[][]): SheetMetadata {
  // If first column cells are bold and first row is not → row orientation
  // Otherwise → column orientation (default)
  
  // Note: Google Sheets CSV export doesn't include formatting
  // May need to use the Sheets API v4 or alternative detection:
  // - Heuristic: if first column has unique values and first row doesn't → likely row-based
}

// Alternative heuristic when formatting unavailable:
function detectOrientationHeuristic(rawData: string[][]): 'columns' | 'rows' {
  if (rawData.length === 0) return 'columns';
  
  const firstRow = rawData[0];
  const firstCol = rawData.map(row => row[0]);
  
  // Check for patterns suggesting row-based layout
  // (e.g., first column has label-like strings, first row has value-like content)
}
```

**Data Normalization:**

```typescript
function normalizeSheetData(
  rawData: string[][], 
  orientation: 'columns' | 'rows'
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  
  if (orientation === 'columns') {
    // First row = labels, subsequent rows = values
    const labels = rawData[0];
    labels.forEach((label, colIndex) => {
      normalized[label] = rawData.slice(1).map(row => row[colIndex] || '');
    });
  } else {
    // First column = labels, subsequent columns = values
    rawData.forEach(row => {
      const label = row[0];
      normalized[label] = row.slice(1);
    });
  }
  
  return normalized;
}
```

**Data Bounds Detection:**

```typescript
function findDataBounds(rawData: string[][]): { rows: number; cols: number } {
  // Find the last row/column with any non-empty content
  // This prevents stray content outside the main grid from being included
}
```

### Dependencies

TICKET-003

### Acceptance Criteria

- [ ] Correctly identifies column-based label orientation (default)
- [ ] Correctly identifies row-based label orientation when applicable
- [ ] Normalizes both orientations into consistent Label → Values format
- [ ] Ignores empty rows/columns beyond the data grid
- [ ] Handles sheets with only one row or column
- [ ] Handles empty sheets gracefully