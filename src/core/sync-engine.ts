/** One prepared sync pipeline for preview, apply, re-sync, and retry. */
import type { LayerOutcome, OperationResult, OutcomeCounts } from './types';
import { applyRepeatPlan } from './repeat-frame';
import { swapComponent } from './component-swap';
import { syncTextLayer } from './text-sync';
import { parseChainedSpecialTypes, applyChainedSpecialTypes, hasAnyParsedType } from './special-types';
import { isImageUrl, canHaveImageFill, convertToDirectUrl, applyImageFill } from './image-sync';
import { yieldToUI } from './performance';
import {
  prepareSync, preflightIsCurrent, resolvePlannedNode, outcomeForIssue, nodeFingerprint,
  targetFingerprint, contentFingerprint,
  type PrepareOptions, type PreparedSync, type PlannedBinding, type PlannedRepeat,
} from './preflight';

export interface SyncCancellationSignal { readonly aborted: boolean; }
export interface PendingImageRequest {
  nodeId: string;
  url: string;
  requestId?: string;
  bindingId?: string;
  expectedFingerprint?: string;
  layerName?: string;
  worksheet?: string;
  label?: string;
  resolvedRow?: number;
}

// ============================================================================
// Prepared operation pipeline
// ============================================================================

export { prepareSync };
export type { PrepareOptions, PreparedSync };

export interface ApplicationResult {
  outcomes: LayerOutcome[];
  pendingImages: PendingImageRequest[];
  warnings: string[];
  cancelled: boolean;
  fatalError?: string;
}

export class StalePreflightError extends Error {
  constructor() {
    super('The document changed after preflight. Refresh the proposed changes before applying.');
    this.name = 'StalePreflightError';
  }
}

function failedOutcome(entry: PlannedBinding, message: string, layerId = entry.originalNodeId): LayerOutcome {
  return {
    bindingId: entry.bindingId, layerId, layerName: entry.expectedName,
    status: 'failed', message, worksheet: entry.worksheet, label: entry.label,
    resolvedRow: entry.row,
  };
}

function appliedOutcome(
  entry: PlannedBinding, node: SceneNode, status: LayerOutcome['status'], message?: string
): LayerOutcome {
  return {
    bindingId: entry.bindingId, layerId: node.id, layerName: node.name,
    status, ...(message ? { message } : {}),
    worksheet: entry.worksheet, label: entry.label, resolvedRow: entry.row,
  };
}

function cancelledOutcome(entry: PlannedBinding): LayerOutcome {
  return {
    bindingId: entry.bindingId, layerId: entry.originalNodeId,
    layerName: entry.expectedName, status: 'skipped',
    message: 'Cancelled before application.',
    worksheet: entry.worksheet, label: entry.label, resolvedRow: entry.row,
  };
}

async function applyRepeatOperations(
  operations: readonly PlannedRepeat[],
  excluded: Set<string>,
  warnings: string[],
  structural: { mutations: number },
  outcomes: LayerOutcome[],
  signal?: SyncCancellationSignal
): Promise<void> {
  for (const operation of operations) {
    if (signal?.aborted) return;
    const base = {
      bindingId: `repeat:${operation.originalNodeId}`, layerId: operation.originalNodeId,
      layerName: operation.expectedName, worksheet: operation.worksheet,
    };
    const skip = operation.skipReason ||
      (operation.issueId && excluded.has(operation.issueId) ? 'Excluded during preflight.' : undefined);
    if (skip || !operation.plan) {
      warnings.push(`Repeat frame "${operation.expectedName}" skipped: ${skip}`);
      outcomes.push({ ...base, status: 'skipped', message: skip });
      continue;
    }
    const frame = await resolvePlannedNode(operation);
    if (signal?.aborted) return;
    const generated = operation.originalNodeId.startsWith('planned:');
    if (!frame || frame.type !== 'FRAME' || frame.name !== operation.expectedName ||
      (!generated && frame.id !== operation.originalNodeId) ||
      frame.children.length !== operation.plan.currentCount) {
      throw new StalePreflightError();
    }
    // Generated descendants have fresh IDs, but their removal positions and counts
    // were reviewed against the template. Existing children retain their exact IDs.
    const executable = generated ? {
      ...operation.plan, frameId: frame.id,
      removeIds: frame.children.slice(operation.plan.targetCount).map((child) => child.id),
    } : operation.plan;
    const result = await applyRepeatPlan(frame, executable, signal);
    const changes = result.childrenAdded + result.childrenRemoved;
    structural.mutations += changes;
    outcomes.push({ ...base, layerId: frame.id,
      status: changes > 0 ? 'changed' : result.success ? 'unchanged' : 'failed',
      message: `Added ${result.childrenAdded}, removed ${result.childrenRemoved} repeat child(ren).`,
    });
    if (!result.success && result.error) warnings.push(result.error.error);
    warnings.push(...result.warnings);
    if (!result.success && changes > 0) {
      throw new Error(`Repeat frame "${frame.name}" stopped after ${result.childrenAdded} addition(s) and ${result.childrenRemoved} removal(s).`);
    }
  }
}

