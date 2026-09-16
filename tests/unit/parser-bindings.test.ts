import { describe, it, expect } from 'vitest';
import {
  parseLayerName,
  serializeLayerName,
  updateLayerBinding,
} from '../../src/core/parser';

describe('quoted binding grammar', () => {
  it('parses quoted labels and worksheets with escaped characters', () => {
    const result = parseLayerName(
      '// "Q1 / East \\"quoted\\"" #"First Name" #"Price / USD".2',
    );

    expect(result.worksheet).toBe('Q1 / East "quoted"');
    expect(result.labels).toEqual(['First Name', 'Price / USD']);
    expect(result.index).toEqual({ type: 'specific', value: 2 });
  });

  it('round-trips complex bindings and keeps the index last', () => {
    const input = {
      hasBinding: true,
      labels: ['First Name', 'Price / USD', 'Simple_Label'],
      worksheet: 'Q1 / East "quoted"',
      index: { type: 'incrementNonBlank' as const },
      isIgnored: false,
      forceInclude: true,
      isRepeatFrame: true,
    };

    const serialized = serializeLayerName(input);

    expect(serialized).toBe(
      '+@# // "Q1 / East \\"quoted\\"" #"First Name" #"Price / USD" #Simple_Label.i',
    );
    expect(parseLayerName(serialized)).toEqual(input);
  });

  it('keeps simple bindings in the established grammar', () => {
    expect(
      serializeLayerName({
        hasBinding: true,
        labels: ['Title'],
        worksheet: 'Products',
        index: { type: 'specific', value: 3 },
        isIgnored: false,
        forceInclude: false,
        isRepeatFrame: false,
      }),
    ).toBe('// Products #Title.3');
  });

  it('updates structured edits without losing the display name or existing index', () => {
    expect(
      updateLayerBinding('Product card // Products #Title.3', {
        type: 'worksheet',
        worksheet: 'Q1 / East',
      }),
    ).toBe('Product card // "Q1 / East" #Title.3');

    expect(
      updateLayerBinding('Product card // Products #Title.3', {
        type: 'label',
        label: 'First Name',
        row: 4,
      }),
    ).toBe('Product card // Products #"First Name".4');
  });

  it('treats parser controls inside quoted tokens as literal content', () => {
    const result = parseLayerName(
      'Card #"A // # @# \\\\ \\"quoted\\" .2" // "East # @# \\\\ \\".2" #Title.3',
    );

    expect(result).toMatchObject({
      labels: ['A // # @# \\ "quoted" .2', 'Title'],
      worksheet: 'East # @# \\ ".2',
      index: { type: 'specific', value: 3 },
      isRepeatFrame: false,
    });
  });

  it('does not find a worksheet or index inside a quoted label', () => {
    const result = parseLayerName('Card #"A // East.2 # @#"');

    expect(result.labels).toEqual(['A // East.2 # @#']);
    expect(result.worksheet).toBeUndefined();
    expect(result.index).toBeUndefined();
    expect(result.isRepeatFrame).toBe(false);
  });

  it('keeps force include first when updating a display-prefixed name', () => {
    expect(
      updateLayerBinding('+Card #Title', {
        type: 'worksheet',
        worksheet: 'Products',
      }),
    ).toBe('+Card // Products #Title');
  });

  it('preserves escaped literal controls in the display name during edits', () => {
    const name = 'Card \\#notBinding \\/\\/notWorksheet \\@# #Title.2';

    expect(
      updateLayerBinding(name, {
        type: 'worksheet',
        worksheet: 'Products',
      }),
    ).toBe('Card \\#notBinding \\/\\/notWorksheet \\@# // Products #Title.2');
  });
});
