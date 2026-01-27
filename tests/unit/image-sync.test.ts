/**
 * Unit tests for image fill synchronization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMockRectangle,
  createMockEllipse,
  createMockVector,
  createMockText,
  createMockFrame,
  createMockPage,
  createMockDocument,
  createMockFigma,
  setupMockFigma,
  cleanupMockFigma,
  resetNodeIdCounter,
  resetImageCounter,
  getCreatedImages,
  clearCreatedImages,
  type MockRectangleNode,
  type MockEllipseNode,
  type MockVectorNode,
} from '../mocks/figma';
import {
  isImageUrl,
  isGoogleDriveUrl,
  isDropboxUrl,
  convertGoogleDriveUrl,
  convertDropboxUrl,
  convertToDirectUrl,
  canHaveImageFill,
  applyImageFill,
  prepareImageSync,
  batchApplyImageFills,
  getImageExtension,
  hasImageExtension,
  looksLikeImageUrl,
} from '../../src/core/image-sync';

describe('Image Sync', () => {
  beforeEach(() => {
    resetNodeIdCounter();
    resetImageCounter();
    const page = createMockPage('Page 1');
    const doc = createMockDocument([page]);
    const mockFigma = createMockFigma(doc, page);
    setupMockFigma(mockFigma);
    clearCreatedImages();
  });

  afterEach(() => {
    cleanupMockFigma();
  });

  // ============================================================================
  // URL Detection Tests
  // ============================================================================

  describe('isImageUrl', () => {
    it('returns true for http URLs', () => {
      expect(isImageUrl('http://example.com/image.png')).toBe(true);
    });

    it('returns true for https URLs', () => {
      expect(isImageUrl('https://example.com/image.png')).toBe(true);
    });

    it('returns true for URLs with whitespace', () => {
      expect(isImageUrl('  https://example.com/image.png  ')).toBe(true);
    });

    it('returns false for non-URLs', () => {
      expect(isImageUrl('Hello World')).toBe(false);
      expect(isImageUrl('/show')).toBe(false);
      expect(isImageUrl('')).toBe(false);
      expect(isImageUrl('image.png')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isImageUrl(null as unknown as string)).toBe(false);
      expect(isImageUrl(undefined as unknown as string)).toBe(false);
    });
  });

  describe('isGoogleDriveUrl', () => {
    it('returns true for Google Drive URLs', () => {
      expect(isGoogleDriveUrl('https://drive.google.com/file/d/abc123/view')).toBe(true);
      expect(isGoogleDriveUrl('https://drive.google.com/open?id=abc123')).toBe(true);
    });

    it('returns false for non-Google Drive URLs', () => {
      expect(isGoogleDriveUrl('https://example.com/image.png')).toBe(false);
      expect(isGoogleDriveUrl('https://dropbox.com/file.png')).toBe(false);
    });
  });

  describe('isDropboxUrl', () => {
    it('returns true for Dropbox URLs', () => {
      expect(isDropboxUrl('https://dropbox.com/s/abc123/file.png?dl=0')).toBe(true);
      expect(isDropboxUrl('https://www.dropbox.com/s/abc123/file.png')).toBe(true);
    });

    it('returns false for non-Dropbox URLs', () => {
      expect(isDropboxUrl('https://example.com/image.png')).toBe(false);
      expect(isDropboxUrl('https://drive.google.com/file/d/abc123/view')).toBe(false);
    });
  });

  // ============================================================================
  // URL Conversion Tests
  // ============================================================================

  describe('convertGoogleDriveUrl', () => {
    it('converts /file/d/{ID}/ format', () => {
      const shareUrl = 'https://drive.google.com/file/d/abc123XYZ/view?usp=sharing';
      const expected = 'https://drive.google.com/uc?export=download&id=abc123XYZ';
      expect(convertGoogleDriveUrl(shareUrl)).toBe(expected);
    });

    it('converts ?id={ID} format', () => {
      const shareUrl = 'https://drive.google.com/open?id=abc123XYZ';
      const expected = 'https://drive.google.com/uc?export=download&id=abc123XYZ';
      expect(convertGoogleDriveUrl(shareUrl)).toBe(expected);
    });

    it('handles IDs with special characters', () => {
      const shareUrl = 'https://drive.google.com/file/d/abc-123_XYZ/view';
      const expected = 'https://drive.google.com/uc?export=download&id=abc-123_XYZ';
      expect(convertGoogleDriveUrl(shareUrl)).toBe(expected);
    });

    it('returns original URL if cannot parse', () => {
      const url = 'https://drive.google.com/invalid';
      expect(convertGoogleDriveUrl(url)).toBe(url);
    });
  });

  describe('convertDropboxUrl', () => {
    it('converts dl=0 to dl=1', () => {
      const shareUrl = 'https://dropbox.com/s/abc123/file.png?dl=0';
      const expected = 'https://dropbox.com/s/abc123/file.png?dl=1';
      expect(convertDropboxUrl(shareUrl)).toBe(expected);
    });

    it('adds dl=1 if not present', () => {
      const shareUrl = 'https://dropbox.com/s/abc123/file.png';
      const expected = 'https://dropbox.com/s/abc123/file.png?dl=1';
      expect(convertDropboxUrl(shareUrl)).toBe(expected);
    });

    it('adds dl=1 with & if query params exist', () => {
      const shareUrl = 'https://dropbox.com/s/abc123/file.png?raw=1';
      const expected = 'https://dropbox.com/s/abc123/file.png?raw=1&dl=1';
      expect(convertDropboxUrl(shareUrl)).toBe(expected);
    });

    it('keeps dl=1 unchanged', () => {
      const url = 'https://dropbox.com/s/abc123/file.png?dl=1';
      expect(convertDropboxUrl(url)).toBe(url);
    });
  });

  describe('convertToDirectUrl', () => {
    it('converts Google Drive URLs', () => {
      const url = 'https://drive.google.com/file/d/abc123/view';
      expect(convertToDirectUrl(url)).toBe('https://drive.google.com/uc?export=download&id=abc123');
    });

    it('converts Dropbox URLs', () => {
      const url = 'https://dropbox.com/s/abc123/file.png?dl=0';
      expect(convertToDirectUrl(url)).toBe('https://dropbox.com/s/abc123/file.png?dl=1');
    });

    it('passes through regular URLs unchanged', () => {
      const url = 'https://example.com/image.png';
      expect(convertToDirectUrl(url)).toBe(url);
    });
  });

  // ============================================================================
  // Layer Validation Tests
  // ============================================================================

  describe('canHaveImageFill', () => {
    it('returns true for rectangle nodes', () => {
      const rect = createMockRectangle('#Image');
      expect(canHaveImageFill(rect as unknown as SceneNode)).toBe(true);
    });

    it('returns true for ellipse nodes', () => {
      const ellipse = createMockEllipse('#Image');
      expect(canHaveImageFill(ellipse as unknown as SceneNode)).toBe(true);
    });

    it('returns true for vector nodes', () => {
      const vector = createMockVector('#Image');
      expect(canHaveImageFill(vector as unknown as SceneNode)).toBe(true);
    });

    it('returns true for frame nodes', () => {
      const frame = createMockFrame('#Image');
      expect(canHaveImageFill(frame as unknown as SceneNode)).toBe(true);
    });

    it('returns false for text nodes', () => {
      const text = createMockText('#Image');
      expect(canHaveImageFill(text as unknown as SceneNode)).toBe(false);
    });

    it('returns false for group nodes', () => {
      const group = { type: 'GROUP', name: 'group', id: 'g1' };
      expect(canHaveImageFill(group as unknown as SceneNode)).toBe(false);
    });
  });

  // ============================================================================
  // Image Application Tests
  // ============================================================================

  describe('applyImageFill', () => {
    it('applies image fill to rectangle', () => {
      const rect = createMockRectangle('#Image') as unknown as MockRectangleNode;
      const imageData = new Uint8Array([1, 2, 3, 4]);

      const result = applyImageFill(rect as unknown as SceneNode, imageData);

      expect(result.success).toBe(true);
      expect(result.fillChanged).toBe(true);
      expect(rect.fills).toHaveLength(1);
      expect(rect.fills[0].type).toBe('IMAGE');
      expect((rect.fills[0] as { scaleMode: string }).scaleMode).toBe('FILL');
    });

    it('creates Figma image from data', () => {
      const rect = createMockRectangle('#Image');
      const imageData = new Uint8Array([1, 2, 3, 4]);

      applyImageFill(rect as unknown as SceneNode, imageData);

      const images = getCreatedImages();
      expect(images).toHaveLength(1);
      expect(images[0].hash).toContain('mock-image-hash');
    });

    it('applies custom scale mode', () => {
      const rect = createMockRectangle('#Image') as unknown as MockRectangleNode;
      const imageData = new Uint8Array([1, 2, 3, 4]);

      applyImageFill(rect as unknown as SceneNode, imageData, { scaleMode: 'FIT' });

      expect((rect.fills[0] as { scaleMode: string }).scaleMode).toBe('FIT');
    });

    it('fails for text nodes', () => {
      const text = createMockText('#Image');
      const imageData = new Uint8Array([1, 2, 3, 4]);

      const result = applyImageFill(text as unknown as SceneNode, imageData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.error).toContain('Cannot apply image fill to TEXT');
    });

    it('returns error info on failure', () => {
      const text = createMockText('#BadImage', 'text');
      const imageData = new Uint8Array([1, 2, 3, 4]);

      const result = applyImageFill(text as unknown as SceneNode, imageData);

      expect(result.success).toBe(false);
      expect(result.error?.layerName).toBe('#BadImage');
      expect(result.error?.layerId).toBeDefined();
    });
  });

  describe('prepareImageSync', () => {
    it('validates and prepares image sync', () => {
      const rect = createMockRectangle('#Image');
      const url = 'https://example.com/image.png';

      const result = prepareImageSync(rect as unknown as SceneNode, url);

      expect(result.valid).toBe(true);
      expect(result.downloadUrl).toBe(url);
    });

    it('converts Google Drive URLs', () => {
      const rect = createMockRectangle('#Image');
      const url = 'https://drive.google.com/file/d/abc123/view';

      const result = prepareImageSync(rect as unknown as SceneNode, url);

      expect(result.valid).toBe(true);
      expect(result.downloadUrl).toBe('https://drive.google.com/uc?export=download&id=abc123');
    });

    it('fails for non-URL values', () => {
      const rect = createMockRectangle('#Image');
      const value = 'Hello World';

      const result = prepareImageSync(rect as unknown as SceneNode, value);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid image URL');
    });

    it('fails for incompatible node types', () => {
      const text = createMockText('#Image');
      const url = 'https://example.com/image.png';

      const result = prepareImageSync(text as unknown as SceneNode, url);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot apply image to TEXT');
    });
  });

  // ============================================================================
  // Batch Processing Tests
  // ============================================================================

  describe('batchApplyImageFills', () => {
    it('syncs multiple image layers', () => {
      const entries = [
        { node: createMockRectangle('#Image1') as unknown as SceneNode, imageData: new Uint8Array([1]) },
        { node: createMockEllipse('#Image2') as unknown as SceneNode, imageData: new Uint8Array([2]) },
        { node: createMockVector('#Image3') as unknown as SceneNode, imageData: new Uint8Array([3]) },
      ];

      const result = batchApplyImageFills(entries);

      expect(result.totalProcessed).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.changedCount).toBe(3);
    });

    it('continues after individual failures', () => {
      const entries = [
        { node: createMockRectangle('#Good') as unknown as SceneNode, imageData: new Uint8Array([1]) },
        { node: createMockText('#Bad') as unknown as SceneNode, imageData: new Uint8Array([2]) },
        { node: createMockEllipse('#Also Good') as unknown as SceneNode, imageData: new Uint8Array([3]) },
      ];

      const result = batchApplyImageFills(entries);

      expect(result.totalProcessed).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('handles empty batch', () => {
      const result = batchApplyImageFills([]);

      expect(result.totalProcessed).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });
  });

  // ============================================================================
  // Image URL Utilities Tests
  // ============================================================================

  describe('getImageExtension', () => {
    it('extracts extension from simple URL', () => {
      expect(getImageExtension('https://example.com/image.png')).toBe('png');
      expect(getImageExtension('https://example.com/photo.jpg')).toBe('jpg');
      expect(getImageExtension('https://example.com/file.webp')).toBe('webp');
    });

    it('extracts extension from URL with query params', () => {
      expect(getImageExtension('https://example.com/image.png?v=1')).toBe('png');
    });

    it('returns empty for URLs without extension', () => {
      expect(getImageExtension('https://example.com/image')).toBe('');
      expect(getImageExtension('https://example.com/')).toBe('');
    });

    it('handles invalid URLs gracefully', () => {
      expect(getImageExtension('not-a-url')).toBe('');
    });
  });

  describe('hasImageExtension', () => {
    it('returns true for common image extensions', () => {
      expect(hasImageExtension('https://example.com/image.png')).toBe(true);
      expect(hasImageExtension('https://example.com/image.jpg')).toBe(true);
      expect(hasImageExtension('https://example.com/image.jpeg')).toBe(true);
      expect(hasImageExtension('https://example.com/image.gif')).toBe(true);
      expect(hasImageExtension('https://example.com/image.webp')).toBe(true);
      expect(hasImageExtension('https://example.com/image.svg')).toBe(true);
    });

    it('returns false for non-image extensions', () => {
      expect(hasImageExtension('https://example.com/file.pdf')).toBe(false);
      expect(hasImageExtension('https://example.com/file.txt')).toBe(false);
    });
  });

  describe('looksLikeImageUrl', () => {
    it('returns true for URLs with image extensions', () => {
      expect(looksLikeImageUrl('https://example.com/image.png')).toBe(true);
    });

    it('returns true for known image hosting services', () => {
      expect(looksLikeImageUrl('https://i.imgur.com/abc123')).toBe(true);
      expect(looksLikeImageUrl('https://images.unsplash.com/photo')).toBe(true);
    });

    it('returns true for Google Drive URLs', () => {
      expect(looksLikeImageUrl('https://drive.google.com/file/d/abc123/view')).toBe(true);
    });

    it('returns true for Dropbox URLs', () => {
      expect(looksLikeImageUrl('https://dropbox.com/s/abc123/file.png')).toBe(true);
    });

    it('returns false for non-URLs', () => {
      expect(looksLikeImageUrl('Hello World')).toBe(false);
    });

    it('returns false for ambiguous URLs', () => {
      expect(looksLikeImageUrl('https://example.com/api/data')).toBe(false);
    });
  });
});
