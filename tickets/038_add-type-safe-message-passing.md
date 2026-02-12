## TICKET-038: Add Type-Safe Message Passing Protocol

**Type:** Architecture Improvement
**Priority:** Medium
**Status:** Open
**Complexity:** Medium
**Estimated Effort:** 4-6 hours

### Description

Message passing between UI and plugin threads uses manual runtime type checking that doesn't catch type mismatches at compile time. This is error-prone and can lead to runtime errors from invalid message shapes.

### Current Issues

```typescript
// messages.ts - manual type guards
if (!isUIMessage(msg)) {
  console.warn('Received invalid message from UI:', msg);
  return;
}

// Runtime validation catches errors too late
// No compile-time safety for payload shapes
// Easy to send wrong message type
```

### Proposed Solution

**Option 1: Use zod for runtime validation + type inference**

```typescript
import { z } from 'zod';

const SyncStartMessageSchema = z.object({
  type: z.literal('SYNC_START'),
  payload: z.object({
    url: z.string(),
    scope: z.enum(['page', 'selection'])
  })
});

type SyncStartMessage = z.infer<typeof SyncStartMessageSchema>;

// Validate at runtime with type safety
function handleMessage(msg: unknown) {
  const result = SyncStartMessageSchema.safeParse(msg);
  if (result.success) {
    // result.data is typed as SyncStartMessage
    handleSyncStart(result.data.payload);
  }
}
```

**Option 2: Use RPC library**

```typescript
import { createRPC } from '@figma/plugin-rpc';

const rpc = createRPC({
  syncStart: async (options: SyncOptions) => {
    // Type-safe method call
    return await runSync(options);
  },
  fetchImage: async (url: string) => {
    return await fetchImageData(url);
  }
});

// In UI thread:
const result = await rpc.syncStart({ url, scope: 'page' });
// Fully type-safe!
```

**Recommendation:** Option 2 if library available, otherwise Option 1.

### Benefits

- **Type Safety:** Catch errors at compile time
- **Auto-complete:** IDE suggests valid message shapes
- **Validation:** Runtime checks match types
- **Refactoring:** Rename/change propagates automatically
- **Documentation:** Types serve as docs

### Acceptance Criteria

- [ ] Type-safe message passing implemented
- [ ] All UI→Plugin messages type-safe
- [ ] All Plugin→UI messages type-safe
- [ ] Compile-time errors for invalid messages
- [ ] Runtime validation matches types
- [ ] All existing functionality works

### Related Issues

- Related to TICKET-001 (Plugin Infrastructure)
- Related to TICKET-021 (Error Handling)
