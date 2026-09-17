/**
 * Layer name parsing utilities.
 *
 * Parses Figma layer names to extract data binding instructions.
 * This module handles the #Label syntax for binding layers to sheet columns/rows,
 * the //Worksheet syntax for specifying source worksheets, and the .N index
 * syntax for specifying which row's value to use.
 *
 * Syntax reference:
 * - #Label           → Bind to column "Label"
 * - #"First Name"    → Bind to a label that needs spaces or control characters
 * - #Label #Other    → Multiple labels (first for content, others for properties)
 * - #Label.5         → Bind to column "Label", use row 5 (1-based)
 * - #Label.n         → Explicit auto-increment
 * - #Label.i         → Auto-increment, skip blank values
 * - #Label.x         → Random index
 * - #Label.r         → Random index, skip blanks
 * - // Worksheet     → Use specific worksheet tab
 * - // "Q1 / East"   → Use a worksheet name that needs escaping
 * - -LayerName       → Ignore this layer and children
 * - +ComponentName   → Force include main component (normally skipped)
 * - @#               → Repeat frame marker (duplicate children to match data rows)
 */

import type { BindingAction, ParsedLayerName, IndexType } from './types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Pattern to extract labels from layer names.
 * Matches #Label where Label can contain:
 * - Alphanumeric characters
 * - Underscores and hyphens (as word separators)
 *
 * Labels do NOT contain spaces. To reference a sheet column "First Name",
 * use #first_name or #FirstName in the layer name. The matching algorithm
 * handles normalization.
 *
 * The label ends at:
 * - A space (end of label)
 * - Another # (next label)
 * - A . (index specifier)
 * - A / (worksheet specifier when doubled)
 * - End of string
 */
const SIMPLE_LABEL_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SIMPLE_WORKSHEET_PATTERN = /^[a-zA-Z0-9_-]+(?: [a-zA-Z0-9_-]+)*$/;

/**
 * Pattern to detect repeat frame marker (@#).
 */
/**
 * Index specification patterns.
 * These must appear at the end of the layer name (after any labels).
 */
const INDEX_PATTERNS: Array<{ pattern: RegExp; type: IndexType['type'] }> = [
  { pattern: /\.(\d+)$/, type: 'specific' },
  { pattern: /\.n$/i, type: 'increment' },
  { pattern: /\.i$/i, type: 'incrementNonBlank' },
  { pattern: /\.x$/i, type: 'random' },
  { pattern: /\.r$/i, type: 'randomNonBlank' },
];

/**
 * Remove escaped parser control characters so they are treated as literals.
 *
 * Supported escapes:
 * - \#  literal #
 * - \/  literal /
 * - \\  literal \
 */
/** Read a quoted parser token, decoding backslash escapes. */
function readQuotedToken(value: string, start: number): { value: string; end: number } | null {
  if (value[start] !== '"') {
    return null;
  }

  let token = '';
  for (let index = start + 1; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      token += value[index + 1];
      index++;
      continue;
    }
    if (char === '"') {
      return { value: token, end: index + 1 };
    }
    token += char;
  }

  return null;
}

