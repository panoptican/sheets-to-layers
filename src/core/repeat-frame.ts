/**
 * Layer repetition (auto-duplication) for Figma frames.
 *
 * Implements the `@#` syntax for auto-layout frames that automatically
 * duplicates children to match the number of data rows in the sheet.
 *
 * How it works:
 * 1. Detect `@#` in frame names
 * 2. Validate that frame has auto-layout enabled
 * 3. Find the first label referenced in descendants
 * 4. Count values for that label in the worksheet
 * 5. Duplicate first child (template) or remove excess children
 *
 * Requirements:
 * - Frame must have auto-layout enabled (layoutMode !== 'NONE')
 * - Frame must have at least one child (the template)
 * - Children must reference at least one label to determine count
 */

import type { Worksheet, SyncError } from './types';
import { parseLayerName, matchLabel } from './parser';
import { yieldToUI } from './performance';

const REPEAT_EDIT_BATCH_SIZE = 50;

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for a repeat frame.
 */
export interface RepeatConfig {
  /** Whether this frame has the @# marker */
  isRepeatFrame: boolean;
  /** Whether auto-layout is enabled (required for repetition) */
  hasAutoLayout: boolean;
  /** Number of children currently in the frame */
  currentChildCount: number;
}

/**
 * Result of processing a repeat frame.
 */