async function applyPlannedBinding(
  plan: PreparedSync,
  entry: PlannedBinding,
  pendingImages: PendingImageRequest[],
  warnings: string[],
  signal?: SyncCancellationSignal,
  retry = false
): Promise<LayerOutcome | null> {
  const node = await resolvePlannedNode(entry);
  if (signal?.aborted) return node
    ? appliedOutcome(entry, node, 'skipped', 'Cancelled before application.')
    : failedOutcome(entry, 'Layer was removed before application.');
  if (!node) return failedOutcome(entry, 'Layer was removed before application.');
  if (node.name !== entry.expectedName || node.type !== entry.expectedType ||
    (!entry.originalNodeId.startsWith('planned:') && node.id !== entry.originalNodeId)) {
    return failedOutcome(entry, 'Layer identity or binding changed before application.', node.id);
  }
  if (retry && entry.fingerprint) {
    const currentFingerprint = await targetFingerprint(node, signal);
    if (signal?.aborted) return appliedOutcome(entry, node, 'skipped', 'Cancelled before application.');
    if (currentFingerprint !== entry.fingerprint) {
      return failedOutcome(entry, 'Layer changed since the original preflight. Refresh before retrying.', node.id);
    }
  }
  if (entry.value === undefined) return appliedOutcome(entry, node, 'skipped', 'No resolved value.');
  const value = entry.value;
  const specialValue = value.startsWith('/') ? value.slice(1) : value;

  if (node.type === 'TEXT') {
    if (value === '' && plan.preferences.blankText === 'leave-unchanged') {
      return appliedOutcome(entry, node, 'skipped', 'Blank text left unchanged.');
    }
    if (value.startsWith('/')) {
      const parsed = parseChainedSpecialTypes(specialValue);
      if (hasAnyParsedType(parsed)) {
        const before = nodeFingerprint(node);
        const applied = await applyChainedSpecialTypes(node, parsed, { signal });
        if (applied.cancelled || signal?.aborted) return appliedOutcome(entry, node,
          before === nodeFingerprint(node) ? 'skipped' : 'changed', 'Cancelled during application.');
        if (applied.error) return failedOutcome(entry, applied.error.error, node.id);
        warnings.push(...applied.warnings);
        return appliedOutcome(entry, node, before === nodeFingerprint(node) ? 'unchanged' : 'changed');
      }
    }
    const before = nodeFingerprint(node);
    const result = await syncTextLayer(node, value, {
      additionalValues: [...entry.additionalValues],
      clearOnEmpty: plan.preferences.blankText === 'clear-and-hide',
      signal,
    });
    if (result.cancelled || signal?.aborted) return appliedOutcome(entry, node,
      before === nodeFingerprint(node) ? 'skipped' : 'changed', 'Cancelled during application.');
    if (!result.success) return failedOutcome(entry, result.error?.error || 'Text update failed.', node.id);
    warnings.push(...result.warnings);
    return appliedOutcome(entry, node, before === nodeFingerprint(node) ? 'unchanged' : 'changed');
  }

  if (value.trim() === '') return appliedOutcome(entry, node, 'skipped', 'Blank value left unchanged.');

  if (node.type === 'INSTANCE') {
    if (value.startsWith('/')) {
      const parsed = parseChainedSpecialTypes(specialValue);
      if (hasAnyParsedType(parsed)) {
        const before = nodeFingerprint(node);
        const applied = await applyChainedSpecialTypes(node, parsed, { signal });
        if (applied.cancelled || signal?.aborted) return appliedOutcome(entry, node,
          before === nodeFingerprint(node) ? 'skipped' : 'changed', 'Cancelled during application.');
        if (applied.error) return failedOutcome(entry, applied.error.error, node.id);
        warnings.push(...applied.warnings);
        return appliedOutcome(entry, node, before === nodeFingerprint(node) ? 'unchanged' : 'changed');
      }
    }
    const swapped = await swapComponent(node, value, plan.componentCache, signal);
    if (!swapped.success) return failedOutcome(entry, swapped.error?.error || 'Component swap failed.', node.id);
    warnings.push(...swapped.warnings);
    return appliedOutcome(entry, node, swapped.componentChanged ? 'changed' : 'unchanged');
  }

  if (isImageUrl(value) && canHaveImageFill(node)) {
    const requestId = `${plan.summary.preflightId}:${entry.bindingId}`;
    pendingImages.push({
      requestId, bindingId: entry.bindingId, nodeId: node.id,
      url: convertToDirectUrl(value), expectedFingerprint: contentFingerprint(node),
      layerName: node.name, worksheet: entry.worksheet, label: entry.label,
      resolvedRow: entry.row,
    });
    return null;
  }

  const parsed = parseChainedSpecialTypes(value);
  if (!hasAnyParsedType(parsed)) return appliedOutcome(entry, node, 'skipped', 'Value does not apply to this layer type.');
  const before = nodeFingerprint(node);
  const applied = await applyChainedSpecialTypes(node, parsed, { signal });
  if (applied.cancelled || signal?.aborted) return appliedOutcome(entry, node,
    before === nodeFingerprint(node) ? 'skipped' : 'changed', 'Cancelled during application.');
  if (applied.error) return failedOutcome(entry, applied.error.error, node.id);
  warnings.push(...applied.warnings);
  return appliedOutcome(entry, node, before === nodeFingerprint(node) ? 'unchanged' : 'changed');
}

