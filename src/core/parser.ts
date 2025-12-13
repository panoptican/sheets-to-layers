/**
 * Layer name parsing utilities.
 *
 * Parses Figma layer names to extract data binding instructions.
 * This module handles the basic #Label syntax for binding layers to sheet columns/rows.
 *
 * Syntax reference:
 * - #Label           → Bind to column "Label"
 * - #Label #Other    → Multiple labels (first for content, others for properties)
 * - -LayerName       → Ignore this layer and children
 * - +ComponentName   → Force include main component (normally skipped)
 * - @#               → Repeat frame marker (duplicate children to match data rows)
 *
 * Note: Worksheet (// syntax) and index (.N, .n, .i, .x, .r) parsing
 * is implemented in TICKET-006.
 */

import type { ParsedLayerName } from './types';

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
