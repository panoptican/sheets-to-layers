## TICKET-018: Plugin UI - Data Preview Mode

**Type:** Feature  
**Priority:** Medium  

### Description

Implement the data preview interface that displays fetched sheet data in a table format, allows worksheet switching, and enables click-to-rename functionality for layer naming.

### Requirements

- Display sheet data in a table format
- Show labels as column/row headers
- Tab interface for multiple worksheets
- Clickable cells that rename selected Figma layers
- "Sync" button to proceed with sync after preview
- Visual indication of clickable elements

### Technical Specifications

**Preview Table Component:**

```typescript
interface PreviewTableProps {
  worksheet: Worksheet;
  onLabelClick: (label: string) => void;
  onCellClick: (label: string, index: number, value: string) => void;
  onIndexClick: (index: number) => void;
}

function PreviewTable({ worksheet, onLabelClick, onCellClick, onIndexClick }: PreviewTableProps) {
  return (
    <div className="preview-table-container">
      <table className="preview-table">
        <thead>
          <tr>
            <th>#</th>
            {worksheet.labels.map(label => (
              <th 
                key={label} 
                className="clickable-header"
                onClick={() => onLabelClick(label)}
                title={`Click to name selected layers #${label}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {getValueRows(worksheet).map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td 
                className="index-cell clickable"
                onClick={() => onIndexClick(rowIndex + 1)}
                title={`Click to add .${rowIndex + 1} to selected layer names`}
              >
                {rowIndex + 1}
              </td>
              {row.map((value, colIndex) => (
                <td 
                  key={colIndex}
                  className="value-cell clickable"
                  onClick={() => onCellClick(
                    worksheet.labels[colIndex], 
                    rowIndex + 1, 
                    value
                  )}
                  title="Click to name layer with this specific value"
                >
                  {truncateValue(value, 50)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getValueRows(worksheet: Worksheet): string[][] {
  const maxRows = Math.max(
    ...worksheet.labels.map(l => worksheet.rows[l]?.length ?? 0)
  );
  
  const rows: string[][] = [];
  for (let i = 0; i < maxRows; i++) {
    rows.push(worksheet.labels.map(l => worksheet.rows[l]?.[i] ?? ''));
  }
  return rows;
}
```

**Worksheet Tabs:**

```typescript
interface WorksheetTabsProps {
  worksheets: Worksheet[];
  activeWorksheet: string;
  onTabClick: (worksheetName: string) => void;
}

function WorksheetTabs({ worksheets, activeWorksheet, onTabClick }: WorksheetTabsProps) {
  return (
    <div className="worksheet-tabs">
      {worksheets.map(ws => (
        <button
          key={ws.name}
          className={`tab ${ws.name === activeWorksheet ? 'active' : ''}`}
          onClick={() => onTabClick(ws.name)}
        >
          {ws.name}
        </button>
      ))}
    </div>
  );
}
```

**Layer Renaming Messages:**

```typescript
// When user clicks a label header
function handleLabelClick(label: string): void {
  parent.postMessage({
    type: 'RENAME_SELECTION',
    payload: { 
      nameSuffix: `#${label}` 
    }
  }, '*');
}

// When user clicks a specific cell
function handleCellClick(label: string, index: number, value: string): void {
  parent.postMessage({
    type: 'RENAME_SELECTION',
    payload: { 
      nameSuffix: `#${label}.${index}` 
    }
  }, '*');
}

// When user clicks an index number
function handleIndexClick(index: number): void {
  parent.postMessage({
    type: 'RENAME_SELECTION',
    payload: { 
      nameSuffix: `.${index}` 
    }
  }, '*');
}
```

**Plugin-side Rename Handler:**

```typescript
function handleRenameSelection(nameSuffix: string): void {
  const selection = figma.currentPage.selection;
  
  for (const node of selection) {
    // Append suffix to existing name
    node.name = `${node.name} ${nameSuffix}`;
  }
  
  figma.notify(`Renamed ${selection.length} layer(s)`);
}
```

### Dependencies

TICKET-017

### Acceptance Criteria

- [ ] Displays sheet data in readable table format
- [ ] Shows all worksheets as clickable tabs
- [ ] Clicking label header renames selected layers with `#Label`
- [ ] Clicking cell renames selected layers with `#Label.Index`
- [ ] Clicking index adds `.Index` to selected layer names
- [ ] Sync button appears in preview mode
- [ ] Hovering shows helpful tooltips
- [ ] Long values are truncated with ellipsis
- [ ] Empty cells display appropriately