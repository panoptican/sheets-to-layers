/**
 * Special data type parsing and application.
 *
 * Handles non-text values in sheet cells that modify layer properties:
 * - Visibility: show/hide
 * - Color: hex colors (#RGB, #RRGGBB, etc.)
 * - Opacity: percentage values (50%)
 * - Dimensions: size (100s), width (100w), height (100h)
 * - Position: relative (20x, 40y), absolute (20xx, 40yy)
 * - Rotation: degrees (30º)
 * - Text alignment: horizontal (text-align:center), vertical (text-align-vertical:bottom)
 * - Font size: font-size:14
 * - Line height: line-height:auto, line-height:40, line-height:120%
 * - Letter spacing: letter-spacing:2, letter-spacing:10%
 *
 * Chained special types allow multiple types in a single value:
 * - "50%, #F00, 30º" - Apply opacity, color, and rotation
 * - Comma or space separated (but not inside property:value pairs)
 * - Later values override earlier ones (e.g., second color wins)
 *
 * Text and instance layers require a `/` prefix for special data types
 * (e.g., `/hide` or `/#FF0000`). This distinguishes property changes from
 * text content.
 */

import type { RGB, SyncError } from './types';
import { loadFontsForTextNode } from './text-sync';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of applying a special data type.
 */
export interface SpecialTypeResult {
  /** Whether any special type was applied */
  handled: boolean;
  /** Which types were applied */
  appliedTypes: string[];
  /** Error if application failed */
  error?: SyncError;
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Options for special type application.
 */
export interface SpecialTypeOptions {
  /** Whether the `/` prefix is required (for text/instance layers) */
  requiresPrefix?: boolean;
}

/**
 * Parsed chained value containing all parsed special types.
 *
 * When a value contains multiple special types (e.g., "50%, #F00, 30º"),
 * this interface holds all the parsed values. Later values override earlier
 * ones for the same type.
 */
export interface ParsedChainedValue {
  /** Visibility setting (show/hide) */
  visibility?: 'show' | 'hide';
  /** Fill color */
  color?: RGB;
  /** Opacity (0-1) */
  opacity?: number;
  /** Dimension (size, width, or height) */
  dimension?: DimensionValue;
  /** Position (relative or absolute) */
  position?: PositionValue;
  /** Rotation in degrees */
  rotation?: number;
  /** Text alignment (horizontal and/or vertical) */
  textAlign?: TextAlignValue;
  /** Font size in pixels */
  fontSize?: number;
  /** Line height */
  lineHeight?: LineHeightValue;
  /** Letter spacing */
  letterSpacing?: LetterSpacingValue;
}

// ============================================================================
// Visibility Parsing & Application
// ============================================================================

/**
 * Parse a visibility value.
 *
 * @param value - The value to parse
 * @returns 'show', 'hide', or null if not a visibility value
 *
 * @example
 * parseVisibility('show')   // 'show'
 * parseVisibility('HIDE')   // 'hide'
 * parseVisibility('hello')  // null
 */
export function parseVisibility(value: string): 'show' | 'hide' | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = value.toLowerCase().trim();

  if (normalized === 'show') {
    return 'show';
  }
  if (normalized === 'hide') {
    return 'hide';
  }

  return null;
}

/**
 * Check if a value is a visibility value.
 *
 * @param value - The value to check
 * @returns true if the value is 'show' or 'hide'
 */
export function isVisibilityValue(value: string): boolean {
  return parseVisibility(value) !== null;
}

/**
 * Apply visibility to a node.
 *
 * @param node - The node to modify
 * @param visibility - 'show' or 'hide'
 * @returns true if visibility was changed
 */
export function applyVisibility(node: SceneNode, visibility: 'show' | 'hide'): boolean {
  const newVisible = visibility === 'show';

  if (node.visible !== newVisible) {
    node.visible = newVisible;
    return true;
  }

  return false;
}

// ============================================================================
// Color Parsing
// ============================================================================

/**
 * Parse a hex color string to RGB values.
 *
 * Supports multiple formats:
 * - #A      → #AAAAAA (1 char = grayscale)
 * - #AB     → #ABABAB (2 chars = grayscale)
 * - #ABC    → #AABBCC (3 chars = shorthand RGB)
 * - #RRGGBB → standard 6-char hex
 *
 * Returns RGB values normalized to 0-1 range for Figma.
 *
 * @param value - The hex color string
 * @returns RGB object or null if not a valid color
 *
 * @example
 * parseHexColor('#FF0000')  // { r: 1, g: 0, b: 0 }
 * parseHexColor('#F00')     // { r: 1, g: 0, b: 0 }
 * parseHexColor('#80')      // { r: 0.502, g: 0.502, b: 0.502 }
 */
export function parseHexColor(value: string): RGB | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('#')) {
    return null;
  }

  const hex = trimmed.substring(1).toUpperCase();

  // Validate hex characters
  if (!/^[0-9A-F]+$/.test(hex)) {
    return null;
  }

  let r: number, g: number, b: number;

  switch (hex.length) {
    case 1:
      // #A → #AAAAAA (single char grayscale)
      r = g = b = parseInt(hex + hex, 16);
      break;

    case 2:
      // #AB → #ABABAB (two char grayscale)
      r = g = b = parseInt(hex, 16);
      break;

    case 3:
      // #ABC → #AABBCC (shorthand RGB)
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      break;

    case 6:
      // #RRGGBB (standard hex)
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      break;

    default:
      return null;
  }

  // Check for NaN (invalid hex values)
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return null;
  }

  // Normalize to 0-1 range for Figma
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255,
  };
}

