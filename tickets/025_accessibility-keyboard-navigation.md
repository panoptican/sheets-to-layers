## TICKET-025: Accessibility & Keyboard Navigation

**Type:** Enhancement  
**Priority:** Low  

### Description

Ensure the plugin UI is accessible and supports keyboard navigation following WCAG guidelines.

### Requirements

- All interactive elements are keyboard accessible
- Focus states are visible
- Screen reader compatible labels
- Sufficient color contrast
- Error messages are announced
- Tab order is logical

### Technical Specifications

**Focus Management:**

```css
/* Visible focus states */
button:focus-visible,
input:focus-visible,
[role="tab"]:focus-visible {
  outline: 2px solid #18A0FB;
  outline-offset: 2px;
}

/* Don't show focus for mouse users */
button:focus:not(:focus-visible) {
  outline: none;
}
```

**ARIA Labels:**

```html
<section aria-labelledby="url-label">
  <label id="url-label" for="sheets-url">Google Sheets URL</label>
  <input 
    type="url" 
    id="sheets-url" 
    aria-describedby="url-help"
    aria-invalid="false"
  />
  <p id="url-help" class="help-text">
    Make sure your sheet is set to "Anyone with the link can view"
  </p>
</section>

<div role="alert" aria-live="polite" id="error-region">
  <!-- Error messages appear here -->
</div>
```

**Keyboard Navigation:**

```typescript
function handleKeyDown(event: KeyboardEvent): void {
  const { key } = event;
  
  switch (key) {
    case 'Enter':
      // Submit form
      break;
    case 'Escape':
      // Close plugin or cancel operation
      parent.postMessage({ type: 'CLOSE' }, '*');
      break;
    case 'Tab':
      // Let default tab behavior work
      break;
  }
}

// For worksheet tabs
function handleTabKeyDown(event: KeyboardEvent, tabs: string[], activeIndex: number): void {
  let newIndex = activeIndex;
  
  switch (event.key) {
    case 'ArrowLeft':
      newIndex = Math.max(0, activeIndex - 1);
      break;
    case 'ArrowRight':
      newIndex = Math.min(tabs.length - 1, activeIndex + 1);
      break;
    case 'Home':
      newIndex = 0;
      break;
    case 'End':
      newIndex = tabs.length - 1;
      break;
  }
  
  if (newIndex !== activeIndex) {
    event.preventDefault();
    setActiveTab(tabs[newIndex]);
  }
}
```

**Color Contrast:**

```css
/* Ensure 4.5:1 contrast ratio for text */
.help-text {
  color: #666666; /* 5.74:1 on white */
}

.error-message {
  color: #D32F2F; /* 5.55:1 on white */
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .help-text {
    color: #333333;
  }
}
```

### Dependencies

TICKET-017, TICKET-018

### Acceptance Criteria

- [ ] All buttons/inputs reachable via Tab key
- [ ] Focus states are clearly visible
- [ ] Screen reader announces form labels and errors
- [ ] Color contrast meets WCAG AA (4.5:1)
- [ ] Worksheet tabs navigable with arrow keys
- [ ] Escape key closes plugin
- [ ] Error region uses aria-live for announcements