/**
 * Review and result summaries.
 *
 * Large files produce hundreds of identical repeat lines and thousands of
 * layer outcomes. These helpers fold them into lines a person can read while
 * keeping every individual outcome reachable.
 */

import type { LayerOutcome, LayerOutcomeStatus, OutcomeCounts, RepeatChange } from './types';

// ============================================================================
// Repeat changes
// ============================================================================

export interface RepeatSummaryLine {
  key: string;
  /** Layer name with the repeat marker removed. */
  name: string;
  /** Only present when another line shares the same name. */
  parentName?: string;
  worksheet: string;
  /** Number of frames this line describes. */
  frames: number;
  additions: number;
  removals: number;
  layerIds: string[];
}

export function repeatDisplayName(layerName: string): string {
  return layerName.replace(/\s*@#(?:\s|$)/g, ' ').trim() || 'Repeated frame';
}

/**
 * Group repeat frames that share a name, parent, worksheet, and change so
 * eighteen collapsed "Cards" frames read as one line. Frames with no
 * additions or removals are dropped.
 */
export function summarizeRepeats(repeats: readonly RepeatChange[]): RepeatSummaryLine[] {
  const groups = new Map<string, RepeatSummaryLine>();
  for (const repeat of repeats) {
    if (repeat.additions === 0 && repeat.removals === 0) continue;
    const name = repeatDisplayName(repeat.layerName);
    const key = JSON.stringify([name, repeat.parentName ?? '', repeat.worksheet, repeat.additions, repeat.removals]);
    const existing = groups.get(key);
    if (existing) {
      existing.frames++;
      existing.layerIds.push(repeat.layerId);
      continue;
    }
    groups.set(key, {
      key, name, parentName: repeat.parentName, worksheet: repeat.worksheet,
      frames: 1, additions: repeat.additions, removals: repeat.removals, layerIds: [repeat.layerId],
    });
  }
  const lines = [...groups.values()];
  const namesSeen = new Map<string, number>();
  for (const line of lines) namesSeen.set(line.name, (namesSeen.get(line.name) ?? 0) + 1);
  for (const line of lines) {
    if ((namesSeen.get(line.name) ?? 0) < 2) delete line.parentName;
  }
  return lines;
}

export function repeatSummaryText(line: RepeatSummaryLine): string {
  const count = line.removals || line.additions;
  const subject = line.parentName ? `${line.name} in ${line.parentName}` : line.name;
  const change = `${line.removals ? 'remove' : 'add'} ${count} repeated ${count === 1 ? 'item' : 'items'}`;
  return line.frames === 1
    ? `${subject} will ${change}.`
    : `${subject} will ${change} in each of ${line.frames} frames.`;
}

// ============================================================================
// Layer outcomes
// ============================================================================

export interface OutcomeGroup {
  key: string;
  name: string;
  counts: OutcomeCounts;
  /** The most actionable status in the group. */
  status: LayerOutcomeStatus;
  outcomes: LayerOutcome[];
}

const STATUS_PRIORITY: LayerOutcomeStatus[] = ['failed', 'skipped', 'changed', 'unchanged'];

/**
 * Group outcomes by layer name. Groups that need attention come first, and
 * the original order is kept within each tier.
 */
export function groupOutcomes(outcomes: readonly LayerOutcome[]): OutcomeGroup[] {
  const groups = new Map<string, OutcomeGroup>();
  for (const outcome of outcomes) {
    const key = outcome.layerName;
    let group = groups.get(key);
    if (!group) {
      group = {
        key, name: outcome.layerName,
        counts: { changed: 0, unchanged: 0, skipped: 0, failed: 0 },
        status: outcome.status, outcomes: [],
      };
      groups.set(key, group);
    }
    group.counts[outcome.status]++;
    group.outcomes.push(outcome);
    if (STATUS_PRIORITY.indexOf(outcome.status) < STATUS_PRIORITY.indexOf(group.status)) {
      group.status = outcome.status;
    }
  }
  return [...groups.values()].sort((left, right) =>
    STATUS_PRIORITY.indexOf(left.status) - STATUS_PRIORITY.indexOf(right.status));
}

/** "3 failed, 12 changed" with zero counts omitted. */
export function outcomeCountsText(counts: OutcomeCounts): string {
  return STATUS_PRIORITY
    .filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${status}`)
    .join(', ');
}