/** Apply exactly the values selected in preflight. Retry uses the same entries without repeat edits. */
export async function applyPreparedSync(
  plan: PreparedSync,
  excludedIssueIds: readonly string[],
  signal?: SyncCancellationSignal,
  onProgress?: (message: string, percent: number) => void,
  retryBindingIds?: ReadonlySet<string>
): Promise<ApplicationResult> {
  const excluded = new Set(excludedIssueIds);
  if (!retryBindingIds) {
    if (!(await preflightIsCurrent(plan, signal))) throw new StalePreflightError();
    const unresolved = plan.summary.issues.filter((entry) => entry.blocking && !excluded.has(entry.id));
    if (unresolved.length > 0) throw new Error(`Resolve or exclude ${unresolved.length} blocking preflight issue(s).`);
    if (plan.roots.rootIds.length === 0 || plan.summary.issues.some((entry) => entry.code === 'no-roots')) {
      throw new Error('Choose an explicit sync scope before applying.');
    }
  }
  const outcomes: LayerOutcome[] = [];
  const pendingImages: PendingImageRequest[] = [];
  const warnings: string[] = [];
  const structural = { mutations: 0 };
  const repeatGroups = new Map<string | undefined, PlannedRepeat[]>();
  for (const operation of plan.repeats) {
    const group = repeatGroups.get(operation.afterBindingId) || [];
    group.push(operation);
    repeatGroups.set(operation.afterBindingId, group);
  }
  const entries = retryBindingIds
    ? plan.bindings.filter((entry) => retryBindingIds.has(entry.bindingId))
    : plan.bindings;
  try {
    if (!retryBindingIds && !signal?.aborted) {
      await applyRepeatOperations(repeatGroups.get(undefined) || [], excluded, warnings, structural, outcomes, signal);
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (signal?.aborted) {
        for (let remaining = i; remaining < entries.length; remaining++) {
          outcomes.push(cancelledOutcome(entries[remaining]));
        }
        break;
      }
      if (entry.issueId) {
        outcomes.push(outcomeForIssue(entry));
        continue;
      }
      let outcome: LayerOutcome | null;
      try {
        outcome = await applyPlannedBinding(plan, entry, pendingImages, warnings, signal, !!retryBindingIds);
      } catch (error) {
        outcome = failedOutcome(entry, error instanceof Error ? error.message : String(error));
      }
      if (outcome) outcomes.push(outcome);
      if (outcome?.status === 'changed' || outcome?.status === 'unchanged') {
        await applyRepeatOperations(repeatGroups.get(entry.bindingId) || [], excluded, warnings, structural, outcomes, signal);
      }
      if (i === 0 || i % 100 === 99 || i === entries.length - 1) {
        onProgress?.(`Applying layers (${i + 1}/${entries.length})...`, 20 + Math.floor(((i + 1) / Math.max(1, entries.length)) * 60));
      }
      if (i % 250 === 249) await yieldToUI();
    }
  } catch (error) {
    if (structural.mutations === 0 && !outcomes.some((outcome) => outcome.status === 'changed')) throw error;
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${structural.mutations} repeat child change(s) occurred before the structural phase stopped.`);
    const attempted = new Set([
      ...outcomes.map((outcome) => outcome.bindingId),
      ...pendingImages.map((request) => request.bindingId),
    ]);
    for (const entry of entries) {
      if (!attempted.has(entry.bindingId)) outcomes.push({
        ...cancelledOutcome(entry), message: 'Structural phase stopped before this binding was applied.',
      });
    }
    return { outcomes, pendingImages, warnings, cancelled: !!signal?.aborted, fatalError: message };
  }
  return { outcomes, pendingImages, warnings, cancelled: !!signal?.aborted };
}

/** A pending image is accepted only while the exact target state is still current. */
export async function applyPendingImage(
  request: PendingImageRequest,
  imageData: Uint8Array,
  signal?: SyncCancellationSignal
): Promise<LayerOutcome> {
  const base = {
    bindingId: request.bindingId || request.requestId || request.nodeId,
    layerId: request.nodeId, layerName: request.layerName || request.nodeId,
    worksheet: request.worksheet, label: request.label, resolvedRow: request.resolvedRow,
  };
  if (signal?.aborted) return { ...base, status: 'skipped', message: 'Cancelled before image application.' };
  const node = await figma.getNodeByIdAsync(request.nodeId);
  if (signal?.aborted) return { ...base, status: 'skipped', message: 'Cancelled before image application.' };
  if (!node || !canHaveImageFill(node as SceneNode)) {
    return { ...base, status: 'skipped', message: 'Image target was removed or changed.' };
  }
  base.layerName = node.name;
  if (request.expectedFingerprint && contentFingerprint(node) !== request.expectedFingerprint) {
    return { ...base, status: 'skipped', message: 'Image target changed while loading.' };
  }
  const result = applyImageFill(node as SceneNode, imageData);
  return result.success
    ? { ...base, status: result.fillChanged ? 'changed' : 'unchanged' }
    : { ...base, status: 'failed', message: result.error?.error || 'Image application failed.' };
}

export function finalOperationResult(
  plan: PreparedSync,
  outcomes: LayerOutcome[],
  warnings: string[],
  cancelled = false,
  fatalError?: string
): OperationResult {
  const counts: OutcomeCounts = { changed: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const outcome of outcomes) counts[outcome.status]++;
  const status = cancelled ? 'cancelled'
    : fatalError ? 'failed'
    : counts.failed > 0 ? (counts.changed + counts.unchanged + counts.skipped > 0 ? 'partial' : 'failed')
      : 'success';
  return {
    status, snapshotId: plan.snapshot.id, counts, outcomes,
    success: status === 'success' || status === 'partial', cancelled,
    layersProcessed: outcomes.length, layersUpdated: counts.changed,
    errors: [
      ...(fatalError ? [{ layerId: '', layerName: '', error: fatalError }] : []),
      ...outcomes.filter((outcome) => outcome.status === 'failed').map((outcome) => ({
      layerId: outcome.layerId, layerName: outcome.layerName, error: outcome.message || 'Update failed.',
      })),
    ],
    warnings,
  };
}