/**
 * Check if a value is a valid hex color.
 *
 * @param value - The value to check
 * @returns true if the value is a valid hex color
 */
export function isHexColor(value: string): boolean {
  return parseHexColor(value) !== null;
}

/**
 * Convert RGB (0-1 range) to hex string.
 *
 * @param color - The RGB color
 * @returns Hex string (e.g., '#FF0000')
 */
export function rgbToHex(color: RGB): string {
  const toHex = (n: number): string => {
    const hex = Math.round(n * 255).toString(16).toUpperCase();
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

// ============================================================================
// Color Application
// ============================================================================

/**
 * Check if a node can have fills applied.
 *
 * @param node - The node to check
 * @returns true if the node has a fills property
 */
export function canHaveFills(node: SceneNode): boolean {
  // Check if node has fills property and is not a group-like container
  // Groups don't have fills in their type definition, so 'fills' in node is sufficient
  return 'fills' in node;
}

/**
 * Apply a fill color to a node.
 *
 * For groups, recursively applies to all children.
 *
 * @param node - The node to modify
 * @param color - The RGB color to apply
 * @returns true if any fill was changed
 */
export function applyFillColor(node: SceneNode, color: RGB): boolean {
  let changed = false;

  // For groups, apply to all children recursively
  if (node.type === 'GROUP') {
    const group = node as GroupNode;
    for (const child of group.children) {
      if (applyFillColor(child as SceneNode, color)) {
        changed = true;
      }
    }
    return changed;
  }

  // Apply fill to nodes that support it
  if (canHaveFills(node)) {
    const solidFill: SolidPaint = {
      type: 'SOLID',
      color: { r: color.r, g: color.g, b: color.b },
    };

    (node as GeometryMixin).fills = [solidFill];
    changed = true;
  }

  return changed;
}

// ============================================================================
// Opacity Parsing & Application
// ============================================================================

/**
 * Parse an opacity percentage value.
 *
 * @param value - The value to parse (e.g., "50%", "100%", "0%")
 * @returns Opacity as 0-1 number, or null if not a valid opacity
 *
 * @example
 * parseOpacity('50%')    // 0.5
 * parseOpacity('100%')   // 1
 * parseOpacity('0%')     // 0
 * parseOpacity('75.5%')  // 0.755
 */
export function parseOpacity(value: string): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);

  if (!match) {
    return null;
  }

  const percentage = parseFloat(match[1]);

  // Clamp to 0-100 and convert to 0-1
  return Math.min(100, Math.max(0, percentage)) / 100;
}

/**
 * Check if a value is a valid opacity value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid opacity percentage
 */
export function isOpacityValue(value: string): boolean {
  return parseOpacity(value) !== null;
}

/**
 * Apply opacity to a node.
 *
 * @param node - The node to modify
 * @param opacity - Opacity value (0-1)
 * @returns true if opacity was changed
 */
export function applyOpacity(node: SceneNode, opacity: number): boolean {
  if (!('opacity' in node)) {
    return false;
  }

  const blendNode = node as BlendMixin;
  const oldOpacity = blendNode.opacity;
  blendNode.opacity = opacity;

  return oldOpacity !== opacity;
}

// ============================================================================
// Dimension Parsing & Application
// ============================================================================

/**
 * Dimension value representing size, width, or height.
 */
export interface DimensionValue {
  /** Type of dimension */
  type: 'size' | 'width' | 'height';
  /** Value in pixels */
  value: number;
}

/**
 * Parse a dimension value.
 *
 * @param value - The value to parse
 * @returns DimensionValue or null if not a valid dimension
 *
 * @example
 * parseDimension('100s')   // { type: 'size', value: 100 }
 * parseDimension('200w')   // { type: 'width', value: 200 }
 * parseDimension('150h')   // { type: 'height', value: 150 }
 * parseDimension('50.5w')  // { type: 'width', value: 50.5 }
 */
export function parseDimension(value: string): DimensionValue | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  // Size (both dimensions): 100s
  let match = trimmed.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (match) {
    return { type: 'size', value: parseFloat(match[1]) };
  }

  // Width only: 100w
  match = trimmed.match(/^(\d+(?:\.\d+)?)\s*w$/i);
  if (match) {
    return { type: 'width', value: parseFloat(match[1]) };
  }

  // Height only: 100h
  match = trimmed.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (match) {
    return { type: 'height', value: parseFloat(match[1]) };
  }

  return null;
}

/**
 * Check if a value is a valid dimension value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid dimension
 */
export function isDimensionValue(value: string): boolean {
  return parseDimension(value) !== null;
}

/**
 * Check if a node can be resized.
 *
 * @param node - The node to check
 * @returns true if the node supports resize
 */
export function canResize(node: SceneNode): boolean {
  return 'resize' in node;
}

/**
 * Apply a dimension to a node.
 *
 * @param node - The node to modify
 * @param dimension - The dimension to apply
 * @returns true if the dimension was changed
 */
export function applyDimension(node: SceneNode, dimension: DimensionValue): boolean {
  if (!canResize(node)) {
    return false;
  }

  const resizable = node as LayoutMixin;
  const oldWidth = resizable.width;
  const oldHeight = resizable.height;

  switch (dimension.type) {
    case 'size':
      resizable.resize(dimension.value, dimension.value);
      break;
    case 'width':
      resizable.resize(dimension.value, oldHeight);
      break;
    case 'height':
      resizable.resize(oldWidth, dimension.value);
      break;
  }

  return resizable.width !== oldWidth || resizable.height !== oldHeight;
}