function escapeToken(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type BindingToken =
  | { kind: 'label'; start: number; end: number; value: string }
  | { kind: 'worksheet'; start: number; end: number; value: string }
  | { kind: 'repeat'; start: number; end: number };

interface BindingSyntax {
  tokens: BindingToken[];
  index?: IndexType;
  indexStart?: number;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function isInsideQuotedToken(value: string, target: number): boolean {
  for (let index = 0; index < target; index++) {
    if (value[index] !== '"' || isEscaped(value, index)) continue;
    const quoted = readQuotedToken(value, index);
    if (quoted && quoted.end > target) return true;
    if (quoted) index = quoted.end - 1;
  }
  return false;
}

function findTerminalIndex(value: string): Pick<BindingSyntax, 'index' | 'indexStart'> {
  for (const { pattern, type } of INDEX_PATTERNS) {
    const match = value.match(pattern);
    if (!match || match.index === undefined || isEscaped(value, match.index) || isInsideQuotedToken(value, match.index)) {
      continue;
    }
    return {
      index: type === 'specific'
        ? { type: 'specific', value: parseInt(match[1], 10) }
        : { type },
      indexStart: match.index,
    };
  }
  return {};
}

/**
 * Scan instructions once, respecting quotes and escapes throughout. Token spans
 * are reused when binding edits preserve the human-visible part of a name.
 */
function scanBindingSyntax(value: string): BindingSyntax {
  const terminalIndex = findTerminalIndex(value);
  const limit = terminalIndex.indexStart ?? value.length;
  const tokens: BindingToken[] = [];

  for (let index = 0; index < limit; index++) {
    if (value[index] === '\\') {
      index++;
      continue;
    }
    if (value[index] === '"') {
      const quoted = readQuotedToken(value, index);
      if (quoted) index = quoted.end - 1;
      continue;
    }
    if (value[index] === '@' && value[index + 1] === '#') {
      tokens.push({ kind: 'repeat', start: index, end: index + 2 });
      index++;
      continue;
    }
    if (value[index] === '#') {
      const quoted = readQuotedToken(value, index + 1);
      if (quoted) {
        if (quoted.value) tokens.push({ kind: 'label', start: index, end: quoted.end, value: quoted.value });
        index = quoted.end - 1;
        continue;
      }
      const match = value.slice(index + 1, limit).match(/^[a-zA-Z][a-zA-Z0-9_-]*/);
      if (match) {
        const end = index + 1 + match[0].length;
        tokens.push({ kind: 'label', start: index, end, value: match[0] });
        index = end - 1;
      }
      continue;
    }
    if (value[index] !== '/' || value[index + 1] !== '/') continue;

    let tokenStart = index + 2;
    while (/\s/.test(value[tokenStart] || '')) tokenStart++;
    const quoted = readQuotedToken(value, tokenStart);
    if (quoted) {
      if (quoted.value) tokens.push({ kind: 'worksheet', start: index, end: quoted.end, value: quoted.value });
      index = quoted.end - 1;
      continue;
    }

    let end = tokenStart;
    while (end < limit) {
      if (value[end] === '\\') {
        end += 2;
        continue;
      }
      if (value[end] === '#' || (value[end] === '@' && value[end + 1] === '#')) break;
      end++;
    }
    const worksheet = value.slice(tokenStart, end).trim();
    if (worksheet) tokens.push({ kind: 'worksheet', start: index, end, value: worksheet });
    index = end - 1;
  }

  return { tokens, ...terminalIndex };
}

function serializeLabel(label: string): string {
  return SIMPLE_LABEL_PATTERN.test(label) ? `#${label}` : `#"${escapeToken(label)}"`;
}

function serializeWorksheet(worksheet: string): string {
  return SIMPLE_WORKSHEET_PATTERN.test(worksheet)
    ? `// ${worksheet}`
    : `// "${escapeToken(worksheet)}"`;
}

function serializeIndex(index: IndexType): string {
  switch (index.type) {
    case 'specific':
      return `.${index.value}`;
    case 'increment':
      return '.n';
    case 'incrementNonBlank':
      return '.i';
    case 'random':
      return '.x';
    case 'randomNonBlank':
      return '.r';
  }
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse a Figma layer name to extract data binding instructions.
 *
 * @param layerName - The name of the Figma layer
 * @returns Parsed binding information
 *
 * @example
 * // Basic label
 * parseLayerName('#Title')
 * // => { hasBinding: true, labels: ['Title'], isIgnored: false, ... }
 *
 * @example
 * // Multiple labels
 * parseLayerName('#status #colour')
 * // => { hasBinding: true, labels: ['status', 'colour'], ... }
 *
 * @example
 * // With worksheet
 * parseLayerName('Page 1 // Properties')
 * // => { worksheet: 'Properties', ... }
 *
 * @example
 * // With index
 * parseLayerName('#Title.5')
 * // => { hasBinding: true, labels: ['Title'], index: { type: 'specific', value: 5 } }
 *
 * @example
 * // Combined syntax
 * parseLayerName('Card // Sheet2 #Name.3')
 * // => { worksheet: 'Sheet2', labels: ['Name'], index: { type: 'specific', value: 3 } }
 *
 * @example
 * // Ignored layer
 * parseLayerName('-Background')
 * // => { hasBinding: false, isIgnored: true, ... }
 *
 * @example
 * // Force include component
 * parseLayerName('+Card #Title')
 * // => { hasBinding: true, labels: ['Title'], forceInclude: true, ... }
 *
 * @example
 * // Repeat frame
 * parseLayerName('Cards @#')
 * // => { hasBinding: false, isRepeatFrame: true, ... }
 */
export function parseLayerName(layerName: string): ParsedLayerName {
  const result: ParsedLayerName = {
    hasBinding: false,
    labels: [],
    isIgnored: false,
    forceInclude: false,
    isRepeatFrame: false,
  };

  // Handle empty or whitespace-only input
  if (!layerName || !layerName.trim()) {
    return result;
  }

  let workingName = layerName;

  // Check for ignore prefix (- at start)
  if (workingName.startsWith('-')) {
    result.isIgnored = true;
    return result; // Ignored layers don't need further parsing
  }

  // Check for force include prefix (+ at start)
  if (workingName.startsWith('+')) {
    result.forceInclude = true;
    workingName = workingName.substring(1);
  }

  const syntax = scanBindingSyntax(workingName);
  result.isRepeatFrame = syntax.tokens.some((token) => token.kind === 'repeat');
  result.worksheet = syntax.tokens.find((token) => token.kind === 'worksheet')?.value;
  result.labels = syntax.tokens
    .filter((token): token is Extract<BindingToken, { kind: 'label' }> => token.kind === 'label')
    .map((token) => token.value);
  result.index = syntax.index;
  result.hasBinding = result.labels.length > 0;

  return result;
}

// ============================================================================
// Label Normalization & Matching
// ============================================================================

/**
 * Normalize a label for case-insensitive, whitespace-insensitive comparison.
 *
 * Removes spaces, underscores, and hyphens, then lowercases.
 * This allows "First Name", "first_name", "FIRST-NAME", and "firstName"
 * to all match each other.
 *
 * @param label - The label to normalize
 * @returns Normalized label string
 *
 * @example
 * normalizeLabel('First Name')  // => 'firstname'
 * normalizeLabel('first_name')  // => 'firstname'
 * normalizeLabel('FIRST-NAME')  // => 'firstname'
 * normalizeLabel('firstName')   // => 'firstname'
 */
export function normalizeLabel(label: string): string {
  return label.replace(/[\s_-]/g, '').toLowerCase();
}

/**
 * Cached label matcher for repeated lookups against the same sheet labels.
 */
export class LabelMatcher {
  private normalizedToOriginal: Map<string, string>;
  private ambiguousNormalized: Set<string>;

  constructor(sheetLabels: string[]) {
    this.normalizedToOriginal = new Map();
    this.ambiguousNormalized = new Set();

    for (const label of sheetLabels) {
      const normalized = normalizeLabel(label);
      if (this.normalizedToOriginal.has(normalized)) {
        this.ambiguousNormalized.add(normalized);
      } else {
        this.normalizedToOriginal.set(normalized, label);
      }
    }
  }

  /**
   * Match a layer label to a sheet label.
   *
   * Performs O(1) normalized exact lookup first, then falls back
   * to substring matching for compatibility with existing naming patterns.
   */
  match(layerLabel: string): string | null {
    if (!layerLabel) {
      return null;
    }

    const normalizedLayerLabel = normalizeLabel(layerLabel);
    if (!normalizedLayerLabel) {
      return null;
    }

    if (this.ambiguousNormalized.has(normalizedLayerLabel)) {
      return null;
    }

    const exactMatch = this.normalizedToOriginal.get(normalizedLayerLabel);
    if (exactMatch) {
      return exactMatch;
    }

    for (const [normalizedSheetLabel, originalLabel] of this.normalizedToOriginal) {
      if (!this.ambiguousNormalized.has(normalizedSheetLabel) && normalizedLayerLabel.includes(normalizedSheetLabel)) {
        return originalLabel;
      }
    }

    return null;
  }
}

/**
 * Create a reusable label matcher for a worksheet.
 */
export function createLabelMatcher(sheetLabels: string[]): LabelMatcher {
  return new LabelMatcher(sheetLabels);
}

/**
 * Find a matching label in the sheet labels array.
 *
 * Uses normalized comparison to match labels regardless of
 * case, spaces, underscores, or hyphens.
 *
 * @param layerLabel - The label from the layer name
 * @param sheetLabels - Array of labels from the sheet
 * @returns The original sheet label if found, null otherwise
 *
 * @example
 * matchLabel('first_name', ['First Name', 'Email', 'Status'])
 * // => 'First Name'
 *
 * @example
 * matchLabel('Unknown', ['First Name', 'Email', 'Status'])
 * // => null
 */
export function matchLabel(layerLabel: string, sheetLabels: string[]): string | null {
  return createLabelMatcher(sheetLabels).match(layerLabel);
}

/**
 * Check if a label exists in the sheet labels array.
 *
 * @param layerLabel - The label from the layer name
 * @param sheetLabels - Array of labels from the sheet
 * @returns true if the label matches any sheet label
 */
export function hasMatchingLabel(layerLabel: string, sheetLabels: string[]): boolean {
  return matchLabel(layerLabel, sheetLabels) !== null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract just the labels from a layer name without full parsing.
 * Useful for quick checks without the overhead of full parsing.
 *
 * @param layerName - The layer name to extract labels from
 * @returns Array of label strings
 */
export function extractLabels(layerName: string): string[] {
  const labels: string[] = [];

  // Skip ignored layers
  if (layerName.startsWith('-')) {
    return labels;
  }

  return parseLayerName(layerName).labels;
}

/**
 * Check if a layer name has any data bindings.
 *
 * @param layerName - The layer name to check
 * @returns true if the layer has at least one #Label binding
 */
export function hasBinding(layerName: string): boolean {
  return parseLayerName(layerName).hasBinding;
}

/**
 * Check if a layer should be ignored during sync.
 *
 * @param layerName - The layer name to check
 * @returns true if the layer starts with -
 */
export function isIgnoredLayer(layerName: string): boolean {
  return layerName.startsWith('-');
}

/**
 * Check if a layer is marked as a repeat frame.
 *
 * @param layerName - The layer name to check
 * @returns true if the layer contains @#
 */
export function isRepeatFrame(layerName: string): boolean {
  return parseLayerName(layerName).isRepeatFrame;
}

/**
 * Create an empty ParsedLayerName result.
 * Useful for initializing or resetting state.
 */
export function createEmptyParsedLayerName(): ParsedLayerName {
  return {
    hasBinding: false,
    labels: [],
    isIgnored: false,
    forceInclude: false,
    isRepeatFrame: false,
  };
}

// ============================================================================
// Worksheet & Index Utilities
// ============================================================================

/**
 * Extract just the worksheet from a layer name without full parsing.
 *
 * @param layerName - The layer name to extract worksheet from
 * @returns Worksheet name or undefined if not specified
 */
export function extractWorksheet(layerName: string): string | undefined {
  // Skip ignored layers
  if (layerName.startsWith('-')) {
    return undefined;
  }

  return parseLayerName(layerName).worksheet;
}

/**
 * Serialize binding instructions for a layer-name edit.
 *
 * The serializer deliberately emits only parser syntax. UI callers can add
 * display text around it, but keeping the index final prevents worksheet and
 * label edits from accidentally changing its meaning.
 */
export function serializeLayerName(parsed: ParsedLayerName): string {
  if (parsed.isIgnored) {
    return '-';
  }

  const tokens: string[] = [];
  if (parsed.forceInclude) {
    tokens.push('+');
  }
  if (parsed.isRepeatFrame) {
    tokens.push('@#');
  }
  if (parsed.worksheet) {
    tokens.push(serializeWorksheet(parsed.worksheet));
  }
  tokens.push(...parsed.labels.map(serializeLabel));

  const serialized = tokens.join(' ').replace(/^\+\s+/, '+');
  return parsed.index ? `${serialized}${serializeIndex(parsed.index)}` : serialized;
}

function getDisplayName(layerName: string, syntax: BindingSyntax): string {
  const spans = [
    ...syntax.tokens.map(({ start, end }) => ({ start, end })),
    ...(syntax.indexStart === undefined ? [] : [{ start: syntax.indexStart, end: layerName.length }]),
    ...(layerName.startsWith('+') ? [{ start: 0, end: 1 }] : []),
  ].sort((a, b) => b.start - a.start);
  let displayName = layerName;
  for (const span of spans) {
    displayName = `${displayName.slice(0, span.start)}${displayName.slice(span.end)}`;
  }
  return displayName.trim().replace(/\s{2,}/g, ' ');
}

/**
 * Apply a UI binding edit without regex suffix surgery.
 *
 * The visible display name stays in place while all binding instructions are
 * reserialized from the parsed contract. Updating a worksheet deliberately
 * leaves the current row/index untouched.
 */
export function updateLayerBinding(layerName: string, action: BindingAction): string {
  const parsed = parseLayerName(layerName);
  if (parsed.isIgnored) {
    return layerName;
  }

  const updated: ParsedLayerName = { ...parsed, labels: [...parsed.labels] };
  if (action.type === 'label') {
    updated.labels = [action.label];
    updated.hasBinding = action.label.trim() !== '';
    if (action.row !== undefined) {
      updated.index = { type: 'specific', value: action.row };
    }
  } else if (action.type === 'worksheet') {
    updated.worksheet = action.worksheet;
  } else {
    updated.index = action.index;
  }

  const displayName = getDisplayName(layerName, scanBindingSyntax(layerName));
  const binding = serializeLayerName(updated);
  if (updated.forceInclude && binding.startsWith('+')) {
    return `+${[displayName, binding.slice(1)].filter(Boolean).join(' ')}`;
  }
  return [displayName, binding].filter(Boolean).join(' ');
}

/**
 * Extract just the index specification from a layer name without full parsing.
 *
 * @param layerName - The layer name to extract index from
 * @returns IndexType or undefined if not specified
 */
export function extractIndex(layerName: string): IndexType | undefined {
  // Skip ignored layers
  if (layerName.startsWith('-')) {
    return undefined;
  }

  return parseLayerName(layerName).index;
}

/**
 * Check if a layer name specifies a worksheet.
 *
 * @param layerName - The layer name to check
 * @returns true if the layer specifies a worksheet
 */
export function hasWorksheet(layerName: string): boolean {
  return extractWorksheet(layerName) !== undefined;
}

/**
 * Check if a layer name specifies an index.
 *
 * @param layerName - The layer name to check
 * @returns true if the layer specifies an index
 */
export function hasIndex(layerName: string): boolean {
  return extractIndex(layerName) !== undefined;
}

// ============================================================================
// Inheritance Resolution
// ============================================================================

/**
 * Resolve inherited worksheet and index from ancestor parsed layer names.
 *
 * This applies the inheritance rules for worksheet and index:
 * - Worksheet inherits from parent Frame/Group/Page (first ancestor with worksheet wins)
 * - Index inherits from parent Frame/Group (first ancestor with index wins)
 * - Explicit values on the layer itself override inherited values
 *
 * @param parsed - The parsed layer name for the current layer
 * @param ancestorParsed - Array of parsed layer names from ancestors (parent first, then grandparent, etc.)
 * @returns New ParsedLayerName with inherited values applied
 *
 * @example
 * // Layer "#Title" inside a frame "Cards // Products .5"
 * const layerParsed = parseLayerName('#Title');
 * const frameParsed = parseLayerName('Cards // Products .5');
 * resolveInheritedParsedName(layerParsed, [frameParsed]);
 * // => { labels: ['Title'], worksheet: 'Products', index: { type: 'specific', value: 5 }, ... }
 *
 * @example
 * // Layer "#Title.2" overrides parent index
 * const layerParsed = parseLayerName('#Title.2');
 * const frameParsed = parseLayerName('Cards .5');
 * resolveInheritedParsedName(layerParsed, [frameParsed]);
 * // => { labels: ['Title'], index: { type: 'specific', value: 2 }, ... }
 */
export function resolveInheritedParsedName(
  parsed: ParsedLayerName,
  ancestorParsed: ParsedLayerName[]
): ParsedLayerName {
  // Start with a copy of the current layer's parsed name
  const resolved: ParsedLayerName = {
    ...parsed,
    labels: [...parsed.labels],
  };

  // Walk through ancestors to find inherited values
  for (const ancestor of ancestorParsed) {
    // Inherit worksheet if not already set
    if (resolved.worksheet === undefined && ancestor.worksheet !== undefined) {
      resolved.worksheet = ancestor.worksheet;
    }

    // Inherit index if not already set
    if (resolved.index === undefined && ancestor.index !== undefined) {
      resolved.index = ancestor.index;
    }

    // If both are set, we can stop early
    if (resolved.worksheet !== undefined && resolved.index !== undefined) {
      break;
    }
  }

  return resolved;
}

/**
 * Default index to use when none is specified.
 * Auto-increment is the default behavior.
 */
export const DEFAULT_INDEX: IndexType = { type: 'increment' };
