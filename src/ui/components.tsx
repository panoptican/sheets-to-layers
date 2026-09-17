import type { ComponentChildren, ComponentProps } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Button, IconButton as FigmaIconButton } from '@create-figma-plugin/ui';
import { openPreviewSettings, state } from './controller';

export function ActionButton({
  primary = false,
  ...props
}: ComponentProps<typeof Button> & { primary?: boolean }) {
  return <Button secondary={!primary} {...props} />;
}

export function IconButton({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof FigmaIconButton>, 'children'> & {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <FigmaIconButton title={label} aria-label={label} {...props}>
      {children}
    </FigmaIconButton>
  );
}

export function SettingsButton() {
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const open = state.previewSettings !== null;
  useLayoutEffect(() => {
    if (wasOpen.current && !open) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <Button
      id="preview-settings-btn"
      secondary
      ref={button}
      onClick={openPreviewSettings}
    >
      Settings
    </Button>
  );
}

export function Notice({ message }: { message: string }) {
  return (
    <section className="error-display" role="alert">
      <p className="error-message">{message}</p>
    </section>
  );
}

export function LiveRegion() {
  return (
    <div
      id="live-region"
      className="live-region"
      role="status"
      aria-live="polite"
    />
  );
}