// ============================================================================
// Position Parsing & Application
// ============================================================================

/**
 * Position value representing relative or absolute position.
 */
export interface PositionValue {
  /** Position type */
  type: 'relative' | 'absolute';
  /** Axis to position */
  axis: 'x' | 'y';
  /** Value in pixels */
  value: number;
}

/**
 * Parse a position value.
 *
 * @param value - The value to parse
 * @returns PositionValue or null if not a valid position
 *
 * @example
 * parsePosition('20x')    // { type: 'relative', axis: 'x', value: 20 }
 * parsePosition('40y')    // { type: 'relative', axis: 'y', value: 40 }
 * parsePosition('20xx')   // { type: 'absolute', axis: 'x', value: 20 }
 * parsePosition('40yy')   // { type: 'absolute', axis: 'y', value: 40 }
 * parsePosition('-10x')   // { type: 'relative', axis: 'x', value: -10 }
 */
export function parsePosition(value: string): PositionValue | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  // Absolute position: 20xx, 40yy (check first, longer pattern)
  let match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(xx|yy)$/i);
  if (match) {
    return {
      type: 'absolute',
      axis: match[2].toLowerCase().charAt(0) as 'x' | 'y',
      value: parseFloat(match[1]),
    };
  }

  // Relative position: 20x, 40y
  match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(x|y)$/i);
  if (match) {
    return {
      type: 'relative',
      axis: match[2].toLowerCase() as 'x' | 'y',
      value: parseFloat(match[1]),
    };
  }

  return null;
}

/**
 * Check if a value is a valid position value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid position
 */
export function isPositionValue(value: string): boolean {
  return parsePosition(value) !== null;
}

/**
 * Apply a position to a node.
 *
 * @param node - The node to modify
 * @param position - The position to apply
 * @returns true if the position was changed
 */
export function applyPosition(node: SceneNode, position: PositionValue): boolean {
  const oldX = node.x;
  const oldY = node.y;

  if (position.type === 'absolute') {
    // Set position relative to page (absolute coordinates)
    // absoluteBoundingBox gives us the absolute position
    // We need to calculate the delta to achieve the desired absolute position
    if (position.axis === 'x') {
      const currentAbsoluteX = node.absoluteBoundingBox?.x ?? node.x;
      node.x = position.value - currentAbsoluteX + node.x;
    } else {
      const currentAbsoluteY = node.absoluteBoundingBox?.y ?? node.y;
      node.y = position.value - currentAbsoluteY + node.y;
    }
  } else {
    // Set position relative to parent
    if (position.axis === 'x') {
      node.x = position.value;
    } else {
      node.y = position.value;
    }
  }

  return node.x !== oldX || node.y !== oldY;
}

// ============================================================================
// Rotation Parsing & Application
// ============================================================================

/**
 * Parse a rotation value.
 *
 * Accepts degrees with the degree symbol (º).
 *
 * @param value - The value to parse (e.g., "30º", "-45º")
 * @returns Rotation in degrees, or null if not a valid rotation
 *
 * @example
 * parseRotation('30º')     // 30
 * parseRotation('-45º')    // -45
 * parseRotation('90.5º')   // 90.5
 * parseRotation('30')      // null (no degree symbol)
 */
export function parseRotation(value: string): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  // Degree symbol: º (Alt+0 on Mac)
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*º$/);

  if (!match) {
    return null;
  }

  return parseFloat(match[1]);
}

/**
 * Check if a value is a valid rotation value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid rotation
 */
export function isRotationValue(value: string): boolean {
  return parseRotation(value) !== null;
}

/**
 * Apply rotation to a node.
 *
 * @param node - The node to modify
 * @param degrees - Rotation in degrees
 * @returns true if rotation was changed
 */
export function applyRotation(node: SceneNode, degrees: number): boolean {
  if (!('rotation' in node)) {
    return false;
  }

  const rotatable = node as LayoutMixin;
  const oldRotation = rotatable.rotation;
  rotatable.rotation = degrees;

  return oldRotation !== degrees;
}

// ============================================================================
// Text Alignment Parsing & Application
// ============================================================================

/**
 * Horizontal text alignment options.
 */
export type HorizontalTextAlign = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';

/**
 * Vertical text alignment options.
 */
export type VerticalTextAlign = 'TOP' | 'CENTER' | 'BOTTOM';

/**
 * Text alignment value.
 */
export interface TextAlignValue {
  horizontal?: HorizontalTextAlign;
  vertical?: VerticalTextAlign;
}

/**
 * Parse a text alignment value.
 *
 * @param value - The value to parse
 * @returns TextAlignValue or null if not a valid text alignment
 *
 * @example
 * parseTextAlign('text-align:center')              // { horizontal: 'CENTER' }
 * parseTextAlign('text-align-vertical:bottom')     // { vertical: 'BOTTOM' }
 * parseTextAlign('text-align:left')                // { horizontal: 'LEFT' }
 */
export function parseTextAlign(value: string): TextAlignValue | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  const result: TextAlignValue = {};

  // Horizontal alignment: text-align:left|center|right|justified
  const hMatch = trimmed.match(/text-align:\s*(left|center|right|justified)/i);
  if (hMatch) {
    result.horizontal = hMatch[1].toUpperCase() as HorizontalTextAlign;
  }

  // Vertical alignment: text-align-vertical:top|center|bottom
  const vMatch = trimmed.match(/text-align-vertical:\s*(top|center|bottom)/i);
  if (vMatch) {
    result.vertical = vMatch[1].toUpperCase() as VerticalTextAlign;
  }

  return (result.horizontal || result.vertical) ? result : null;
}

