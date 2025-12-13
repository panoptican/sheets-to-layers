/**
 * Unit tests for special data type parsing and application.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMockRectangle,
  createMockEllipse,
  createMockVector,
  createMockText,
  createMockFrame,
  createMockGroup,
  createMockInstance,
  createMockComponent,
  createMockPage,
  createMockDocument,
  createMockFigma,
  setupMockFigma,
  cleanupMockFigma,
  resetNodeIdCounter,
  type MockRectangleNode,
  type MockGroupNode,
} from '../mocks/figma';
import {
  parseVisibility,
  isVisibilityValue,
  applyVisibility,
  parseHexColor,
  isHexColor,
  rgbToHex,
  canHaveFills,
  applyFillColor,
  parseOpacity,
  isOpacityValue,
  applyOpacity,
  parseDimension,
  isDimensionValue,
  canResize,
  applyDimension,
  parsePosition,
  isPositionValue,
  applyPosition,
  parseRotation,
  isRotationValue,
  applyRotation,
  parseTextAlign,
  isTextAlignValue,
  applyTextAlign,
  parseFontSize,
  isFontSizeValue,
  applyFontSize,
  parseLineHeight,
  isLineHeightValue,
  applyLineHeight,
  parseLetterSpacing,
  isLetterSpacingValue,
  applyLetterSpacing,
  tokenizeChainedValue,
  isChainedSpecialType,
  parseChainedSpecialTypes,
  hasAnyParsedType,
  countParsedTypes,
  applyChainedSpecialTypes,
  stripPrefix,
  hasSpecialPrefix,
  isSpecialDataType,
  applySpecialDataType,
  batchApplySpecialTypes,
  requiresSpecialPrefix,
  describeColor,
} from '../../src/core/special-types';

describe('Special Types', () => {
  beforeEach(() => {
    resetNodeIdCounter();
    const page = createMockPage('Page 1');
    const doc = createMockDocument([page]);
    const mockFigma = createMockFigma(doc, page);
    setupMockFigma(mockFigma);
  });

  afterEach(() => {
    cleanupMockFigma();
  });

  // ============================================================================
  // Visibility Parsing Tests
  // ============================================================================

  describe('parseVisibility', () => {
    it('parses "show" value', () => {
      expect(parseVisibility('show')).toBe('show');
    });

    it('parses "hide" value', () => {
      expect(parseVisibility('hide')).toBe('hide');
    });

    it('handles case insensitivity', () => {
      expect(parseVisibility('SHOW')).toBe('show');
      expect(parseVisibility('HIDE')).toBe('hide');
      expect(parseVisibility('Show')).toBe('show');
      expect(parseVisibility('Hide')).toBe('hide');
      expect(parseVisibility('sHoW')).toBe('show');
    });

    it('handles whitespace', () => {
      expect(parseVisibility('  show  ')).toBe('show');
      expect(parseVisibility('  hide  ')).toBe('hide');
    });

    it('returns null for non-visibility values', () => {
      expect(parseVisibility('visible')).toBeNull();
      expect(parseVisibility('hidden')).toBeNull();
      expect(parseVisibility('true')).toBeNull();
      expect(parseVisibility('false')).toBeNull();
      expect(parseVisibility('')).toBeNull();
      expect(parseVisibility('hello')).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(parseVisibility(null as unknown as string)).toBeNull();
      expect(parseVisibility(undefined as unknown as string)).toBeNull();
    });
  });

  describe('isVisibilityValue', () => {
    it('returns true for show/hide', () => {
      expect(isVisibilityValue('show')).toBe(true);
      expect(isVisibilityValue('hide')).toBe(true);
      expect(isVisibilityValue('SHOW')).toBe(true);
      expect(isVisibilityValue('HIDE')).toBe(true);
    });

    it('returns false for other values', () => {
      expect(isVisibilityValue('visible')).toBe(false);
      expect(isVisibilityValue('')).toBe(false);
      expect(isVisibilityValue('#FF0000')).toBe(false);
    });
  });

  describe('applyVisibility', () => {
    it('shows a hidden node', () => {
      const rect = createMockRectangle('#Layer');
      rect.visible = false;

      const changed = applyVisibility(rect as unknown as SceneNode, 'show');

      expect(changed).toBe(true);
      expect(rect.visible).toBe(true);
    });

    it('hides a visible node', () => {
      const rect = createMockRectangle('#Layer');
      rect.visible = true;

      const changed = applyVisibility(rect as unknown as SceneNode, 'hide');

      expect(changed).toBe(true);
      expect(rect.visible).toBe(false);
    });

    it('returns false when already showing', () => {
      const rect = createMockRectangle('#Layer');
      rect.visible = true;

      const changed = applyVisibility(rect as unknown as SceneNode, 'show');

      expect(changed).toBe(false);
      expect(rect.visible).toBe(true);
    });

    it('returns false when already hidden', () => {
      const rect = createMockRectangle('#Layer');
      rect.visible = false;

      const changed = applyVisibility(rect as unknown as SceneNode, 'hide');

      expect(changed).toBe(false);
      expect(rect.visible).toBe(false);
    });
  });

  // ============================================================================
  // Color Parsing Tests
  // ============================================================================

  describe('parseHexColor', () => {
    it('parses 6-digit hex colors', () => {
      const red = parseHexColor('#FF0000');
      expect(red).toEqual({ r: 1, g: 0, b: 0 });

      const green = parseHexColor('#00FF00');
      expect(green).toEqual({ r: 0, g: 1, b: 0 });

      const blue = parseHexColor('#0000FF');
      expect(blue).toEqual({ r: 0, g: 0, b: 1 });

      const white = parseHexColor('#FFFFFF');
      expect(white).toEqual({ r: 1, g: 1, b: 1 });

      const black = parseHexColor('#000000');
      expect(black).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('parses 3-digit shorthand hex colors', () => {
      const red = parseHexColor('#F00');
      expect(red).toEqual({ r: 1, g: 0, b: 0 });

      const cyan = parseHexColor('#0FF');
      expect(cyan).toEqual({ r: 0, g: 1, b: 1 });

      const white = parseHexColor('#FFF');
      expect(white).toEqual({ r: 1, g: 1, b: 1 });
    });

    it('parses 1-digit grayscale', () => {
      const result = parseHexColor('#F');
      expect(result).toEqual({ r: 1, g: 1, b: 1 });

      const black = parseHexColor('#0');
      expect(black).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('parses 2-digit grayscale', () => {
      const result = parseHexColor('#80');
      expect(result?.r).toBeCloseTo(0.502, 2);
      expect(result?.g).toBeCloseTo(0.502, 2);
      expect(result?.b).toBeCloseTo(0.502, 2);
    });

    it('handles lowercase hex', () => {
      expect(parseHexColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
      expect(parseHexColor('#abc')).toBeDefined();
    });

    it('handles whitespace', () => {
      expect(parseHexColor('  #FF0000  ')).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('returns null for invalid formats', () => {
      expect(parseHexColor('')).toBeNull();
      expect(parseHexColor('FF0000')).toBeNull(); // Missing #
      expect(parseHexColor('#GGGGGG')).toBeNull(); // Invalid hex chars
      expect(parseHexColor('#12345')).toBeNull(); // 5 chars
      expect(parseHexColor('#1234567')).toBeNull(); // 7 chars
      expect(parseHexColor('red')).toBeNull();
    });

    it('returns null for invalid input types', () => {
      expect(parseHexColor(null as unknown as string)).toBeNull();
      expect(parseHexColor(undefined as unknown as string)).toBeNull();
    });
  });

  describe('isHexColor', () => {
    it('returns true for valid hex colors', () => {
      expect(isHexColor('#FF0000')).toBe(true);
      expect(isHexColor('#F00')).toBe(true);
      expect(isHexColor('#FF')).toBe(true);
      expect(isHexColor('#F')).toBe(true);
    });

    it('returns false for non-colors', () => {
      expect(isHexColor('show')).toBe(false);
      expect(isHexColor('red')).toBe(false);
      expect(isHexColor('')).toBe(false);
    });
  });

  describe('rgbToHex', () => {
    it('converts RGB to hex string', () => {
      expect(rgbToHex({ r: 1, g: 0, b: 0 })).toBe('#FF0000');
      expect(rgbToHex({ r: 0, g: 1, b: 0 })).toBe('#00FF00');
      expect(rgbToHex({ r: 0, g: 0, b: 1 })).toBe('#0000FF');
      expect(rgbToHex({ r: 1, g: 1, b: 1 })).toBe('#FFFFFF');
      expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    });

    it('handles fractional values', () => {
      expect(rgbToHex({ r: 0.5, g: 0.5, b: 0.5 })).toBe('#808080');
    });
  });

  // ============================================================================
  // Color Application Tests
  // ============================================================================

  describe('canHaveFills', () => {
    it('returns true for shapes with fills', () => {
      expect(canHaveFills(createMockRectangle('#R') as unknown as SceneNode)).toBe(true);
      expect(canHaveFills(createMockEllipse('#E') as unknown as SceneNode)).toBe(true);
      expect(canHaveFills(createMockVector('#V') as unknown as SceneNode)).toBe(true);
      expect(canHaveFills(createMockFrame('#F') as unknown as SceneNode)).toBe(true);
    });

    it('returns false for groups', () => {
      expect(canHaveFills(createMockGroup('#G') as unknown as SceneNode)).toBe(false);
    });

    it('returns false for text nodes', () => {
      expect(canHaveFills(createMockText('#T') as unknown as SceneNode)).toBe(false);
    });
  });

  describe('applyFillColor', () => {
    it('applies fill to rectangle', () => {
      const rect = createMockRectangle('#Layer') as unknown as MockRectangleNode;

      const changed = applyFillColor(rect as unknown as SceneNode, { r: 1, g: 0, b: 0 });

      expect(changed).toBe(true);
      expect(rect.fills).toHaveLength(1);
      expect(rect.fills[0].type).toBe('SOLID');
      expect((rect.fills[0] as { color: { r: number; g: number; b: number } }).color).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('applies fill to ellipse', () => {
      const ellipse = createMockEllipse('#Layer');

      const changed = applyFillColor(ellipse as unknown as SceneNode, { r: 0, g: 1, b: 0 });

      expect(changed).toBe(true);
      expect(ellipse.fills[0].type).toBe('SOLID');
    });

    it('applies fill recursively to group children', () => {
      const rect1 = createMockRectangle('#R1');
      const rect2 = createMockRectangle('#R2');
      const group = createMockGroup('#Group', [rect1, rect2]) as unknown as MockGroupNode;

      const changed = applyFillColor(group as unknown as SceneNode, { r: 0, g: 0, b: 1 });

      expect(changed).toBe(true);
      expect(rect1.fills[0].type).toBe('SOLID');
      expect(rect2.fills[0].type).toBe('SOLID');
    });

    it('skips nodes without fills in groups', () => {
      const rect = createMockRectangle('#R');
      const text = createMockText('#T');
      const group = createMockGroup('#Group', [rect, text]);

      const changed = applyFillColor(group as unknown as SceneNode, { r: 1, g: 1, b: 0 });

      expect(changed).toBe(true);
      expect(rect.fills[0].type).toBe('SOLID');
    });

    it('returns false for node without fills support', () => {
      const text = createMockText('#Text');

      const changed = applyFillColor(text as unknown as SceneNode, { r: 1, g: 0, b: 0 });

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Opacity Parsing Tests
  // ============================================================================

  describe('parseOpacity', () => {
    it('parses whole number percentages', () => {
      expect(parseOpacity('50%')).toBe(0.5);
      expect(parseOpacity('100%')).toBe(1);
      expect(parseOpacity('0%')).toBe(0);
      expect(parseOpacity('75%')).toBe(0.75);
    });

    it('parses decimal percentages', () => {
      expect(parseOpacity('50.5%')).toBe(0.505);
      expect(parseOpacity('33.33%')).toBeCloseTo(0.3333, 4);
    });

    it('handles whitespace', () => {
      expect(parseOpacity('  50%  ')).toBe(0.5);
      expect(parseOpacity('50 %')).toBe(0.5);
    });

    it('clamps to 0-100 range', () => {
      expect(parseOpacity('150%')).toBe(1);
      expect(parseOpacity('200%')).toBe(1);
    });

    it('returns null for non-percentage values', () => {
      expect(parseOpacity('50')).toBeNull();
      expect(parseOpacity('show')).toBeNull();
      expect(parseOpacity('#FF0000')).toBeNull();
      expect(parseOpacity('')).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(parseOpacity(null as unknown as string)).toBeNull();
      expect(parseOpacity(undefined as unknown as string)).toBeNull();
    });
  });

  describe('isOpacityValue', () => {
    it('returns true for valid percentages', () => {
      expect(isOpacityValue('50%')).toBe(true);
      expect(isOpacityValue('100%')).toBe(true);
      expect(isOpacityValue('0%')).toBe(true);
    });

    it('returns false for non-percentages', () => {
      expect(isOpacityValue('50')).toBe(false);
      expect(isOpacityValue('show')).toBe(false);
    });
  });

  describe('applyOpacity', () => {
    it('applies opacity to a node', () => {
      const rect = createMockRectangle('#Layer');
      rect.opacity = 1;

      const changed = applyOpacity(rect as unknown as SceneNode, 0.5);

      expect(changed).toBe(true);
      expect(rect.opacity).toBe(0.5);
    });

    it('returns false when opacity unchanged', () => {
      const rect = createMockRectangle('#Layer');
      rect.opacity = 0.5;

      const changed = applyOpacity(rect as unknown as SceneNode, 0.5);

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Dimension Parsing Tests
  // ============================================================================

  describe('parseDimension', () => {
    it('parses size values', () => {
      const result = parseDimension('100s');
      expect(result).toEqual({ type: 'size', value: 100 });
    });

    it('parses width values', () => {
      const result = parseDimension('200w');
      expect(result).toEqual({ type: 'width', value: 200 });
    });

    it('parses height values', () => {
      const result = parseDimension('150h');
      expect(result).toEqual({ type: 'height', value: 150 });
    });

    it('handles decimal values', () => {
      expect(parseDimension('50.5s')).toEqual({ type: 'size', value: 50.5 });
      expect(parseDimension('100.25w')).toEqual({ type: 'width', value: 100.25 });
    });

    it('handles case insensitivity', () => {
      expect(parseDimension('100S')).toEqual({ type: 'size', value: 100 });
      expect(parseDimension('100W')).toEqual({ type: 'width', value: 100 });
      expect(parseDimension('100H')).toEqual({ type: 'height', value: 100 });
    });

    it('handles whitespace', () => {
      expect(parseDimension('  100s  ')).toEqual({ type: 'size', value: 100 });
      expect(parseDimension('100 s')).toEqual({ type: 'size', value: 100 });
    });

    it('returns null for invalid values', () => {
      expect(parseDimension('100')).toBeNull();
      expect(parseDimension('100px')).toBeNull();
      expect(parseDimension('show')).toBeNull();
      expect(parseDimension('')).toBeNull();
    });
  });

  describe('isDimensionValue', () => {
    it('returns true for valid dimensions', () => {
      expect(isDimensionValue('100s')).toBe(true);
      expect(isDimensionValue('100w')).toBe(true);
      expect(isDimensionValue('100h')).toBe(true);
    });

    it('returns false for non-dimensions', () => {
      expect(isDimensionValue('100')).toBe(false);
      expect(isDimensionValue('show')).toBe(false);
    });
  });

  describe('canResize', () => {
    it('returns true for nodes with resize method', () => {
      const rect = createMockRectangle('#Layer');
      expect(canResize(rect as unknown as SceneNode)).toBe(true);
    });
  });

  describe('applyDimension', () => {
    it('applies uniform size', () => {
      const rect = createMockRectangle('#Layer');
      rect.width = 50;
      rect.height = 50;

      const changed = applyDimension(rect as unknown as SceneNode, { type: 'size', value: 100 });

      expect(changed).toBe(true);
      expect(rect.width).toBe(100);
      expect(rect.height).toBe(100);
    });

    it('applies width only', () => {
      const rect = createMockRectangle('#Layer');
      rect.width = 50;
      rect.height = 75;

      const changed = applyDimension(rect as unknown as SceneNode, { type: 'width', value: 200 });

      expect(changed).toBe(true);
      expect(rect.width).toBe(200);
      expect(rect.height).toBe(75); // Unchanged
    });

    it('applies height only', () => {
      const rect = createMockRectangle('#Layer');
      rect.width = 50;
      rect.height = 75;

      const changed = applyDimension(rect as unknown as SceneNode, { type: 'height', value: 150 });

      expect(changed).toBe(true);
      expect(rect.width).toBe(50); // Unchanged
      expect(rect.height).toBe(150);
    });
  });

  // ============================================================================
  // Position Parsing Tests
  // ============================================================================

  describe('parsePosition', () => {
    it('parses relative x position', () => {
      const result = parsePosition('20x');
      expect(result).toEqual({ type: 'relative', axis: 'x', value: 20 });
    });

    it('parses relative y position', () => {
      const result = parsePosition('40y');
      expect(result).toEqual({ type: 'relative', axis: 'y', value: 40 });
    });

    it('parses absolute x position', () => {
      const result = parsePosition('20xx');
      expect(result).toEqual({ type: 'absolute', axis: 'x', value: 20 });
    });

    it('parses absolute y position', () => {
      const result = parsePosition('40yy');
      expect(result).toEqual({ type: 'absolute', axis: 'y', value: 40 });
    });

    it('handles negative values', () => {
      expect(parsePosition('-10x')).toEqual({ type: 'relative', axis: 'x', value: -10 });
      expect(parsePosition('-20yy')).toEqual({ type: 'absolute', axis: 'y', value: -20 });
    });

    it('handles decimal values', () => {
      expect(parsePosition('10.5x')).toEqual({ type: 'relative', axis: 'x', value: 10.5 });
      expect(parsePosition('20.25yy')).toEqual({ type: 'absolute', axis: 'y', value: 20.25 });
    });

    it('handles case insensitivity', () => {
      expect(parsePosition('20X')).toEqual({ type: 'relative', axis: 'x', value: 20 });
      expect(parsePosition('20XX')).toEqual({ type: 'absolute', axis: 'x', value: 20 });
    });

    it('handles whitespace', () => {
      expect(parsePosition('  20x  ')).toEqual({ type: 'relative', axis: 'x', value: 20 });
    });

    it('returns null for invalid values', () => {
      expect(parsePosition('20')).toBeNull();
      expect(parsePosition('20px')).toBeNull();
      expect(parsePosition('show')).toBeNull();
      expect(parsePosition('')).toBeNull();
    });
  });

  describe('isPositionValue', () => {
    it('returns true for valid positions', () => {
      expect(isPositionValue('20x')).toBe(true);
      expect(isPositionValue('40y')).toBe(true);
      expect(isPositionValue('20xx')).toBe(true);
      expect(isPositionValue('40yy')).toBe(true);
    });

    it('returns false for non-positions', () => {
      expect(isPositionValue('20')).toBe(false);
      expect(isPositionValue('show')).toBe(false);
    });
  });

  describe('applyPosition', () => {
    it('applies relative x position', () => {
      const rect = createMockRectangle('#Layer');
      rect.x = 10;
      rect.y = 20;

      const changed = applyPosition(rect as unknown as SceneNode, { type: 'relative', axis: 'x', value: 50 });

      expect(changed).toBe(true);
      expect(rect.x).toBe(50);
      expect(rect.y).toBe(20); // Unchanged
    });

    it('applies relative y position', () => {
      const rect = createMockRectangle('#Layer');
      rect.x = 10;
      rect.y = 20;

      const changed = applyPosition(rect as unknown as SceneNode, { type: 'relative', axis: 'y', value: 100 });

      expect(changed).toBe(true);
      expect(rect.x).toBe(10); // Unchanged
      expect(rect.y).toBe(100);
    });

    it('returns false when position unchanged', () => {
      const rect = createMockRectangle('#Layer');
      rect.x = 50;
      rect.y = 100;

      const changed = applyPosition(rect as unknown as SceneNode, { type: 'relative', axis: 'x', value: 50 });

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Rotation Parsing Tests
  // ============================================================================

  describe('parseRotation', () => {
    it('parses positive rotation', () => {
      expect(parseRotation('30º')).toBe(30);
      expect(parseRotation('90º')).toBe(90);
      expect(parseRotation('360º')).toBe(360);
    });

    it('parses negative rotation', () => {
      expect(parseRotation('-45º')).toBe(-45);
      expect(parseRotation('-90º')).toBe(-90);
    });

    it('parses decimal rotation', () => {
      expect(parseRotation('45.5º')).toBe(45.5);
      expect(parseRotation('-30.25º')).toBe(-30.25);
    });

    it('handles whitespace', () => {
      expect(parseRotation('  30º  ')).toBe(30);
      expect(parseRotation('30 º')).toBe(30);
    });

    it('returns null for invalid input', () => {
      expect(parseRotation('30')).toBeNull(); // No degree symbol
      expect(parseRotation('30deg')).toBeNull();
      expect(parseRotation('thirty degrees')).toBeNull();
      expect(parseRotation('')).toBeNull();
      expect(parseRotation(null as unknown as string)).toBeNull();
    });
  });

  describe('isRotationValue', () => {
    it('returns true for valid rotation values', () => {
      expect(isRotationValue('30º')).toBe(true);
      expect(isRotationValue('-45º')).toBe(true);
      expect(isRotationValue('90.5º')).toBe(true);
    });

    it('returns false for non-rotation values', () => {
      expect(isRotationValue('30')).toBe(false);
      expect(isRotationValue('rotation')).toBe(false);
      expect(isRotationValue('')).toBe(false);
    });
  });

  describe('applyRotation', () => {
    it('applies rotation to a node', () => {
      const rect = createMockRectangle('#Layer');
      rect.rotation = 0;

      const changed = applyRotation(rect as unknown as SceneNode, 45);

      expect(changed).toBe(true);
      expect(rect.rotation).toBe(45);
    });

    it('returns false when rotation unchanged', () => {
      const rect = createMockRectangle('#Layer');
      rect.rotation = 45;

      const changed = applyRotation(rect as unknown as SceneNode, 45);

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Text Alignment Parsing Tests
  // ============================================================================

  describe('parseTextAlign', () => {
    it('parses horizontal alignment', () => {
      expect(parseTextAlign('text-align:left')).toEqual({ horizontal: 'LEFT' });
      expect(parseTextAlign('text-align:center')).toEqual({ horizontal: 'CENTER' });
      expect(parseTextAlign('text-align:right')).toEqual({ horizontal: 'RIGHT' });
      expect(parseTextAlign('text-align:justified')).toEqual({ horizontal: 'JUSTIFIED' });
    });

    it('parses vertical alignment', () => {
      expect(parseTextAlign('text-align-vertical:top')).toEqual({ vertical: 'TOP' });
      expect(parseTextAlign('text-align-vertical:center')).toEqual({ vertical: 'CENTER' });
      expect(parseTextAlign('text-align-vertical:bottom')).toEqual({ vertical: 'BOTTOM' });
    });

    it('is case insensitive', () => {
      expect(parseTextAlign('TEXT-ALIGN:CENTER')).toEqual({ horizontal: 'CENTER' });
      expect(parseTextAlign('Text-Align-Vertical:Bottom')).toEqual({ vertical: 'BOTTOM' });
    });

    it('handles whitespace', () => {
      expect(parseTextAlign('  text-align: center  ')).toEqual({ horizontal: 'CENTER' });
    });

    it('returns null for invalid input', () => {
      expect(parseTextAlign('center')).toBeNull();
      expect(parseTextAlign('align:center')).toBeNull();
      expect(parseTextAlign('')).toBeNull();
      expect(parseTextAlign(null as unknown as string)).toBeNull();
    });
  });

  describe('isTextAlignValue', () => {
    it('returns true for valid text alignment', () => {
      expect(isTextAlignValue('text-align:center')).toBe(true);
      expect(isTextAlignValue('text-align-vertical:bottom')).toBe(true);
    });

    it('returns false for non-alignment values', () => {
      expect(isTextAlignValue('center')).toBe(false);
      expect(isTextAlignValue('')).toBe(false);
    });
  });

  describe('applyTextAlign', () => {
    it('applies horizontal alignment to text node', async () => {
      const text = createMockText('#Layer');
      text.textAlignHorizontal = 'LEFT';

      const changed = await applyTextAlign(text as unknown as TextNode, { horizontal: 'CENTER' });

      expect(changed).toBe(true);
      expect(text.textAlignHorizontal).toBe('CENTER');
    });

    it('applies vertical alignment to text node', async () => {
      const text = createMockText('#Layer');
      text.textAlignVertical = 'TOP';

      const changed = await applyTextAlign(text as unknown as TextNode, { vertical: 'BOTTOM' });

      expect(changed).toBe(true);
      expect(text.textAlignVertical).toBe('BOTTOM');
    });

    it('returns false when alignment unchanged', async () => {
      const text = createMockText('#Layer');
      text.textAlignHorizontal = 'CENTER';

      const changed = await applyTextAlign(text as unknown as TextNode, { horizontal: 'CENTER' });

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Font Size Parsing Tests
  // ============================================================================

  describe('parseFontSize', () => {
    it('parses font size with prefix', () => {
      expect(parseFontSize('font-size:14')).toBe(14);
      expect(parseFontSize('font-size:24')).toBe(24);
    });

    it('parses decimal font sizes', () => {
      expect(parseFontSize('font-size:14.5')).toBe(14.5);
    });

    it('is case insensitive', () => {
      expect(parseFontSize('FONT-SIZE:14')).toBe(14);
      expect(parseFontSize('Font-Size:14')).toBe(14);
    });

    it('handles whitespace', () => {
      expect(parseFontSize('  font-size: 14  ')).toBe(14);
    });

    it('returns null for invalid input', () => {
      expect(parseFontSize('14')).toBeNull();
      expect(parseFontSize('size:14')).toBeNull();
      expect(parseFontSize('')).toBeNull();
      expect(parseFontSize(null as unknown as string)).toBeNull();
    });
  });

  describe('isFontSizeValue', () => {
    it('returns true for valid font size', () => {
      expect(isFontSizeValue('font-size:14')).toBe(true);
      expect(isFontSizeValue('font-size:24.5')).toBe(true);
    });

    it('returns false for non-font-size values', () => {
      expect(isFontSizeValue('14')).toBe(false);
      expect(isFontSizeValue('')).toBe(false);
    });
  });

  describe('applyFontSize', () => {
    it('applies font size to text node', async () => {
      const text = createMockText('#Layer');
      text.fontSize = 12;

      const changed = await applyFontSize(text as unknown as TextNode, 24);

      expect(changed).toBe(true);
      expect(text.fontSize).toBe(24);
    });

    it('returns false when font size unchanged', async () => {
      const text = createMockText('#Layer');
      text.fontSize = 24;

      const changed = await applyFontSize(text as unknown as TextNode, 24);

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Line Height Parsing Tests
  // ============================================================================

  describe('parseLineHeight', () => {
    it('parses auto line height', () => {
      expect(parseLineHeight('line-height:auto')).toEqual({ type: 'AUTO' });
      expect(parseLineHeight('line-height:AUTO')).toEqual({ type: 'AUTO' });
    });

    it('parses pixel line height', () => {
      expect(parseLineHeight('line-height:40')).toEqual({ type: 'PIXELS', value: 40 });
      expect(parseLineHeight('line-height:24.5')).toEqual({ type: 'PIXELS', value: 24.5 });
    });

    it('parses percent line height', () => {
      expect(parseLineHeight('line-height:120%')).toEqual({ type: 'PERCENT', value: 120 });
      expect(parseLineHeight('line-height:150%')).toEqual({ type: 'PERCENT', value: 150 });
    });

    it('is case insensitive', () => {
      expect(parseLineHeight('LINE-HEIGHT:AUTO')).toEqual({ type: 'AUTO' });
    });

    it('handles whitespace', () => {
      expect(parseLineHeight('  line-height: 40  ')).toEqual({ type: 'PIXELS', value: 40 });
    });

    it('returns null for invalid input', () => {
      expect(parseLineHeight('40')).toBeNull();
      expect(parseLineHeight('height:40')).toBeNull();
      expect(parseLineHeight('')).toBeNull();
      expect(parseLineHeight(null as unknown as string)).toBeNull();
    });
  });

  describe('isLineHeightValue', () => {
    it('returns true for valid line height', () => {
      expect(isLineHeightValue('line-height:auto')).toBe(true);
      expect(isLineHeightValue('line-height:40')).toBe(true);
      expect(isLineHeightValue('line-height:120%')).toBe(true);
    });

    it('returns false for non-line-height values', () => {
      expect(isLineHeightValue('40')).toBe(false);
      expect(isLineHeightValue('')).toBe(false);
    });
  });

  describe('applyLineHeight', () => {
    it('applies auto line height', async () => {
      const text = createMockText('#Layer');
      text.lineHeight = { unit: 'PIXELS', value: 40 };

      const changed = await applyLineHeight(text as unknown as TextNode, { type: 'AUTO' });

      expect(changed).toBe(true);
      expect(text.lineHeight).toEqual({ unit: 'AUTO' });
    });

    it('applies pixel line height', async () => {
      const text = createMockText('#Layer');
      text.lineHeight = { unit: 'AUTO' };

      const changed = await applyLineHeight(text as unknown as TextNode, { type: 'PIXELS', value: 40 });

      expect(changed).toBe(true);
      expect(text.lineHeight).toEqual({ unit: 'PIXELS', value: 40 });
    });

    it('applies percent line height', async () => {
      const text = createMockText('#Layer');
      text.lineHeight = { unit: 'AUTO' };

      const changed = await applyLineHeight(text as unknown as TextNode, { type: 'PERCENT', value: 120 });

      expect(changed).toBe(true);
      expect(text.lineHeight).toEqual({ unit: 'PERCENT', value: 120 });
    });

    it('returns false when line height unchanged', async () => {
      const text = createMockText('#Layer');
      text.lineHeight = { unit: 'AUTO' };

      const changed = await applyLineHeight(text as unknown as TextNode, { type: 'AUTO' });

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Letter Spacing Parsing Tests
  // ============================================================================

  describe('parseLetterSpacing', () => {
    it('parses pixel letter spacing', () => {
      expect(parseLetterSpacing('letter-spacing:2')).toEqual({ type: 'PIXELS', value: 2 });
      expect(parseLetterSpacing('letter-spacing:0.5')).toEqual({ type: 'PIXELS', value: 0.5 });
    });

    it('parses negative letter spacing', () => {
      expect(parseLetterSpacing('letter-spacing:-1')).toEqual({ type: 'PIXELS', value: -1 });
    });

    it('parses percent letter spacing', () => {
      expect(parseLetterSpacing('letter-spacing:10%')).toEqual({ type: 'PERCENT', value: 10 });
      expect(parseLetterSpacing('letter-spacing:-5%')).toEqual({ type: 'PERCENT', value: -5 });
    });

    it('is case insensitive', () => {
      expect(parseLetterSpacing('LETTER-SPACING:2')).toEqual({ type: 'PIXELS', value: 2 });
    });

    it('handles whitespace', () => {
      expect(parseLetterSpacing('  letter-spacing: 2  ')).toEqual({ type: 'PIXELS', value: 2 });
    });

    it('returns null for invalid input', () => {
      expect(parseLetterSpacing('2')).toBeNull();
      expect(parseLetterSpacing('spacing:2')).toBeNull();
      expect(parseLetterSpacing('')).toBeNull();
      expect(parseLetterSpacing(null as unknown as string)).toBeNull();
    });
  });

  describe('isLetterSpacingValue', () => {
    it('returns true for valid letter spacing', () => {
      expect(isLetterSpacingValue('letter-spacing:2')).toBe(true);
      expect(isLetterSpacingValue('letter-spacing:10%')).toBe(true);
    });

    it('returns false for non-letter-spacing values', () => {
      expect(isLetterSpacingValue('2')).toBe(false);
      expect(isLetterSpacingValue('')).toBe(false);
    });
  });

  describe('applyLetterSpacing', () => {
    it('applies pixel letter spacing', async () => {
      const text = createMockText('#Layer');
      text.letterSpacing = { unit: 'PIXELS', value: 0 };

      const changed = await applyLetterSpacing(text as unknown as TextNode, { type: 'PIXELS', value: 2 });

      expect(changed).toBe(true);
      expect(text.letterSpacing).toEqual({ unit: 'PIXELS', value: 2 });
    });

    it('applies percent letter spacing', async () => {
      const text = createMockText('#Layer');
      text.letterSpacing = { unit: 'PIXELS', value: 0 };

      const changed = await applyLetterSpacing(text as unknown as TextNode, { type: 'PERCENT', value: 10 });

      expect(changed).toBe(true);
      expect(text.letterSpacing).toEqual({ unit: 'PERCENT', value: 10 });
    });

    it('returns false when letter spacing unchanged', async () => {
      const text = createMockText('#Layer');
      text.letterSpacing = { unit: 'PIXELS', value: 2 };

      const changed = await applyLetterSpacing(text as unknown as TextNode, { type: 'PIXELS', value: 2 });

      expect(changed).toBe(false);
    });
  });

  // ============================================================================
  // Prefix Handling Tests
  // ============================================================================

  describe('stripPrefix', () => {
    it('removes leading slash', () => {
      expect(stripPrefix('/hide')).toBe('hide');
      expect(stripPrefix('/#FF0000')).toBe('#FF0000');
    });

    it('handles whitespace', () => {
      expect(stripPrefix('  /hide  ')).toBe('hide');
    });

    it('returns value unchanged if no prefix', () => {
      expect(stripPrefix('hide')).toBe('hide');
      expect(stripPrefix('#FF0000')).toBe('#FF0000');
    });

    it('handles empty/null input', () => {
      expect(stripPrefix('')).toBe('');
      expect(stripPrefix(null as unknown as string)).toBe('');
      expect(stripPrefix(undefined as unknown as string)).toBe('');
    });
  });

  describe('hasSpecialPrefix', () => {
    it('returns true for values with / prefix', () => {
      expect(hasSpecialPrefix('/hide')).toBe(true);
      expect(hasSpecialPrefix('/#FF0000')).toBe(true);
      expect(hasSpecialPrefix('  /show  ')).toBe(true);
    });

    it('returns false for values without / prefix', () => {
      expect(hasSpecialPrefix('hide')).toBe(false);
      expect(hasSpecialPrefix('#FF0000')).toBe(false);
      expect(hasSpecialPrefix('')).toBe(false);
    });
  });

  describe('isSpecialDataType', () => {
    it('recognizes visibility values', () => {
      expect(isSpecialDataType('show')).toBe(true);
      expect(isSpecialDataType('hide')).toBe(true);
      expect(isSpecialDataType('/show')).toBe(true);
      expect(isSpecialDataType('/hide')).toBe(true);
    });

    it('recognizes color values', () => {
      expect(isSpecialDataType('#FF0000')).toBe(true);
      expect(isSpecialDataType('/#FF0000')).toBe(true);
      expect(isSpecialDataType('#F00')).toBe(true);
    });

    it('recognizes opacity values', () => {
      expect(isSpecialDataType('50%')).toBe(true);
      expect(isSpecialDataType('/50%')).toBe(true);
      expect(isSpecialDataType('100%')).toBe(true);
    });

    it('recognizes dimension values', () => {
      expect(isSpecialDataType('100s')).toBe(true);
      expect(isSpecialDataType('200w')).toBe(true);
      expect(isSpecialDataType('150h')).toBe(true);
      expect(isSpecialDataType('/100w')).toBe(true);
    });

    it('recognizes position values', () => {
      expect(isSpecialDataType('20x')).toBe(true);
      expect(isSpecialDataType('40y')).toBe(true);
      expect(isSpecialDataType('20xx')).toBe(true);
      expect(isSpecialDataType('40yy')).toBe(true);
      expect(isSpecialDataType('/50x')).toBe(true);
    });

    it('recognizes rotation values', () => {
      expect(isSpecialDataType('30º')).toBe(true);
      expect(isSpecialDataType('-45º')).toBe(true);
      expect(isSpecialDataType('/90º')).toBe(true);
    });

    it('recognizes text alignment values', () => {
      expect(isSpecialDataType('text-align:center')).toBe(true);
      expect(isSpecialDataType('text-align-vertical:bottom')).toBe(true);
      expect(isSpecialDataType('/text-align:left')).toBe(true);
    });

    it('recognizes font size values', () => {
      expect(isSpecialDataType('font-size:14')).toBe(true);
      expect(isSpecialDataType('/font-size:24')).toBe(true);
    });

    it('recognizes line height values', () => {
      expect(isSpecialDataType('line-height:auto')).toBe(true);
      expect(isSpecialDataType('line-height:40')).toBe(true);
      expect(isSpecialDataType('line-height:120%')).toBe(true);
      expect(isSpecialDataType('/line-height:auto')).toBe(true);
    });

    it('recognizes letter spacing values', () => {
      expect(isSpecialDataType('letter-spacing:2')).toBe(true);
      expect(isSpecialDataType('letter-spacing:10%')).toBe(true);
      expect(isSpecialDataType('/letter-spacing:2')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(isSpecialDataType('Hello World')).toBe(false);
      expect(isSpecialDataType('Product Name')).toBe(false);
    });

    it('respects stripLeadingSlash option', () => {
      expect(isSpecialDataType('/hide', true)).toBe(true);
      expect(isSpecialDataType('/hide', false)).toBe(false);
    });
  });

  describe('requiresSpecialPrefix', () => {
    it('returns true for TEXT and INSTANCE', () => {
      expect(requiresSpecialPrefix('TEXT')).toBe(true);
      expect(requiresSpecialPrefix('INSTANCE')).toBe(true);
    });

    it('returns false for other types', () => {
      expect(requiresSpecialPrefix('FRAME')).toBe(false);
      expect(requiresSpecialPrefix('RECTANGLE')).toBe(false);
      expect(requiresSpecialPrefix('GROUP')).toBe(false);
    });
  });

  // ============================================================================
  // Special Data Type Application Tests
  // ============================================================================

  describe('applySpecialDataType', () => {
    it('applies visibility to a node', async () => {
      const rect = createMockRectangle('#Layer');
      rect.visible = true;

      const result = await applySpecialDataType(rect as unknown as SceneNode, 'hide');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('visibility');
      expect(rect.visible).toBe(false);
    });

    it('applies color to a node', async () => {
      const rect = createMockRectangle('#Layer') as unknown as MockRectangleNode;

      const result = await applySpecialDataType(rect as unknown as SceneNode, '#FF0000');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('color');
      expect(rect.fills[0].type).toBe('SOLID');
    });

    it('handles prefixed values when requiresPrefix is true', async () => {
      const text = createMockText('#Layer');
      text.visible = true;

      const result = await applySpecialDataType(text as unknown as SceneNode, '/hide', { requiresPrefix: true });

      expect(result.handled).toBe(true);
      expect(text.visible).toBe(false);
    });

    it('ignores non-prefixed values when requiresPrefix is true', async () => {
      const text = createMockText('#Layer');
      text.visible = true;

      const result = await applySpecialDataType(text as unknown as SceneNode, 'hide', { requiresPrefix: true });

      expect(result.handled).toBe(false);
      expect(text.visible).toBe(true); // Unchanged
    });

    it('returns not handled for regular text', async () => {
      const rect = createMockRectangle('#Layer');

      const result = await applySpecialDataType(rect as unknown as SceneNode, 'Hello World');

      expect(result.handled).toBe(false);
      expect(result.appliedTypes).toHaveLength(0);
    });

    it('returns not handled for empty value', async () => {
      const rect = createMockRectangle('#Layer');

      const result = await applySpecialDataType(rect as unknown as SceneNode, '');

      expect(result.handled).toBe(false);
    });

    it('adds warning when color applied to node without fills', async () => {
      const text = createMockText('#Layer');

      const result = await applySpecialDataType(text as unknown as SceneNode, '#FF0000');

      expect(result.handled).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('may not support fills');
    });

    it('prioritizes visibility over color', async () => {
      // "show" is not a valid color, but test the order
      const rect = createMockRectangle('#Layer');
      rect.visible = false;

      const result = await applySpecialDataType(rect as unknown as SceneNode, 'show');

      expect(result.appliedTypes).toContain('visibility');
      expect(result.appliedTypes).not.toContain('color');
    });

    it('applies opacity to a node', async () => {
      const rect = createMockRectangle('#Layer');
      rect.opacity = 1;

      const result = await applySpecialDataType(rect as unknown as SceneNode, '50%');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('opacity');
      expect(rect.opacity).toBe(0.5);
    });

    it('applies dimension to a node', async () => {
      const rect = createMockRectangle('#Layer');
      rect.width = 50;
      rect.height = 50;

      const result = await applySpecialDataType(rect as unknown as SceneNode, '200w');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('dimension');
      expect(rect.width).toBe(200);
    });

    it('applies position to a node', async () => {
      const rect = createMockRectangle('#Layer');
      rect.x = 0;
      rect.y = 0;

      const result = await applySpecialDataType(rect as unknown as SceneNode, '50x');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('position');
      expect(rect.x).toBe(50);
    });

    it('handles prefixed opacity for text layers', async () => {
      const text = createMockText('#Layer');
      text.opacity = 1;

      const result = await applySpecialDataType(text as unknown as SceneNode, '/50%', { requiresPrefix: true });

      expect(result.handled).toBe(true);
      expect(text.opacity).toBe(0.5);
    });

    it('applies rotation to a node', async () => {
      const rect = createMockRectangle('#Layer');
      rect.rotation = 0;

      const result = await applySpecialDataType(rect as unknown as SceneNode, '45º');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('rotation');
      expect(rect.rotation).toBe(45);
    });

    it('applies text alignment to text nodes', async () => {
      const text = createMockText('#Layer');
      text.textAlignHorizontal = 'LEFT';

      const result = await applySpecialDataType(text as unknown as SceneNode, 'text-align:center');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('textAlign');
      expect(text.textAlignHorizontal).toBe('CENTER');
    });

    it('applies font size to text nodes', async () => {
      const text = createMockText('#Layer');
      text.fontSize = 12;

      const result = await applySpecialDataType(text as unknown as SceneNode, 'font-size:24');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('fontSize');
      expect(text.fontSize).toBe(24);
    });

    it('applies line height to text nodes', async () => {
      const text = createMockText('#Layer');
      text.lineHeight = { unit: 'AUTO' };

      const result = await applySpecialDataType(text as unknown as SceneNode, 'line-height:40');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('lineHeight');
      expect(text.lineHeight).toEqual({ unit: 'PIXELS', value: 40 });
    });

    it('applies letter spacing to text nodes', async () => {
      const text = createMockText('#Layer');
      text.letterSpacing = { unit: 'PIXELS', value: 0 };

      const result = await applySpecialDataType(text as unknown as SceneNode, 'letter-spacing:2');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('letterSpacing');
      expect(text.letterSpacing).toEqual({ unit: 'PIXELS', value: 2 });
    });

    it('does not apply text properties to non-text nodes', async () => {
      const rect = createMockRectangle('#Layer');

      const result = await applySpecialDataType(rect as unknown as SceneNode, 'text-align:center');

      expect(result.handled).toBe(false);
    });
  });

  // ============================================================================
  // Batch Processing Tests
  // ============================================================================

  describe('batchApplySpecialTypes', () => {
    it('processes multiple entries', async () => {
      const rect1 = createMockRectangle('#Layer1');
      const rect2 = createMockRectangle('#Layer2');
      rect1.visible = true;
      rect2.visible = true;

      const entries = [
        { node: rect1 as unknown as SceneNode, value: 'hide' },
        { node: rect2 as unknown as SceneNode, value: '#FF0000' },
      ];

      const result = await batchApplySpecialTypes(entries);

      expect(result.totalProcessed).toBe(2);
      expect(result.handledCount).toBe(2);
      expect(result.typesCounts.get('visibility')).toBe(1);
      expect(result.typesCounts.get('color')).toBe(1);
    });

    it('counts unhandled entries', async () => {
      const rect1 = createMockRectangle('#Layer1');
      const rect2 = createMockRectangle('#Layer2');

      const entries = [
        { node: rect1 as unknown as SceneNode, value: 'hide' },
        { node: rect2 as unknown as SceneNode, value: 'Hello World' }, // Not a special type
      ];

      const result = await batchApplySpecialTypes(entries);

      expect(result.totalProcessed).toBe(2);
      expect(result.handledCount).toBe(1);
      expect(result.unhandledCount).toBe(1);
    });

    it('handles requiresPrefix for text layers', async () => {
      const text = createMockText('#Layer');
      text.visible = true;

      const entries = [
        { node: text as unknown as SceneNode, value: 'hide', requiresPrefix: true }, // Should not apply
      ];

      const result = await batchApplySpecialTypes(entries);

      expect(result.handledCount).toBe(0);
      expect(result.unhandledCount).toBe(1);
    });

    it('handles empty batch', async () => {
      const result = await batchApplySpecialTypes([]);

      expect(result.totalProcessed).toBe(0);
      expect(result.handledCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('collects all warnings', async () => {
      const text1 = createMockText('#T1');
      const text2 = createMockText('#T2');

      const entries = [
        { node: text1 as unknown as SceneNode, value: '#FF0000' },
        { node: text2 as unknown as SceneNode, value: '#00FF00' },
      ];

      const result = await batchApplySpecialTypes(entries);

      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // Utility Tests
  // ============================================================================

  describe('describeColor', () => {
    it('formats color as RGB string', () => {
      expect(describeColor({ r: 1, g: 0, b: 0 })).toBe('RGB(255, 0, 0)');
      expect(describeColor({ r: 0, g: 1, b: 0 })).toBe('RGB(0, 255, 0)');
      expect(describeColor({ r: 0.5, g: 0.5, b: 0.5 })).toBe('RGB(128, 128, 128)');
    });
  });

  // ============================================================================
  // Chained Special Types Tests
  // ============================================================================

  describe('tokenizeChainedValue', () => {
    it('tokenizes comma-separated values', () => {
      const tokens = tokenizeChainedValue('50%, #F00, 30º');
      expect(tokens).toEqual(['50%', '#F00', '30º']);
    });

    it('tokenizes space-separated values', () => {
      const tokens = tokenizeChainedValue('50% #F00 30º');
      expect(tokens).toEqual(['50%', '#F00', '30º']);
    });

    it('tokenizes mixed comma and space separation', () => {
      const tokens = tokenizeChainedValue('50%, #F00 30º');
      expect(tokens).toEqual(['50%', '#F00', '30º']);
    });

    it('keeps property:value pairs together', () => {
      const tokens = tokenizeChainedValue('text-align:center 50%');
      expect(tokens).toEqual(['text-align:center', '50%']);
    });

    it('rejoins property and value if split by space', () => {
      const tokens = tokenizeChainedValue('text-align: center 50%');
      expect(tokens).toEqual(['text-align:center', '50%']);
    });

    it('handles empty string', () => {
      expect(tokenizeChainedValue('')).toEqual([]);
    });

    it('handles null/undefined', () => {
      expect(tokenizeChainedValue(null as unknown as string)).toEqual([]);
      expect(tokenizeChainedValue(undefined as unknown as string)).toEqual([]);
    });

    it('handles single value', () => {
      expect(tokenizeChainedValue('50%')).toEqual(['50%']);
    });

    it('handles extra whitespace', () => {
      const tokens = tokenizeChainedValue('  50%  ,  #F00  ');
      expect(tokens).toEqual(['50%', '#F00']);
    });
  });

  describe('isChainedSpecialType', () => {
    it('returns true for multiple special types', () => {
      expect(isChainedSpecialType('50%, #F00')).toBe(true);
      expect(isChainedSpecialType('show, 50%')).toBe(true);
      expect(isChainedSpecialType('30º 100w')).toBe(true);
    });

    it('returns false for single special type', () => {
      expect(isChainedSpecialType('50%')).toBe(false);
      expect(isChainedSpecialType('#FF0000')).toBe(false);
    });

    it('returns false for non-special types', () => {
      expect(isChainedSpecialType('hello world')).toBe(false);
      expect(isChainedSpecialType('some text')).toBe(false);
    });

    it('returns false for empty/null values', () => {
      expect(isChainedSpecialType('')).toBe(false);
      expect(isChainedSpecialType(null as unknown as string)).toBe(false);
    });

    it('handles prefix', () => {
      expect(isChainedSpecialType('/50%, #F00')).toBe(true);
    });
  });

  describe('parseChainedSpecialTypes', () => {
    it('parses multiple comma-separated types', () => {
      const result = parseChainedSpecialTypes('50%, #F00, 30º');
      expect(result.opacity).toBe(0.5);
      expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
      expect(result.rotation).toBe(30);
    });

    it('parses multiple space-separated types', () => {
      const result = parseChainedSpecialTypes('50% #F00 30º');
      expect(result.opacity).toBe(0.5);
      expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
      expect(result.rotation).toBe(30);
    });

    it('parses visibility', () => {
      const result = parseChainedSpecialTypes('hide, 50%');
      expect(result.visibility).toBe('hide');
      expect(result.opacity).toBe(0.5);
    });

    it('parses dimension', () => {
      const result = parseChainedSpecialTypes('100w, #F00');
      expect(result.dimension).toEqual({ type: 'width', value: 100 });
      expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('parses position', () => {
      const result = parseChainedSpecialTypes('20x, 50%');
      expect(result.position).toEqual({ type: 'relative', axis: 'x', value: 20 });
      expect(result.opacity).toBe(0.5);
    });

    it('parses text alignment', () => {
      const result = parseChainedSpecialTypes('text-align:center, font-size:14');
      expect(result.textAlign).toEqual({ horizontal: 'CENTER' });
      expect(result.fontSize).toBe(14);
    });

    it('merges multiple text alignments', () => {
      const result = parseChainedSpecialTypes('text-align:center, text-align-vertical:bottom');
      expect(result.textAlign).toEqual({ horizontal: 'CENTER', vertical: 'BOTTOM' });
    });

    it('parses line height', () => {
      const result = parseChainedSpecialTypes('line-height:40, 50%');
      expect(result.lineHeight).toEqual({ type: 'PIXELS', value: 40 });
      expect(result.opacity).toBe(0.5);
    });

    it('parses letter spacing', () => {
      const result = parseChainedSpecialTypes('letter-spacing:2, 50%');
      expect(result.letterSpacing).toEqual({ type: 'PIXELS', value: 2 });
      expect(result.opacity).toBe(0.5);
    });

    it('later values override earlier for same type', () => {
      const result = parseChainedSpecialTypes('#F00, #0F0');
      expect(result.color).toEqual({ r: 0, g: 1, b: 0 }); // Green wins
    });

    it('handles prefix', () => {
      const result = parseChainedSpecialTypes('/50%, #F00');
      expect(result.opacity).toBe(0.5);
      expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
    });

    it('returns empty object for empty string', () => {
      const result = parseChainedSpecialTypes('');
      expect(hasAnyParsedType(result)).toBe(false);
    });

    it('ignores invalid tokens', () => {
      const result = parseChainedSpecialTypes('50%, invalid, #F00');
      expect(result.opacity).toBe(0.5);
      expect(result.color).toEqual({ r: 1, g: 0, b: 0 });
    });
  });

  describe('hasAnyParsedType', () => {
    it('returns true when any type is set', () => {
      expect(hasAnyParsedType({ opacity: 0.5 })).toBe(true);
      expect(hasAnyParsedType({ visibility: 'show' })).toBe(true);
      expect(hasAnyParsedType({ color: { r: 1, g: 0, b: 0 } })).toBe(true);
    });

    it('returns false for empty object', () => {
      expect(hasAnyParsedType({})).toBe(false);
    });
  });

  describe('countParsedTypes', () => {
    it('counts parsed types', () => {
      expect(countParsedTypes({})).toBe(0);
      expect(countParsedTypes({ opacity: 0.5 })).toBe(1);
      expect(countParsedTypes({ opacity: 0.5, color: { r: 1, g: 0, b: 0 } })).toBe(2);
      expect(countParsedTypes({
        opacity: 0.5,
        color: { r: 1, g: 0, b: 0 },
        rotation: 30
      })).toBe(3);
    });
  });

  describe('applyChainedSpecialTypes', () => {
    it('applies multiple types to a node', async () => {
      const rect = createMockRectangle('Rect', { width: 50, height: 50, opacity: 1 });
      const parsed = parseChainedSpecialTypes('50%, #F00, 30º');

      const result = await applyChainedSpecialTypes(rect as unknown as SceneNode, parsed);

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('opacity');
      expect(result.appliedTypes).toContain('color');
      expect(result.appliedTypes).toContain('rotation');
      expect(rect.opacity).toBe(0.5);
      expect(rect.rotation).toBe(30);
    });

    it('applies visibility', async () => {
      const rect = createMockRectangle('Rect');
      const parsed = parseChainedSpecialTypes('hide, 50%');

      await applyChainedSpecialTypes(rect as unknown as SceneNode, parsed);

      expect(rect.visible).toBe(false);
      expect(rect.opacity).toBe(0.5);
    });

    it('applies dimension', async () => {
      const rect = createMockRectangle('Rect', { width: 50, height: 50 });
      const parsed = parseChainedSpecialTypes('100w, 50%');

      await applyChainedSpecialTypes(rect as unknown as SceneNode, parsed);

      expect(rect.width).toBe(100);
      expect(rect.opacity).toBe(0.5);
    });

    it('applies position', async () => {
      const rect = createMockRectangle('Rect', { x: 0, y: 0 });
      const parsed = parseChainedSpecialTypes('20x, 50%');

      await applyChainedSpecialTypes(rect as unknown as SceneNode, parsed);

      expect(rect.x).toBe(20);
      expect(rect.opacity).toBe(0.5);
    });

    it('applies text properties to text nodes', async () => {
      const text = createMockText('Text');
      const parsed = parseChainedSpecialTypes('text-align:center, font-size:20');

      const result = await applyChainedSpecialTypes(text as unknown as SceneNode, parsed);

      expect(result.appliedTypes).toContain('textAlign');
      expect(result.appliedTypes).toContain('fontSize');
      expect(text.textAlignHorizontal).toBe('CENTER');
      expect(text.fontSize).toBe(20);
    });

    it('ignores text properties on non-text nodes with warning', async () => {
      const rect = createMockRectangle('Rect');
      const parsed = parseChainedSpecialTypes('text-align:center, 50%');

      const result = await applyChainedSpecialTypes(rect as unknown as SceneNode, parsed);

      expect(result.appliedTypes).toContain('opacity');
      expect(result.appliedTypes).not.toContain('textAlign');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('returns empty result for empty parsed value', async () => {
      const rect = createMockRectangle('Rect');
      const result = await applyChainedSpecialTypes(rect as unknown as SceneNode, {});

      expect(result.handled).toBe(false);
      expect(result.appliedTypes).toEqual([]);
    });
  });

  describe('applySpecialDataType with chained values', () => {
    it('applies chained types through main dispatcher', async () => {
      const rect = createMockRectangle('Rect', { width: 50, height: 50, opacity: 1 });

      const result = await applySpecialDataType(rect as unknown as SceneNode, '50%, #F00, 30º');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('opacity');
      expect(result.appliedTypes).toContain('color');
      expect(result.appliedTypes).toContain('rotation');
    });

    it('handles prefix for text nodes with chained values', async () => {
      const text = createMockText('Text');

      const result = await applySpecialDataType(
        text as unknown as SceneNode,
        '/text-align:center, font-size:20',
        { requiresPrefix: true }
      );

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toContain('textAlign');
      expect(result.appliedTypes).toContain('fontSize');
    });

    it('still handles single values normally', async () => {
      const rect = createMockRectangle('Rect', { opacity: 1 });

      const result = await applySpecialDataType(rect as unknown as SceneNode, '50%');

      expect(result.handled).toBe(true);
      expect(result.appliedTypes).toEqual(['opacity']);
    });
  });

  describe('isSpecialDataType with chained values', () => {
    it('returns true for chained special types', () => {
      expect(isSpecialDataType('50%, #F00')).toBe(true);
      expect(isSpecialDataType('show, 30º')).toBe(true);
    });

    it('returns true for single special types', () => {
      expect(isSpecialDataType('50%')).toBe(true);
      expect(isSpecialDataType('#F00')).toBe(true);
    });

    it('returns false for non-special types', () => {
      expect(isSpecialDataType('hello world')).toBe(false);
    });

    it('handles prefix', () => {
      expect(isSpecialDataType('/50%, #F00')).toBe(true);
    });
  });
});
