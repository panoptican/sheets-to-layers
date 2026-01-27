/**
 * Image fill synchronization for Figma layers.
 *
 * Handles applying images from URLs to vector layers:
 * - URL detection (http/https)
 * - Google Drive share link conversion
 * - Layer type validation (only vectors can have image fills)
 * - Image creation and fill application
 *
 * Image fetching happens in the UI context (network access), so this module
 * provides utilities for the main thread to request and apply images.
 */

import type { SyncError } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of syncing an image to a layer.
 */
export interface ImageSyncResult {
  /** Whether the sync was successful */
  success: boolean;
  /** Whether the layer fill was changed */
  fillChanged: boolean;
  /** Error if sync failed */
  error?: SyncError;
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Options for image sync.
 */
export interface ImageSyncOptions {
  /** Scale mode for the image fill (default: 'FILL') */
  scaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
}

/**
 * Node types that can have image fills.
 */
const IMAGE_FILL_TYPES: string[] = [
  'RECTANGLE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'VECTOR',
  'LINE',
  'BOOLEAN_OPERATION',
  'FRAME',
  'COMPONENT',
  'INSTANCE',
];

// ============================================================================
// URL Detection & Conversion
// ============================================================================

/**
 * Check if a value is an image URL.
 *
 * @param value - The value to check
 * @returns true if the value starts with http:// or https://
 *
 * @example
 * isImageUrl('https://example.com/image.png') // true
 * isImageUrl('http://example.com/photo.jpg')  // true
 * isImageUrl('Hello World')                   // false
 * isImageUrl('/show')                         // false
 */
export function isImageUrl(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/**
 * Check if a URL is a Google Drive URL.
 *
 * @param url - The URL to check
 * @returns true if the URL is from Google Drive
 *
 * @example
 * isGoogleDriveUrl('https://drive.google.com/file/d/abc123/view') // true
 * isGoogleDriveUrl('https://example.com/image.png')               // false
 */
export function isGoogleDriveUrl(url: string): boolean {
  return url.includes('drive.google.com');
}

/**
 * Check if a URL is a Dropbox URL.
 *
 * @param url - The URL to check
 * @returns true if the URL is from Dropbox
 */
export function isDropboxUrl(url: string): boolean {
  return url.includes('dropbox.com');
}

/**
 * Convert a Google Drive share URL to a direct download URL.
 *
 * Share URL formats:
 * - https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing
 * - https://drive.google.com/open?id={FILE_ID}
 *
 * @param url - The Google Drive share URL
 * @returns The direct download URL
 *
 * @example
 * convertGoogleDriveUrl('https://drive.google.com/file/d/abc123/view?usp=sharing')
 * // => 'https://drive.google.com/uc?export=download&id=abc123'
 */
export function convertGoogleDriveUrl(url: string): string {
  // Pattern 1: /file/d/{FILE_ID}/
  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    return `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
  }

  // Pattern 2: ?id={FILE_ID} or &id={FILE_ID}
  const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) {
    return `https://drive.google.com/uc?export=download&id=${idParamMatch[1]}`;
  }

  // Can't parse, return original
  return url;
}

/**
 * Convert a Dropbox share URL to a direct download URL.
 *
 * Changes ?dl=0 to ?dl=1 or adds ?dl=1 if not present.
 *
 * @param url - The Dropbox share URL
 * @returns The direct download URL
 */
export function convertDropboxUrl(url: string): string {
  // Replace dl=0 with dl=1
  if (url.includes('dl=0')) {
    return url.replace('dl=0', 'dl=1');
  }
  // Add dl=1 if not present
  if (!url.includes('dl=1')) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}dl=1`;
  }
  return url;
}

/**
 * Convert any cloud storage URL to a direct download URL.
 *
 * @param url - The URL to convert
 * @returns The direct download URL
 */
export function convertToDirectUrl(url: string): string {
  if (isGoogleDriveUrl(url)) {
    return convertGoogleDriveUrl(url);
  }
  if (isDropboxUrl(url)) {
    return convertDropboxUrl(url);
  }
  return url;
}

// ============================================================================
// Layer Validation
// ============================================================================

/**
 * Check if a node can have an image fill.
 *
 * @param node - The Figma node to check
 * @returns true if the node type supports image fills
 *
 * @example
 * canHaveImageFill(rectangleNode)  // true
 * canHaveImageFill(textNode)       // false
 */
export function canHaveImageFill(node: SceneNode): boolean {
  return IMAGE_FILL_TYPES.includes(node.type);
}

/**
 * Get a human-readable description of which layer types support image fills.
 *
 * @returns String describing valid layer types
 */
export function getValidImageFillTypes(): string {
  return 'rectangles, ellipses, polygons, stars, vectors, frames, components, and instances';
}

// ============================================================================
// Image Application (Main Thread)
// ============================================================================

/**
 * Apply an image to a layer as a fill.
 *
 * This function runs in the main thread after the image data has been
 * fetched by the UI thread.
 *
 * @param node - The node to apply the image to
 * @param imageData - The image data as Uint8Array
 * @param options - Sync options
 * @returns ImageSyncResult
 *
 * @example
 * const imageData = new Uint8Array([...]); // From UI fetch
 * const result = await applyImageFill(rectangleNode, imageData);
 */
export function applyImageFill(
  node: SceneNode,
  imageData: Uint8Array,
  options: ImageSyncOptions = {}
): ImageSyncResult {
  const result: ImageSyncResult = {
    success: true,
    fillChanged: false,
    warnings: [],
  };

  // Validate node type
  if (!canHaveImageFill(node)) {
    result.success = false;
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: `Cannot apply image fill to ${node.type} layer. Valid types: ${getValidImageFillTypes()}`,
    };
    return result;
  }

  try {
    // Create Figma image from bytes
    const image = figma.createImage(imageData);

    // Determine scaleMode: use explicit option, or preserve existing, or default to FILL
    let scaleMode: ImagePaint['scaleMode'] = options.scaleMode || 'FILL';
    if (!options.scaleMode && 'fills' in node) {
      const currentFills = (node as GeometryMixin).fills;
      if (Array.isArray(currentFills) && currentFills.length > 0) {
        const firstFill = currentFills[0];
        if (firstFill.type === 'IMAGE' && firstFill.scaleMode) {
          scaleMode = firstFill.scaleMode;
        }
      }
    }

    // Create the image fill
    const imageFill: ImagePaint = {
      type: 'IMAGE',
      scaleMode,
      imageHash: image.hash,
    };

    // Apply the fill
    const geometryNode = node as GeometryMixin;
    geometryNode.fills = [imageFill];
    result.fillChanged = true;

    return result;
  } catch (error) {
    result.success = false;
    result.error = {
      layerName: node.name,
      layerId: node.id,
      error: error instanceof Error ? error.message : String(error),
    };
    return result;
  }
}

/**
 * Sync an image URL to a layer.
 *
 * This is a higher-level function that handles URL validation and conversion,
 * but the actual image fetching must happen in the UI context.
 *
 * @param node - The node to sync
 * @param imageUrl - The image URL from sheet data
 * @returns Object with validation result and converted URL
 */
export function prepareImageSync(
  node: SceneNode,
  imageUrl: string
): {
  valid: boolean;
  downloadUrl: string;
  error?: string;
} {
  // Validate URL
  if (!isImageUrl(imageUrl)) {
    return {
      valid: false,
      downloadUrl: '',
      error: `Invalid image URL: ${imageUrl}`,
    };
  }

  // Validate node type
  if (!canHaveImageFill(node)) {
    return {
      valid: false,
      downloadUrl: '',
      error: `Cannot apply image to ${node.type} layer "${node.name}"`,
    };
  }

  // Convert to direct download URL
  const downloadUrl = convertToDirectUrl(imageUrl.trim());

  return {
    valid: true,
    downloadUrl,
  };
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Result of a batch image sync operation.
 */
export interface BatchImageSyncResult {
  /** Total number of image layers processed */
  totalProcessed: number;
  /** Number of layers successfully updated */
  successCount: number;
  /** Number of layers that failed */
  failureCount: number;
  /** Number of layers where fill actually changed */
  changedCount: number;
  /** Errors from failed syncs */
  errors: SyncError[];
  /** All warnings */
  warnings: string[];
}

/**
 * Entry for batch image sync.
 */
export interface ImageSyncEntry {
  /** The node to sync */
  node: SceneNode;
  /** The image data (from UI fetch) */
  imageData: Uint8Array;
}

/**
 * Sync multiple image layers in batch.
 *
 * @param entries - Array of image sync entries
 * @param options - Options applying to all entries
 * @returns BatchImageSyncResult
 */
export function batchApplyImageFills(
  entries: ImageSyncEntry[],
  options: ImageSyncOptions = {}
): BatchImageSyncResult {
  const result: BatchImageSyncResult = {
    totalProcessed: entries.length,
    successCount: 0,
    failureCount: 0,
    changedCount: 0,
    errors: [],
    warnings: [],
  };

  for (const entry of entries) {
    const syncResult = applyImageFill(entry.node, entry.imageData, options);

    if (syncResult.success) {
      result.successCount++;
      if (syncResult.fillChanged) {
        result.changedCount++;
      }
    } else {
      result.failureCount++;
      if (syncResult.error) {
        result.errors.push(syncResult.error);
      }
    }

    result.warnings.push(...syncResult.warnings);
  }

  return result;
}

// ============================================================================
// Image URL Utilities
// ============================================================================

/**
 * Extract file extension from a URL.
 *
 * @param url - The URL to extract extension from
 * @returns The file extension (lowercase) or empty string
 */
export function getImageExtension(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot > 0) {
      return pathname.slice(lastDot + 1).toLowerCase();
    }
  } catch {
    // Invalid URL, try simple extraction
    const lastDot = url.lastIndexOf('.');
    if (lastDot > 0) {
      const ext = url.slice(lastDot + 1).toLowerCase();
      // Only return if it looks like an extension (no slashes, short)
      if (ext.length <= 5 && !ext.includes('/')) {
        return ext.split('?')[0]; // Remove query params
      }
    }
  }
  return '';
}

/**
 * Check if a URL appears to be an image based on extension.
 *
 * @param url - The URL to check
 * @returns true if the URL has a common image extension
 */
export function hasImageExtension(url: string): boolean {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const ext = getImageExtension(url);
  return imageExtensions.includes(ext);
}

/**
 * Check if a URL is likely an image (by URL pattern or extension).
 *
 * Note: This is a heuristic and may not be 100% accurate.
 * The actual content type should be checked during fetch.
 *
 * @param url - The URL to check
 * @returns true if the URL likely points to an image
 */
export function looksLikeImageUrl(url: string): boolean {
  if (!isImageUrl(url)) {
    return false;
  }

  // Check for common image hosting services
  const imageHostPatterns = [
    'imgur.com',
    'i.imgur.com',
    'cloudinary.com',
    'unsplash.com',
    'images.unsplash.com',
    'pbs.twimg.com',
    'media.giphy.com',
    'i.pinimg.com',
  ];

  const lowerUrl = url.toLowerCase();
  for (const pattern of imageHostPatterns) {
    if (lowerUrl.includes(pattern)) {
      return true;
    }
  }

  // Check for image extension
  if (hasImageExtension(url)) {
    return true;
  }

  // Check for Google Drive or Dropbox (might be images)
  if (isGoogleDriveUrl(url) || isDropboxUrl(url)) {
    return true;
  }

  // Default to false if no patterns match
  return false;
}