/**
 * Check if a value is a valid text alignment value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid text alignment
 */
export function isTextAlignValue(value: string): boolean {
  return parseTextAlign(value) !== null;
}

/**
 * Apply text alignment to a text node.
 *
 * Requires font loading before modification.
 *
 * @param node - The text node to modify
 * @param alignment - The alignment to apply
 * @returns Promise resolving to true if alignment was changed
 */
export async function applyTextAlign(
  node: TextNode,
  alignment: TextAlignValue
): Promise<boolean> {
  await loadFontsForTextNode(node);

  let changed = false;

  if (alignment.horizontal && node.textAlignHorizontal !== alignment.horizontal) {
    node.textAlignHorizontal = alignment.horizontal;
    changed = true;
  }

  if (alignment.vertical && node.textAlignVertical !== alignment.vertical) {
    node.textAlignVertical = alignment.vertical;
    changed = true;
  }

  return changed;
}

// ============================================================================
// Font Size Parsing & Application
// ============================================================================

/**
 * Parse a font size value.
 *
 * @param value - The value to parse (e.g., "font-size:14")
 * @returns Font size in pixels, or null if not a valid font size
 *
 * @example
 * parseFontSize('font-size:14')      // 14
 * parseFontSize('font-size:24.5')    // 24.5
 * parseFontSize('14')                // null (no prefix)
 */
export function parseFontSize(value: string): number | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^font-size:\s*(\d+(?:\.\d+)?)$/i);

  if (!match) {
    return null;
  }

  return parseFloat(match[1]);
}

/**
 * Check if a value is a valid font size value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid font size
 */
export function isFontSizeValue(value: string): boolean {
  return parseFontSize(value) !== null;
}

/**
 * Apply font size to a text node.
 *
 * Requires font loading before modification.
 *
 * @param node - The text node to modify
 * @param size - Font size in pixels
 * @returns Promise resolving to true if font size was changed
 */
export async function applyFontSize(node: TextNode, size: number): Promise<boolean> {
  await loadFontsForTextNode(node);

  const oldSize = node.fontSize;
  node.fontSize = size;

  return oldSize !== size;
}

// ============================================================================
// Line Height Parsing & Application
// ============================================================================

/**
 * Line height value.
 */
export interface LineHeightValue {
  type: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

/**
 * Parse a line height value.
 *
 * @param value - The value to parse
 * @returns LineHeightValue or null if not a valid line height
 *
 * @example
 * parseLineHeight('line-height:auto')    // { type: 'AUTO' }
 * parseLineHeight('line-height:40')      // { type: 'PIXELS', value: 40 }
 * parseLineHeight('line-height:120%')    // { type: 'PERCENT', value: 120 }
 */
export function parseLineHeight(value: string): LineHeightValue | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^line-height:\s*(auto|(\d+(?:\.\d+)?)\s*(%)?)/i);

  if (!match) {
    return null;
  }

  if (match[1].toLowerCase() === 'auto') {
    return { type: 'AUTO' };
  }

  const numValue = parseFloat(match[2]);
  if (match[3]) {
    return { type: 'PERCENT', value: numValue };
  }

  return { type: 'PIXELS', value: numValue };
}

/**
 * Check if a value is a valid line height value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid line height
 */
export function isLineHeightValue(value: string): boolean {
  return parseLineHeight(value) !== null;
}

/**
 * Apply line height to a text node.
 *
 * Requires font loading before modification.
 *
 * @param node - The text node to modify
 * @param lineHeight - The line height to apply
 * @returns Promise resolving to true if line height was changed
 */
export async function applyLineHeight(
  node: TextNode,
  lineHeight: LineHeightValue
): Promise<boolean> {
  await loadFontsForTextNode(node);

  let newLineHeight: LineHeight;

  switch (lineHeight.type) {
    case 'AUTO':
      newLineHeight = { unit: 'AUTO' };
      break;
    case 'PIXELS':
      newLineHeight = { unit: 'PIXELS', value: lineHeight.value! };
      break;
    case 'PERCENT':
      newLineHeight = { unit: 'PERCENT', value: lineHeight.value! };
      break;
  }

  // Compare current line height
  const current = node.lineHeight as LineHeight;
  const isSame =
    current.unit === newLineHeight.unit &&
    (current.unit === 'AUTO' || (current as { value: number }).value === (newLineHeight as { value: number }).value);

  if (!isSame) {
    node.lineHeight = newLineHeight;
    return true;
  }

  return false;
}

// ============================================================================
// Letter Spacing Parsing & Application
// ============================================================================

/**
 * Letter spacing value.
 */
export interface LetterSpacingValue {
  type: 'PIXELS' | 'PERCENT';
  value: number;
}

/**
 * Parse a letter spacing value.
 *
 * @param value - The value to parse
 * @returns LetterSpacingValue or null if not a valid letter spacing
 *
 * @example
 * parseLetterSpacing('letter-spacing:2')      // { type: 'PIXELS', value: 2 }
 * parseLetterSpacing('letter-spacing:10%')    // { type: 'PERCENT', value: 10 }
 * parseLetterSpacing('letter-spacing:-1')     // { type: 'PIXELS', value: -1 }
 */
