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
  const hasRepeatSyntax = frame.name.includes('@#');
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
  worksheet: Worksheet
): Promise<RepeatFrameResult> {
  const result: RepeatFrameResult = {
    success: true,
    childrenAdded: 0,
    childrenRemoved: 0,
    targetCount: 0,
    warnings: [],
  };

  // Validate repeat frame
  const config = detectRepeatFrame(frame as SceneNode);

  if (!config.isRepeatFrame) {
    // Not a repeat frame, nothing to do
    return result;
  }

  if (!config.hasAutoLayout) {
    result.success = false;
    result.error = {
      layerName: frame.name,
      layerId: frame.id,
      error: 'Auto-layout required for layer repetition. Enable auto-layout on this frame.',
    };
    result.warnings.push(`Frame "${frame.name}" has @# but no auto-layout. Skipping repetition.`);
    return result;
  }

  if (frame.children.length === 0) {
    result.warnings.push(`Frame "${frame.name}" has no children to duplicate.`);
    return result;
  }

  // Get target count from worksheet
  const targetCount = getValueCountForRepeatFrame(frame, worksheet);
  result.targetCount = targetCount;

  if (targetCount <= 0) {
    result.warnings.push(`Frame "${frame.name}": No values found for referenced labels.`);
    return result;
  }

  const currentCount = frame.children.length;
  const template = frame.children[0];
  const addedChildren: SceneNode[] = [];
  const removedChildren: SceneNode[] = [];

  try {
    if (currentCount < targetCount) {
      // Need to add children
      for (let i = currentCount; i < targetCount; i++) {
        const clone = template.clone();
        frame.appendChild(clone);
        addedChildren.push(clone as SceneNode);
        result.childrenAdded++;
      }
    } else if (currentCount > targetCount) {
      // Need to remove children (from the end, preserving template)
      for (let i = currentCount - 1; i >= targetCount; i--) {
        const childToRemove = frame.children[i] as SceneNode;
        childToRemove.remove();
        removedChildren.push(childToRemove);
        result.childrenRemoved++;
      }
    }

    return result;
  } catch (error) {
    // Rollback partial changes to preserve document consistency.
    for (let i = addedChildren.length - 1; i >= 0; i--) {
      try {
        addedChildren[i].remove();
      } catch {
        // Best-effort rollback.
      }
    }

    for (let i = removedChildren.length - 1; i >= 0; i--) {
      try {
        frame.appendChild(removedChildren[i]);
      } catch {
        // Best-effort rollback.
      }
    }

    result.success = false;
    result.childrenAdded = 0;
    result.childrenRemoved = 0;
    result.error = {
      layerName: frame.name,
      layerId: frame.id,
      error: error instanceof Error ? error.message : String(error),
    };
    result.warnings.push(`Rolled back partial repeat-frame changes for "${frame.name}".`);
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

    if (frameResult.success) {
      result.successCount++;
      result.totalChildrenAdded += frameResult.childrenAdded;
      result.totalChildrenRemoved += frameResult.childrenRemoved;
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
    return node.name.includes('@#');
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
