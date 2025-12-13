/**
 * Core type definitions for Sheets Sync plugin.
 * These types are shared across the plugin codebase.
 */

// ============================================================================
// Sheet Data Types
// ============================================================================

/**
 * Represents the complete data from a Google Sheets document.
 */
export interface SheetData {
  /** All worksheets in the spreadsheet */
  worksheets: Worksheet[];
  /** Name of the currently active/default worksheet */
  activeWorksheet: string;
}

/**
 * Represents a single worksheet/tab within a Google Sheets document.
 */
export interface Worksheet {
  /** Name of the worksheet tab */
  name: string;
  /** Column/row headers (labels) */
  labels: string[];
  /** Map of label name to array of values */
  rows: Record<string, string[]>;
  /** Whether labels are in columns (top row) or rows (left column) */
  orientation: 'columns' | 'rows';
}

// ============================================================================
// Layer Binding Types
// ============================================================================

/**
 * Represents parsed binding information from a layer name.
 */
export interface ParsedLayerName {
  /** Whether this layer has any data binding (#Label syntax) */
  hasBinding: boolean;
  /** List of labels this layer is bound to */
  labels: string[];
  /** Specific worksheet to use (from // syntax) */
  worksheet?: string;
  /** Index specification for which row value to use */
  index?: IndexType;
  /** Whether this layer should be ignored (- prefix) */
  isIgnored: boolean;
  /** Whether to force include main component (+ prefix) */
  forceInclude: boolean;
  /** Whether this is a repeat frame (@# syntax) */
  isRepeatFrame: boolean;
}

/**
 * Specifies how to determine which row's value to use.
 */
export type IndexType =
  | { type: 'specific'; value: number }
  | { type: 'increment' }
  | { type: 'incrementNonBlank' }
  | { type: 'random' }
  | { type: 'randomNonBlank' };

/**
 * Resolved binding information after inheritance is applied.
 */
export interface LayerBinding {
  /** The label to look up in sheet data */
  label: string;
  /** Which worksheet to use */
  worksheet?: string;
  /** How to determine the index */
  index: IndexType;
}

// ============================================================================
// Sync Context & Results
// ============================================================================

/**
 * Context maintained throughout a sync operation.
 */
export interface SyncContext {
  /** The fetched sheet data */
  sheetData: SheetData;
  /** Current sync scope */
  scope: SyncScope;
}

/**
 * Defines what portion of the document to sync.
 */
export type SyncScope = 'document' | 'page' | 'selection';

/**
 * Options for running a sync operation.
 */
export interface SyncOptions {
  /** Google Sheets URL to fetch data from */
  url: string;
  /** What portion of the document to sync */
  scope: SyncScope;
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /** Whether the sync completed without fatal errors */
  success: boolean;
  /** Number of layers that were examined */
  layersProcessed: number;
  /** Number of layers that were actually updated */
  layersUpdated: number;
  /** Errors encountered during sync */
  errors: SyncError[];
  /** Non-fatal warnings */
  warnings: string[];
}

/**
 * Error that occurred while syncing a specific layer.
 */
export interface SyncError {
  /** Name of the layer that failed */
  layerName: string;
  /** Figma node ID */
  layerId: string;
  /** Error description */
  error: string;
}

// ============================================================================
// URL Parsing Types
// ============================================================================

/**
 * Result of parsing a Google Sheets URL.
 */
export interface ParsedSheetUrl {
  /** The extracted spreadsheet ID */
  spreadsheetId: string;
  /** The worksheet gid if present in URL */
  gid?: string;
  /** Whether the URL is valid */
  isValid: boolean;
  /** Error message if URL is invalid */
  errorMessage?: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Categories of errors that can occur in the plugin.
 */
export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  SHEET_NOT_PUBLIC = 'SHEET_NOT_PUBLIC',
  SHEET_NOT_FOUND = 'SHEET_NOT_FOUND',
  INVALID_URL = 'INVALID_URL',
  FONT_NOT_FOUND = 'FONT_NOT_FOUND',
  COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',
  IMAGE_LOAD_FAILED = 'IMAGE_LOAD_FAILED',
  PARSE_ERROR = 'PARSE_ERROR',
  WORKSHEET_NOT_FOUND = 'WORKSHEET_NOT_FOUND',
  LABEL_NOT_FOUND = 'LABEL_NOT_FOUND',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Application-specific error with user-friendly messaging.
 */
export interface AppError extends Error {
  /** Error category */
  type: ErrorType;
  /** User-friendly message */
  userMessage: string;
  /** Technical details for debugging */
  details?: string;
  /** Whether the error is recoverable (sync can continue) */
  recoverable: boolean;
}

// ============================================================================
// Special Data Types
// ============================================================================

/**
 * RGB color value normalized to 0-1 range for Figma.
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Dimension change specification.
 */
export interface DimensionValue {
  type: 'size' | 'width' | 'height';
  value: number;
}

/**
 * Position change specification.
 */
export interface PositionValue {
  type: 'relative' | 'absolute';
  axis: 'x' | 'y';
  value: number;
}

/**
 * Line height specification.
 */
export interface LineHeightValue {
  type: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

/**
 * Letter spacing specification.
 */
export interface LetterSpacingValue {
  type: 'PIXELS' | 'PERCENT';
  value: number;
}

/**
 * All possible special data type values parsed from a cell.
 */
export interface ParsedSpecialValue {
  visibility?: 'show' | 'hide';
  color?: RGB;
  opacity?: number;
  dimension?: DimensionValue;
  position?: PositionValue;
  rotation?: number;
  textAlign?: {
    horizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    vertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  };
  fontSize?: number;
  lineHeight?: LineHeightValue;
  letterSpacing?: LetterSpacingValue;
}

// ============================================================================
// Layer Processing Types
// ============================================================================

/**
 * A layer queued for processing during sync.
 */
export interface LayerToProcess {
  /** The Figma node */
  node: SceneNode;
  /** Resolved binding information (with inheritance applied) */
  resolvedBinding: ParsedLayerName;
  /** Depth in the layer tree (for ordering) */
  depth: number;
}

/**
 * Options for traversing the layer tree.
 */
export interface TraversalOptions {
  /** What portion of the document to traverse */
  scope: SyncScope;
}

// ============================================================================
// Component Cache Types
// ============================================================================

/**
 * Cache of components for fast lookup during sync.
 */
export interface ComponentCache {
  /** Components indexed by normalized name */
  components: Map<string, ComponentNode>;
  /** Component sets indexed by normalized name */
  componentSets: Map<string, ComponentSetNode>;
}