export function parseLetterSpacing(value: string): LetterSpacingValue | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^letter-spacing:\s*(-?\d+(?:\.\d+)?)\s*(%)?$/i);

  if (!match) {
    return null;
  }

  const numValue = parseFloat(match[1]);
  const isPercent = match[2] === '%';

  return {
    type: isPercent ? 'PERCENT' : 'PIXELS',
    value: numValue,
  };
}

/**
 * Check if a value is a valid letter spacing value.
 *
 * @param value - The value to check
 * @returns true if the value is a valid letter spacing
 */
export function isLetterSpacingValue(value: string): boolean {
  return parseLetterSpacing(value) !== null;
}

/**
 * Apply letter spacing to a text node.
 *
 * Requires font loading before modification.
 *
 * @param node - The text node to modify
 * @param letterSpacing - The letter spacing to apply
 * @returns Promise resolving to true if letter spacing was changed
 */
export async function applyLetterSpacing(
  node: TextNode,
  letterSpacing: LetterSpacingValue
): Promise<boolean> {
  await loadFontsForTextNode(node);

  const newSpacing: LetterSpacing = {
    unit: letterSpacing.type,
    value: letterSpacing.value,
  };

  // Compare current letter spacing
  const current = node.letterSpacing as LetterSpacing;
  const isSame = current.unit === newSpacing.unit && current.value === newSpacing.value;

  if (!isSame) {
    node.letterSpacing = newSpacing;
    return true;
  }

  return false;
}

// ============================================================================
// Chained Special Types
// ============================================================================

/**
 * Tokenize a chained value string into individual tokens.
 *
 * Handles comma and space separation while keeping property:value pairs intact.
 * For example, "text-align:center 50% #F00" splits into ["text-align:center", "50%", "#F00"].
 *
 * @param value - The value string to tokenize
 * @returns Array of tokens
 *
 * @example
 * tokenizeChainedValue('50%, #F00, 30º')
 * // ['50%', '#F00', '30º']
 *
 * tokenizeChainedValue('text-align:center 50%')
 * // ['text-align:center', '50%']
 */
export function tokenizeChainedValue(value: string): string[] {
  if (!value || typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  // Split by comma or whitespace, keeping property:value pairs together
  // Regex: split on comma (with optional whitespace) or whitespace
  // But we need to be careful not to split inside property values
  const tokens: string[] = [];
  const parts = trimmed.split(/[,\s]+/).filter((p) => p.trim());

  // Re-join parts that are split incorrectly (like "text-align:" and "center")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();

    // Check if this part ends with a colon (incomplete property:value)
    if (part.endsWith(':') && i + 1 < parts.length) {
      // Join with next part
      tokens.push(part + parts[i + 1].trim());
      i++;
    } else {
      tokens.push(part);
    }
  }

  return tokens;
}

/**
 * Check if a value contains multiple chained special types.
 *
 * A value is considered chained if it contains multiple special type tokens
 * separated by commas or spaces.
 *
 * @param value - The value to check
 * @returns true if the value contains multiple special types
 *
 * @example
 * isChainedSpecialType('50%, #F00')     // true
 * isChainedSpecialType('50%')           // false
 * isChainedSpecialType('hello world')   // false
 */
export function isChainedSpecialType(value: string): boolean {
  if (!value) return false;

  const cleanValue = stripPrefix(value);
  const tokens = tokenizeChainedValue(cleanValue);

  // Need at least 2 tokens that are special types
  if (tokens.length < 2) return false;

  // Count how many tokens are valid special types
  let specialCount = 0;
  for (const token of tokens) {
    if (
      isVisibilityValue(token) ||
      isHexColor(token) ||
      isOpacityValue(token) ||
      isDimensionValue(token) ||
      isPositionValue(token) ||
      isRotationValue(token) ||
      isTextAlignValue(token) ||
      isFontSizeValue(token) ||
      isLineHeightValue(token) ||
      isLetterSpacingValue(token)
    ) {
      specialCount++;
    }
  }

  return specialCount >= 2;
}

/**
 * Parse multiple chained special types from a single value string.
 *
 * Splits the value by comma or space and parses each token as a special type.
 * Later values override earlier ones for the same type (e.g., second color wins).
 *
 * @param value - The value string containing chained special types
 * @returns ParsedChainedValue with all parsed types
 *
 * @example
 * parseChainedSpecialTypes('50%, #F00, 30º')
 * // { opacity: 0.5, color: { r: 1, g: 0, b: 0 }, rotation: 30 }
 *
 * parseChainedSpecialTypes('text-align:center, font-size:14')
 * // { textAlign: { horizontal: 'CENTER' }, fontSize: 14 }
 */
export function parseChainedSpecialTypes(value: string): ParsedChainedValue {
  const result: ParsedChainedValue = {};

  if (!value || typeof value !== 'string') {
    return result;
  }

  // Strip prefix if present
  const cleanValue = stripPrefix(value.trim());
  if (!cleanValue) {
    return result;
  }

  const tokens = tokenizeChainedValue(cleanValue);

  for (const token of tokens) {
    // Try visibility
    const visibility = parseVisibility(token);
    if (visibility !== null) {
      result.visibility = visibility;
      continue;
    }

    // Try color
    const color = parseHexColor(token);
    if (color !== null) {
      result.color = color;
      continue;
    }

    // Try opacity
    const opacity = parseOpacity(token);
    if (opacity !== null) {
      result.opacity = opacity;
      continue;
    }

    // Try dimension
    const dimension = parseDimension(token);
    if (dimension !== null) {
      result.dimension = dimension;
      continue;
    }

    // Try position
    const position = parsePosition(token);
    if (position !== null) {
      result.position = position;
      continue;
    }

    // Try rotation
    const rotation = parseRotation(token);
    if (rotation !== null) {
      result.rotation = rotation;
      continue;
    }

    // Try text alignment (merge with existing)
    const textAlign = parseTextAlign(token);
    if (textAlign !== null) {
      result.textAlign = { ...result.textAlign, ...textAlign };
      continue;
    }

    // Try font size
    const fontSize = parseFontSize(token);
    if (fontSize !== null) {
      result.fontSize = fontSize;
      continue;
    }

    // Try line height
    const lineHeight = parseLineHeight(token);
    if (lineHeight !== null) {
      result.lineHeight = lineHeight;
      continue;
    }

    // Try letter spacing
    const letterSpacing = parseLetterSpacing(token);
    if (letterSpacing !== null) {
      result.letterSpacing = letterSpacing;
      continue;
    }
  }

  return result;
}

