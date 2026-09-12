import {
  prepareSync,
  applyPreparedSync,
  applyPendingImage,
  finalOperationResult,
  type PrepareOptions,
  type PreparedSync,
  type ApplicationResult,
  type PendingImageRequest,
  type SyncCancellationSignal,
} from './sync-engine';
import type { LayerOutcome, OperationResult } from './types';

/**
 * Thin orchestration facade for sync-related workflows.
 *
 * This is an extraction step toward a dedicated orchestrator architecture.
 */
export class SyncOrchestrator {
  prepare(options: PrepareOptions): Promise<PreparedSync> {
    return prepareSync(options);
  }

  apply(
    plan: PreparedSync, excludedIssueIds: readonly string[], signal?: SyncCancellationSignal,
    onProgress?: (message: string, percent: number) => void, retryBindingIds?: ReadonlySet<string>
  ): Promise<ApplicationResult> {
    return applyPreparedSync(plan, excludedIssueIds, signal, onProgress, retryBindingIds);
  }

  applyPendingImage(request: PendingImageRequest, data: Uint8Array, signal?: SyncCancellationSignal): Promise<LayerOutcome> {
    return applyPendingImage(request, data, signal);
  }

  finalize(plan: PreparedSync, outcomes: LayerOutcome[], warnings: string[], cancelled = false, fatalError?: string): OperationResult {
    return finalOperationResult(plan, outcomes, warnings, cancelled, fatalError);
  }

}
