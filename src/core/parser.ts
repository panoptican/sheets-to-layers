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
 * - #Label #Other    → Multiple labels (first for content, others for properties)
 * - #Label.5         → Bind to column "Label", use row 5 (1-based)
 * - #Label.n         → Explicit auto-increment
 * - #Label.i         → Auto-increment, skip blank values
 * - #Label.x         → Random index
 * - #Label.r         → Random index, skip blanks
 * - // Worksheet     → Use specific worksheet tab
 * - -LayerName       → Ignore this layer and children
 * - +ComponentName   → Force include main component (normally skipped)
 * - @#               → Repeat frame marker (duplicate children to match data rows)
 */

import type { ParsedLayerName, IndexType } from './types';

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
const LABEL_PATTERN = /#([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * Pattern to detect repeat frame marker (@#).
 */
const REPEAT_FRAME_PATTERN = /@#/;

/**
 * Pattern to extract worksheet name from layer names.
 * Matches: // WorksheetName
 * Worksheet name can contain letters, numbers, spaces, underscores, and hyphens.
 * The name ends at a # (label), . (index), or end of string.
 */
const WORKSHEET_PATTERN = /\/\/\s*([a-zA-Z0-9_\- ]+?)(?=\s*[#.]|$)/;

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

  // Check for repeat frame marker (@#)
  if (REPEAT_FRAME_PATTERN.test(workingName)) {
    result.isRepeatFrame = true;
  }

  // Extract worksheet reference (// syntax)
  const worksheetMatch = workingName.match(WORKSHEET_PATTERN);
  if (worksheetMatch) {
    result.worksheet = worksheetMatch[1].trim();
  }

  // Extract index specification (must be at end of layer name)
  for (const { pattern, type } of INDEX_PATTERNS) {
    const indexMatch = workingName.match(pattern);
    if (indexMatch) {
      if (type === 'specific') {
        result.index = { type: 'specific', value: parseInt(indexMatch[1], 10) };
      } else {
        result.index = { type };
      }
      // Remove the index suffix from workingName for label parsing
      workingName = workingName.replace(pattern, '');
      break;
    }
  }

  // Extract labels (#Label syntax)
  // Reset lastIndex to ensure we start from the beginning
  LABEL_PATTERN.lastIndex = 0;

  let match;
  while ((match = LABEL_PATTERN.exec(workingName)) !== null) {
    const label = match[1].trim();
    if (label) {
      result.labels.push(label);
      result.hasBinding = true;
    }
  }

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
  const normalizedLayerLabel = normalizeLabel(layerLabel);

  for (const sheetLabel of sheetLabels) {
    if (normalizeLabel(sheetLabel) === normalizedLayerLabel) {
      return sheetLabel; // Return the original sheet label
    }
  }

  return null;
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

  // Remove force include prefix for parsing
  const workingName = layerName.startsWith('+') ? layerName.substring(1) : layerName;

  LABEL_PATTERN.lastIndex = 0;
  let match;
  while ((match = LABEL_PATTERN.exec(workingName)) !== null) {
    const label = match[1].trim();
    if (label) {
      labels.push(label);
    }
  }

  return labels;
}

/**
 * Check if a layer name has any data bindings.
 *
 * @param layerName - The layer name to check
 * @returns true if the layer has at least one #Label binding
 */
export function hasBinding(layerName: string): boolean {
  // Quick check for # character
  if (!layerName.includes('#')) {
    return false;
  }

  // Skip ignored layers
  if (layerName.startsWith('-')) {
    return false;
  }

  return extractLabels(layerName).length > 0;
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
  return REPEAT_FRAME_PATTERN.test(layerName);
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

  const match = layerName.match(WORKSHEET_PATTERN);
  return match ? match[1].trim() : undefined;
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

  for (const { pattern, type } of INDEX_PATTERNS) {
    const match = layerName.match(pattern);
    if (match) {
      if (type === 'specific') {
        return { type: 'specific', value: parseInt(match[1], 10) };
      }
      return { type };
    }
  }

  return undefined;
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