/**
 * Check if a ParsedChainedValue has any parsed types.
 *
 * @param parsed - The parsed chained value
 * @returns true if any type was parsed
 */
export function hasAnyParsedType(parsed: ParsedChainedValue): boolean {
  return (
    parsed.visibility !== undefined ||
    parsed.color !== undefined ||
    parsed.opacity !== undefined ||
    parsed.dimension !== undefined ||
    parsed.position !== undefined ||
    parsed.rotation !== undefined ||
    parsed.textAlign !== undefined ||
    parsed.fontSize !== undefined ||
    parsed.lineHeight !== undefined ||
    parsed.letterSpacing !== undefined
  );
}

/**
 * Count the number of parsed types in a ParsedChainedValue.
 *
 * @param parsed - The parsed chained value
 * @returns Number of parsed types
 */
export function countParsedTypes(parsed: ParsedChainedValue): number {
  let count = 0;
  if (parsed.visibility !== undefined) count++;
  if (parsed.color !== undefined) count++;
  if (parsed.opacity !== undefined) count++;
  if (parsed.dimension !== undefined) count++;
  if (parsed.position !== undefined) count++;
  if (parsed.rotation !== undefined) count++;
  if (parsed.textAlign !== undefined) count++;
  if (parsed.fontSize !== undefined) count++;
  if (parsed.lineHeight !== undefined) count++;
  if (parsed.letterSpacing !== undefined) count++;
  return count;
}

/**
 * Apply all parsed chained special types to a node.
 *
 * Applies each parsed type in sequence. Text-specific properties
 * (textAlign, fontSize, lineHeight, letterSpacing) only apply to TEXT nodes.
 *
 * @param node - The node to modify
 * @param parsed - The parsed chained value
 * @returns Promise resolving to SpecialTypeResult
 *
 * @example
 * const parsed = parseChainedSpecialTypes('50%, #F00, 30º');
 * await applyChainedSpecialTypes(node, parsed);
 */
export async function applyChainedSpecialTypes(
  node: SceneNode,
  parsed: ParsedChainedValue
): Promise<SpecialTypeResult> {
  const result: SpecialTypeResult = {
    handled: false,
    appliedTypes: [],
    warnings: [],
  };

  if (!hasAnyParsedType(parsed)) {
    return result;
  }

  try {
    // Apply visibility
    if (parsed.visibility !== undefined) {
      applyVisibility(node, parsed.visibility);
      result.appliedTypes.push('visibility');
    }

    // Apply color
    if (parsed.color !== undefined) {
      const changed = applyFillColor(node, parsed.color);
      result.appliedTypes.push('color');
      if (!changed) {
        result.warnings.push(`Color applied but node may not support fills: ${node.name}`);
      }
    }

    // Apply opacity
    if (parsed.opacity !== undefined) {
      const changed = applyOpacity(node, parsed.opacity);
      result.appliedTypes.push('opacity');
      if (!changed) {
        result.warnings.push(`Opacity applied but node may not support opacity: ${node.name}`);
      }
    }

    // Apply dimension
    if (parsed.dimension !== undefined) {
      const changed = applyDimension(node, parsed.dimension);
      result.appliedTypes.push('dimension');
      if (!changed) {
        result.warnings.push(`Dimension applied but node may not support resize: ${node.name}`);
      }
    }

    // Apply position
    if (parsed.position !== undefined) {
      applyPosition(node, parsed.position);
      result.appliedTypes.push('position');
    }

    // Apply rotation
    if (parsed.rotation !== undefined) {
      const changed = applyRotation(node, parsed.rotation);
      result.appliedTypes.push('rotation');
      if (!changed) {
        result.warnings.push(`Rotation applied but node may not support rotation: ${node.name}`);
      }
    }

    // Text-specific properties (only apply to TEXT nodes)
    if (node.type === 'TEXT') {
      const textNode = node as TextNode;

      // Apply text alignment
      if (parsed.textAlign !== undefined) {
        await applyTextAlign(textNode, parsed.textAlign);
        result.appliedTypes.push('textAlign');
      }

      // Apply font size
      if (parsed.fontSize !== undefined) {
        await applyFontSize(textNode, parsed.fontSize);
        result.appliedTypes.push('fontSize');
      }

      // Apply line height
      if (parsed.lineHeight !== undefined) {
        await applyLineHeight(textNode, parsed.lineHeight);
        result.appliedTypes.push('lineHeight');
      }

      // Apply letter spacing
      if (parsed.letterSpacing !== undefined) {
        await applyLetterSpacing(textNode, parsed.letterSpacing);
        result.appliedTypes.push('letterSpacing');
      }
    } else if (
      parsed.textAlign !== undefined ||
      parsed.fontSize !== undefined ||
      parsed.lineHeight !== undefined ||
      parsed.letterSpacing !== undefined
    ) {
      // Text properties specified but node is not TEXT
      result.warnings.push(
        `Text properties (textAlign, fontSize, lineHeight, letterSpacing) ignored: ${node.name} is not a TEXT node`
      );
    }

    result.handled = result.appliedTypes.length > 0;
    return result;
  } catch (error) {
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: error instanceof Error ? error.message : String(error),
    };
    return result;
  }
}