export interface RepeatFrameResult {
  /** Whether processing was successful */
  success: boolean;
  /** Number of children added */
  childrenAdded: number;
  /** Number of children removed */
  childrenRemoved: number;
  /** Target child count */
  targetCount: number;
  /** Error if processing failed */
  error?: SyncError;
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/** A read-only structural plan. The first child is always the reusable template. */
export interface RepeatPlan {
  frameId: string;
  frameName: string;
  worksheet: string;
  currentCount: number;
  targetCount: number;
  additions: number;
  removals: number;
  removeIds: readonly string[];
  warning?: string;
  error?: string;
}

export function planRepeatFrame(frame: FrameNode, worksheet: Worksheet): RepeatPlan {
  const base: RepeatPlan = {
    frameId: frame.id,
    frameName: frame.name,
    worksheet: worksheet.name,
    currentCount: frame.children.length,
    targetCount: frame.children.length,
    additions: 0,
    removals: 0,
    removeIds: [],
  };
  if (!detectRepeatFrame(frame as SceneNode).isRepeatFrame) return base;
  if (frame.layoutMode === 'NONE') {
    return { ...base, error: 'Auto-layout required for layer repetition.' };
  }
  if (frame.children.length === 0) {
    return { ...base, error: 'At least one template child is required for layer repetition.' };
  }
  const label = findFirstLabel(frame);
  if (!label) return { ...base, error: 'No bound label found in repeat frame.' };
  const matchedLabel = matchLabel(label, worksheet.labels);
  if (!matchedLabel || !Array.isArray(worksheet.rows[matchedLabel])) {
    return { ...base, error: `Label "${label}" is unavailable in worksheet "${worksheet.name}".` };
  }
  const targetCount = worksheet.rows[matchedLabel].length;
  // A valid empty source must not destroy the only reusable template.
  if (targetCount === 0) {
    return { ...base, targetCount: 0, warning: 'No data; repetition skipped to preserve the template.' };
  }
  return {
    ...base,
    targetCount,
    additions: Math.max(0, targetCount - frame.children.length),
    removals: Math.max(0, frame.children.length - targetCount),
    removeIds: frame.children.slice(targetCount).map((child) => child.id),
  };
}

/**
 * Result of batch processing repeat frames.
 */
export interface BatchRepeatFrameResult {
  /** Total frames processed */
  totalProcessed: number;
  /** Frames that were successfully adjusted */
  successCount: number;
  /** Frames that failed */
  failureCount: number;
  /** Total children added across all frames */
  totalChildrenAdded: number;
  /** Total children removed across all frames */
  totalChildrenRemoved: number;
  /** Errors from failed frames */
  errors: SyncError[];
  /** All warnings */
  warnings: string[];
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect if a node is a repeat frame and get its configuration.
 *
 * @param node - The node to check
 * @returns RepeatConfig with detection results
 *
 * @example
 * const config = detectRepeatFrame(frame);
 * if (config.isRepeatFrame && !config.hasAutoLayout) {
 *   console.warn('Frame needs auto-layout for repetition');
 * }
 */
export function detectRepeatFrame(node: SceneNode): RepeatConfig {
  if (node.type !== 'FRAME') {
    return {
      isRepeatFrame: false,
      hasAutoLayout: false,
      currentChildCount: 0,
    };
  }

  const frame = node as FrameNode;
  const hasRepeatSyntax = parseLayerName(frame.name).isRepeatFrame;
  const hasAutoLayout = frame.layoutMode !== 'NONE';

  return {
    isRepeatFrame: hasRepeatSyntax,
    hasAutoLayout,
    currentChildCount: frame.children.length,
  };
}

/**
 * Check if a node is a valid repeat frame (has @# and auto-layout).
 *
 * @param node - The node to check
 * @returns true if the node is a valid repeat frame
 */
export function isValidRepeatFrame(node: SceneNode): boolean {
  const config = detectRepeatFrame(node);
  return config.isRepeatFrame && config.hasAutoLayout;
}

// ============================================================================
// Value Counting
// ============================================================================

/**
 * Find the first label referenced in a node's descendants.
 *
 * Searches depth-first through the node and its children to find
 * the first layer with a #Label binding.
 *
 * @param node - The node to search
 * @returns The first label found, or null if none
 */
export function findFirstLabel(node: BaseNode): string | null {
  const parsed = parseLayerName(node.name);

  if (parsed.isIgnored || (node.type === 'COMPONENT' && !parsed.forceInclude)) {
    return null;
  }

  if (parsed.labels.length > 0) {
    return parsed.labels[0];
  }

  if ('children' in node) {
    const container = node as ChildrenMixin;
    for (const child of container.children) {
      const found = findFirstLabel(child);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get the value count for a repeat frame based on sheet data.
 *
 * Finds the first label referenced in the frame's descendants
 * and returns the count of values for that label in the worksheet.
 *
 * @param frame - The repeat frame
 * @param worksheet - The worksheet to get counts from
 * @returns Number of values, or 0 if no label found or no match
 *
 * @example
 * const count = getValueCountForRepeatFrame(frame, worksheet);
 * // If first label is "Title" and worksheet has 5 titles, returns 5
 */
export function getValueCountForRepeatFrame(
  frame: FrameNode,
  worksheet: Worksheet
): number {
  // Find the first label in any descendant
  const label = findFirstLabel(frame);

  if (!label) {
    return 0;
  }

  // Match label to worksheet columns/rows (case-insensitive)
  const matchedLabel = matchLabel(label, worksheet.labels);

  if (!matchedLabel) {
    return 0;
  }

  // Return the count of values for this label
  const values = worksheet.rows[matchedLabel];
  return values ? values.length : 0;
}

// ============================================================================
// Frame Processing
// ============================================================================

/**
 * Process a repeat frame, adjusting children to match data count.
 *
 * This function:
 * 1. Validates that the frame has @# and auto-layout
 * 2. Counts values for the first referenced label
 * 3. Duplicates template (first child) or removes excess children
 *
 * @param frame - The frame to process
 * @param worksheet - The worksheet to get value counts from
 * @returns RepeatFrameResult with processing details
 *
 * @example
 * const result = await processRepeatFrame(frame, worksheet);
 * if (result.success) {
 *   console.log(`Added ${result.childrenAdded} children`);
 * }
 */
export async function processRepeatFrame(
  frame: FrameNode,
  worksheet: Worksheet,
  signal?: { readonly aborted: boolean }
): Promise<RepeatFrameResult> {
  return applyRepeatPlan(frame, planRepeatFrame(frame, worksheet), signal);
}

/** Execute captured counts and removal identities without resolving sheet data again. */
export async function applyRepeatPlan(
  frame: FrameNode,
  plan: Readonly<RepeatPlan>,
  signal?: { readonly aborted: boolean }
): Promise<RepeatFrameResult> {
  const result: RepeatFrameResult = {
    success: true,
    childrenAdded: 0,
    childrenRemoved: 0,
    targetCount: 0,
    warnings: [],
  };

  result.targetCount = plan.targetCount;
  if (plan.error) {
    result.success = false;
    result.error = {
      layerName: frame.name,
      layerId: frame.id,
      error: plan.error,
    };
    result.warnings.push(`Frame "${frame.name}": ${plan.error}`);
    return result;
  }
  if (plan.warning) {
    result.warnings.push(`Frame "${frame.name}": ${plan.warning}`);
    return result;
  }

  const template = frame.children[0];
  const addedChildren: SceneNode[] = [];

  try {
    if (frame.id !== plan.frameId || frame.name !== plan.frameName ||
      frame.children.length !== plan.currentCount) {
      throw new Error('Repeat frame changed after planning. Refresh preflight.');
    }
    if (plan.additions > 0) {
      for (let i = 0; i < plan.additions; i++) {
        if (signal?.aborted) throw new Error('Repeat preparation cancelled.');
        const clone = template.clone();
        frame.appendChild(clone);
        addedChildren.push(clone as SceneNode);
        result.childrenAdded++;
        if (result.childrenAdded % REPEAT_EDIT_BATCH_SIZE === 0) {
          await yieldToUI();
          if (signal?.aborted) throw new Error('Repeat preparation cancelled.');
        }
      }
    } else if (plan.removals > 0) {
      // Revalidate the exact children reviewed before the irreversible phase.
      if (frame.children.slice(plan.targetCount).some((child, i) => child.id !== plan.removeIds[i])) {
        throw new Error('Repeat children changed after planning. Refresh preflight.');
      }
      for (let i = plan.removeIds.length - 1; i >= 0; i--) {
        if (signal?.aborted) throw new Error('Repeat removal cancelled.');
        const childToRemove = frame.children[plan.targetCount + i] as SceneNode;
        childToRemove.remove();
        result.childrenRemoved++;
        if (result.childrenRemoved % REPEAT_EDIT_BATCH_SIZE === 0) {
          await yieldToUI();
          if (signal?.aborted) throw new Error('Repeat removal cancelled.');
        }
      }
    }

    return result;
  } catch (error) {
    // Clones are still attached and can be removed; removed nodes cannot be restored.
    for (let i = addedChildren.length - 1; i >= 0; i--) {
      try {
        addedChildren[i].remove();
      } catch {
        // Best-effort rollback.
      }
    }

    result.success = false;
    result.childrenAdded = addedChildren.filter((child) =>
      frame.children.some((attached) => attached.id === child.id)).length;
    result.error = {
      layerName: frame.name,
      layerId: frame.id,
      error: error instanceof Error ? error.message : String(error),
    };
    result.warnings.push(`Repeat-frame changes stopped for "${frame.name}" after ${result.childrenAdded} addition(s) and ${result.childrenRemoved} removal(s).`);
    return result;
  }
}

/**
 * Process multiple repeat frames in batch.
 *
 * @param frames - Array of frame nodes to process
 * @param worksheet - The worksheet to get value counts from
 * @returns BatchRepeatFrameResult with aggregate results
 */
export async function batchProcessRepeatFrames(
  frames: FrameNode[],
  worksheet: Worksheet
): Promise<BatchRepeatFrameResult> {
  const result: BatchRepeatFrameResult = {
    totalProcessed: frames.length,
    successCount: 0,
    failureCount: 0,
    totalChildrenAdded: 0,
    totalChildrenRemoved: 0,
    errors: [],
    warnings: [],
  };

  for (const frame of frames) {
    const frameResult = await processRepeatFrame(frame, worksheet);

    // Failed removals cannot be rolled back; totals describe actual document changes.
    result.totalChildrenAdded += frameResult.childrenAdded;
    result.totalChildrenRemoved += frameResult.childrenRemoved;

    if (frameResult.success) {
      result.successCount++;
    } else {
      result.failureCount++;
      if (frameResult.error) {
        result.errors.push(frameResult.error);
      }
    }

    result.warnings.push(...frameResult.warnings);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Find all repeat frames in a list of nodes.
 *
 * @param nodes - Nodes to search through
 * @returns Array of repeat frames (valid frames with @# marker)
 */
export function filterRepeatFrames(nodes: SceneNode[]): FrameNode[] {
  return nodes.filter((node): node is FrameNode => {
    if (node.type !== 'FRAME') return false;
    return detectRepeatFrame(node).isRepeatFrame;
  });
}

/**
 * Validate all repeat frames in a list and return warnings for invalid ones.
 *
 * @param frames - Frames to validate
 * @returns Array of warning messages for invalid frames
 */
export function validateRepeatFrames(frames: FrameNode[]): string[] {
  const warnings: string[] = [];

  for (const frame of frames) {
    const config = detectRepeatFrame(frame as SceneNode);

    if (config.isRepeatFrame && !config.hasAutoLayout) {
      warnings.push(
        `Frame "${frame.name}" has @# marker but no auto-layout. Auto-layout is required for repetition.`
      );
    }

    if (config.isRepeatFrame && config.currentChildCount === 0) {
      warnings.push(
        `Frame "${frame.name}" has @# marker but no children. At least one child is needed as a template.`
      );
    }
  }

  return warnings;
}

/**
 * Get statistics about repeat frames in a list of nodes.
 *
 * @param nodes - Nodes to analyze
 * @returns Object with counts
 */
export function getRepeatFrameStats(nodes: SceneNode[]): {
  total: number;
  valid: number;
  missingAutoLayout: number;
  missingChildren: number;
} {
  const stats = {
    total: 0,
    valid: 0,
    missingAutoLayout: 0,
    missingChildren: 0,
  };

  for (const node of nodes) {
    const config = detectRepeatFrame(node);

    if (config.isRepeatFrame) {
      stats.total++;

      if (!config.hasAutoLayout) {
        stats.missingAutoLayout++;
      } else if (config.currentChildCount === 0) {
        stats.missingChildren++;
      } else {
        stats.valid++;
      }
    }
  }

  return stats;
}
