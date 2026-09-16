import { h, type ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  Button as FigmaButton,
  Dropdown as FigmaDropdown,
  IconButton as FigmaIconButton,
  IconClose24,
  Modal as FigmaModal,
} from '@create-figma-plugin/ui';
import type { InterpretationPreferences } from '../core/types';
import {
  state,
  worksheet,
  copyPrefs,
  closePreviewSettings,
  savePreviewSettings,
} from './controller';

export function SettingsDialog(props: {
  initialPreferences: InterpretationPreferences;
}): ComponentChild {
  const w = worksheet();
  const [draft, setDraft] = useState(() => copyPrefs(props.initialPreferences));
  const defaultWorksheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => defaultWorksheetRef.current?.focus(), []);
  const defaultOptions = (state.data?.worksheets || []).map((sheet) => ({
    value: sheet.name,
    text: sheet.name,
  }));
  const orientationValue = w
    ? draft.orientations[w.id || w.name] || w.orientation
    : 'columns';
  const content = h(
    'div',
    { className: 'settings-dialog' },
    h(
      'div',
      { className: 'settings-dialog-header' },
      h('h2', { id: 'preview-settings-title' }, 'Data settings'),
      h(FigmaIconButton, {
        id: 'preview-settings-close-btn',
        title: 'Close data settings',
        'aria-label': 'Close data settings',
        onClick: closePreviewSettings,
        children: h(IconClose24, null),
      }),
    ),
    h(
      'p',
      { className: 'settings-dialog-description' },
      'Choose how this spreadsheet is interpreted when you preview and sync it.',
    ),
    h(
      'div',
      { className: 'settings-fields' },
      h(
        'div',
        { className: 'settings-field' },
        h(
          'div',
          { className: 'field-label', id: 'default-worksheet-label' },
          'Default worksheet',
        ),
        h(FigmaDropdown, {
          id: 'default-worksheet',
          ref: defaultWorksheetRef,
          value: draft.defaultWorksheet || state.data?.activeWorksheet || null,
          options: defaultOptions,
          'aria-labelledby': 'default-worksheet-label',
          onValueChange: (value: string) =>
            setDraft({ ...draft, defaultWorksheet: value }),
        }),
      ),
      h(
        'div',
        { className: 'settings-field' },
        h(
          'div',
          { className: 'field-label', id: 'orientation-select-label' },
          `Data orientation${w ? ` · ${w.name}` : ''}`,
        ),
        h(FigmaDropdown, {
          id: 'orientation-select',
          value: orientationValue,
          options: [
            { value: 'columns', text: 'Headers in first row' },
            { value: 'rows', text: 'Headers in first column' },
          ],
          'aria-labelledby': 'orientation-select-label',
          onValueChange: (value: string) => {
            if (!w) return;
            setDraft({
              ...draft,
              orientations: {
                ...draft.orientations,
                [w.id || w.name]: value as 'columns' | 'rows',
              },
            });
          },
        }),
      ),
      h(
        'div',
        { className: 'settings-field' },
        h(
          'div',
          { className: 'field-label', id: 'blank-text-policy-label' },
          'Blank text',
        ),
        h(FigmaDropdown, {
          id: 'blank-text-policy',
          value: draft.blankText,
          options: [
            {
              value: 'clear-and-hide',
              text: 'Clear and hide blank text',
            },
            {
              value: 'leave-unchanged',
              text: 'Leave blank text unchanged',
            },
          ],
          'aria-labelledby': 'blank-text-policy-label',
          onValueChange: (value: string) =>
            setDraft({
              ...draft,
              blankText: value as InterpretationPreferences['blankText'],
            }),
        }),
      ),
    ),
    h(
      'div',
      { className: 'settings-dialog-actions' },
      h(FigmaButton, {
        id: 'preview-settings-cancel-btn',
        secondary: true,
        onClick: closePreviewSettings,
        children: 'Cancel',
      }),
      h(FigmaButton, {
        id: 'preview-settings-save-btn',
        onClick: () => savePreviewSettings(draft),
        children: 'Save settings',
      }),
    ),
  );
  return h(FigmaModal, {
    id: 'preview-settings-dialog',
    open: true,
    transition: false,
    position: 'center',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'preview-settings-title',
    onEscapeKeyDown: closePreviewSettings,
    onOverlayClick: closePreviewSettings,
    children: content,
  });
}