// ============================================================================
// Special Data Type Dispatcher
// ============================================================================

/**
 * Strip the `/` prefix from a value if present.
 *
 * @param value - The value to strip
 * @returns The value without leading `/`
 */
export function stripPrefix(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  return trimmed.startsWith('/') ? trimmed.substring(1) : trimmed;
}

/**
 * Check if a value has the `/` prefix.
 *
 * @param value - The value to check
 * @returns true if the value starts with `/`
 */
export function hasSpecialPrefix(value: string): boolean {
  return value?.trim().startsWith('/') ?? false;
}

/**
 * Check if a value is a special data type.
 *
 * Checks for: visibility, color, opacity, dimension, position, rotation,
 * text alignment, font size, line height, letter spacing.
 * Also checks for chained special types (multiple types in one value).
 *
 * @param value - The value to check
 * @param stripLeadingSlash - Whether to strip `/` prefix before checking
 * @returns true if the value is a special data type
 */
export function isSpecialDataType(value: string, stripLeadingSlash: boolean = true): boolean {
  if (!value) return false;
  const checkValue = stripLeadingSlash ? stripPrefix(value) : value.trim();

  // Check for single special types
  if (
    isVisibilityValue(checkValue) ||
    isHexColor(checkValue) ||
    isOpacityValue(checkValue) ||
    isDimensionValue(checkValue) ||
    isPositionValue(checkValue) ||
    isRotationValue(checkValue) ||
    isTextAlignValue(checkValue) ||
    isFontSizeValue(checkValue) ||
    isLineHeightValue(checkValue) ||
    isLetterSpacingValue(checkValue)
  ) {
    return true;
  }

  // Check for chained special types (use the already-processed checkValue)
  const tokens = tokenizeChainedValue(checkValue);

  // At least one token must be a valid special type
  for (const token of tokens) {
    if (
      isVisibilityValue(token) ||
      isHexColor(token) ||
      isOpacityValue(token) ||
      isDimensionValue(token) ||
      isPositionValue(token) ||
      isRotationValue(token) ||
      isTextAlignValue(token) ||
      isFontSizeValue(token) ||
      isLineHeightValue(token) ||
      isLetterSpacingValue(token)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Apply a special data type to a node.
 *
 * This is the main entry point for applying special data types.
 * Supports both single values and chained values (multiple types separated by comma/space).
 *
 * For single values, it tries each type in order:
 * 1. Visibility (show/hide)
 * 2. Color (#hex)
 * 3. Opacity (50%)
 * 4. Dimension (100s, 100w, 100h)
 * 5. Position (20x, 40y, 20xx, 40yy)
 * 6. Rotation (30º)
 * 7. Text alignment (text-align:center, text-align-vertical:bottom)
 * 8. Font size (font-size:14)
 * 9. Line height (line-height:auto, line-height:40, line-height:120%)
 * 10. Letter spacing (letter-spacing:2, letter-spacing:10%)
 *
 * For chained values (e.g., "50%, #F00, 30º"), all types are parsed and applied.
 * Later values override earlier ones for the same type.
 *
 * @param node - The node to modify
 * @param value - The value containing the special data type(s)
 * @param options - Options for application
 * @returns Promise resolving to SpecialTypeResult with details of what was applied
 *
 * @example
 * // Apply visibility
 * await applySpecialDataType(node, 'hide')
 *
 * // Apply color
 * await applySpecialDataType(node, '#FF0000')
 *
 * // Apply opacity
 * await applySpecialDataType(node, '50%')
 *
 * // Apply chained types
 * await applySpecialDataType(node, '50%, #F00, 30º')
 *
 * // Apply dimension
 * await applySpecialDataType(node, '100w')
 *
 * // Apply position
 * await applySpecialDataType(node, '20x')
 *
 * // Apply rotation
 * await applySpecialDataType(node, '30º')
 *
 * // Apply text properties (text nodes only)
 * await applySpecialDataType(textNode, 'text-align:center')
 *
 * // For text layers, use prefix
 * await applySpecialDataType(textNode, '/hide', { requiresPrefix: true })
 */
export async function applySpecialDataType(
  node: SceneNode,
  value: string,
  options: SpecialTypeOptions = {}
): Promise<SpecialTypeResult> {
  const { requiresPrefix = false } = options;

  const result: SpecialTypeResult = {
    handled: false,
    appliedTypes: [],
    warnings: [],
  };

  if (!value || typeof value !== 'string') {
    return result;
  }

  const trimmedValue = value.trim();

  // Check prefix requirement
  if (requiresPrefix && !hasSpecialPrefix(trimmedValue)) {
    // Not a special data type for this layer (treat as regular content)
    return result;
  }

  // Remove prefix if present
  const cleanValue = stripPrefix(trimmedValue);

  if (!cleanValue) {
    return result;
  }

  try {
    // Check for chained special types (multiple types in one value)
    // Parse and check if we have multiple types
    const parsed = parseChainedSpecialTypes(cleanValue);
    const parsedCount = countParsedTypes(parsed);

    if (parsedCount >= 2) {
      // Multiple types - use chained applier
      return await applyChainedSpecialTypes(node, parsed);
    }

    // Single type - use individual parsers for better error messages
    // Try visibility
    const visibility = parseVisibility(cleanValue);
    if (visibility !== null) {
      applyVisibility(node, visibility);
      result.handled = true;
      result.appliedTypes.push('visibility');
      return result;
    }

    // Try color
    const color = parseHexColor(cleanValue);
    if (color !== null) {
      const changed = applyFillColor(node, color);
      result.handled = true;
      result.appliedTypes.push('color');
      if (!changed) {
        result.warnings.push(`Color applied but node may not support fills: ${node.name}`);
      }
      return result;
    }

    // Try opacity
    const opacity = parseOpacity(cleanValue);
    if (opacity !== null) {
      const changed = applyOpacity(node, opacity);
      result.handled = true;
      result.appliedTypes.push('opacity');
      if (!changed) {
        result.warnings.push(`Opacity applied but node may not support opacity: ${node.name}`);
      }
      return result;
    }

    // Try dimension
    const dimension = parseDimension(cleanValue);
    if (dimension !== null) {
      const changed = applyDimension(node, dimension);
      result.handled = true;
      result.appliedTypes.push('dimension');
      if (!changed) {
        result.warnings.push(`Dimension applied but node may not support resize: ${node.name}`);
      }
      return result;
    }

    // Try position
    const position = parsePosition(cleanValue);
    if (position !== null) {
      applyPosition(node, position);
      result.handled = true;
      result.appliedTypes.push('position');
      return result;
    }

    // Try rotation
    const rotation = parseRotation(cleanValue);
    if (rotation !== null) {
      const changed = applyRotation(node, rotation);
      result.handled = true;
      result.appliedTypes.push('rotation');
      if (!changed) {
        result.warnings.push(`Rotation applied but node may not support rotation: ${node.name}`);
      }
      return result;
    }

    // Text-specific properties (require TextNode)
    if (node.type === 'TEXT') {
      const textNode = node as TextNode;

      // Try text alignment
      const textAlign = parseTextAlign(cleanValue);
      if (textAlign !== null) {
        await applyTextAlign(textNode, textAlign);
        result.handled = true;
        result.appliedTypes.push('textAlign');
        return result;
      }

      // Try font size
      const fontSize = parseFontSize(cleanValue);
      if (fontSize !== null) {
        await applyFontSize(textNode, fontSize);
        result.handled = true;
        result.appliedTypes.push('fontSize');
        return result;
      }

      // Try line height
      const lineHeight = parseLineHeight(cleanValue);
      if (lineHeight !== null) {
        await applyLineHeight(textNode, lineHeight);
        result.handled = true;
        result.appliedTypes.push('lineHeight');
        return result;
      }

      // Try letter spacing
      const letterSpacing = parseLetterSpacing(cleanValue);
      if (letterSpacing !== null) {
        await applyLetterSpacing(textNode, letterSpacing);
        result.handled = true;
        result.appliedTypes.push('letterSpacing');
        return result;
      }
    }

    // No special data type matched
    return result;
  } catch (error) {
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: error instanceof Error ? error.message : String(error),
    };
    return result;
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Result of batch special type application.
 */
export interface BatchSpecialTypeResult {
  /** Total entries processed */
  totalProcessed: number;
  /** Entries where special types were applied */
  handledCount: number;
  /** Entries that weren't special types */
  unhandledCount: number;
  /** Errors from failed applications */
  errors: SyncError[];
  /** All warnings */
  warnings: string[];
  /** Map of type name to count of applications */
  typesCounts: Map<string, number>;
}

/**
 * Entry for batch special type processing.
 */
export interface SpecialTypeEntry {
  /** The node to modify */
  node: SceneNode;
  /** The value to apply */
  value: string;
  /** Whether prefix is required */
  requiresPrefix?: boolean;
}

/**
 * Apply special data types to multiple nodes.
 *
 * @param entries - Array of entries to process
 * @returns Promise resolving to BatchSpecialTypeResult
 */
export async function batchApplySpecialTypes(entries: SpecialTypeEntry[]): Promise<BatchSpecialTypeResult> {
  const result: BatchSpecialTypeResult = {
    totalProcessed: entries.length,
    handledCount: 0,
    unhandledCount: 0,
    errors: [],
    warnings: [],
    typesCounts: new Map(),
  };

  for (const entry of entries) {
    const applyResult = await applySpecialDataType(entry.node, entry.value, {
      requiresPrefix: entry.requiresPrefix,
    });

    if (applyResult.handled) {
      result.handledCount++;
      for (const type of applyResult.appliedTypes) {
        result.typesCounts.set(type, (result.typesCounts.get(type) ?? 0) + 1);
      }
    } else {
      result.unhandledCount++;
    }

    if (applyResult.error) {
      result.errors.push(applyResult.error);
    }

    result.warnings.push(...applyResult.warnings);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a node type requires the `/` prefix for special data types.
 *
 * Text and instance nodes need the prefix to distinguish special types
 * from regular content.
 *
 * @param nodeType - The node type to check
 * @returns true if the node type requires the prefix
 */
export function requiresSpecialPrefix(nodeType: string): boolean {
  return nodeType === 'TEXT' || nodeType === 'INSTANCE';
}

/**
 * Get a human-readable description of a color.
 *
 * @param color - The RGB color
 * @returns Description string
 */
export function describeColor(color: RGB): string {
  return `RGB(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
}
