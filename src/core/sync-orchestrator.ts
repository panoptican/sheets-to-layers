import {
  runSync,
  runTargetedSync,
  applyFetchedImage,
  type SyncOptions,
  type TargetedSyncOptions,
  type SyncEngineResult,
} from './sync-engine';

/**
 * Thin orchestration facade for sync-related workflows.
 *
 * This is an extraction step toward a dedicated orchestrator architecture.
 */
export class SyncOrchestrator {
  async sync(options: SyncOptions): Promise<SyncEngineResult> {
    return await runSync(options);
  }

  async syncTargeted(options: TargetedSyncOptions): Promise<SyncEngineResult> {
    return await runTargetedSync(options);
  }

  async applyImage(nodeId: string, imageData: Uint8Array): Promise<boolean> {
    return await applyFetchedImage(nodeId, imageData);
  }
}
