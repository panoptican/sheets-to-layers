import type {
  ComponentCache, InterpretationPreferences, LayerOutcome, ParsedLayerName, PreflightIssue,
  PreflightSummary, RepeatChange, SheetSnapshot, SyncScope, Worksheet,
} from './types';
import { IndexTracker } from './index-tracker';
import { normalizeLabel, parseLayerName, resolveInheritedParsedName } from './parser';
import { planRepeatFrame, type RepeatPlan } from './repeat-frame';
import { cacheComponent, cacheComponentSet, resolveComponentTarget } from './component-swap';
import { canHaveImageFill, isImageUrl } from './image-sync';
import { hasAnyParsedType, parseChainedSpecialTypes } from './special-types';
import { loadFontsForTextNode } from './text-sync';
import type { ScopeRoots } from './traversal';
import { resetGlobalFontCache, yieldToUI } from './performance';

export interface PlannedBinding {
  bindingId: string;
  rootId: string;
  path: number[];
  originalNodeId: string;
  expectedName: string;
  expectedType: string;
  worksheet?: string;
  label?: string;
  row?: number;
  value?: string;
  additionalValues: readonly string[];
  issueId?: string;
  skipReason?: string;
  /** Own-content fingerprint checked when this binding is retried after a failure. */
  fingerprint?: string;
}

export interface PlannedRepeat {
  rootId: string;
  path: readonly number[];
  originalNodeId: string;
  expectedName: string;
  worksheet: string;
  plan?: Readonly<RepeatPlan>;
  issueId?: string;
  skipReason?: string;
  /** Repeats in a replacement component exist only after its binding is applied. */
  afterBindingId?: string;
}

export interface PreparedSync {
  snapshot: SheetSnapshot;
  roots: ScopeRoots;
  preferences: InterpretationPreferences;
  summary: PreflightSummary;
  bindings: readonly PlannedBinding[];
  repeats: readonly PlannedRepeat[];
  /** Fingerprint of the resolved scope roots at the end of planning. */
  scopeFingerprint: string;
  missingRootIds: readonly string[];
  componentCache: ComponentCache;
}

export interface PrepareOptions {
  snapshot: SheetSnapshot;
  roots: ScopeRoots;
  preferences: InterpretationPreferences;
  signal?: { readonly aborted: boolean };
  onProgress?: (message: string, percent: number) => void;
}

function checkCancelled(signal?: { readonly aborted: boolean }): void {
  if (signal?.aborted) throw new Error('Sync cancelled.');
}

function ownNodeFingerprint(node: BaseNode, includeGeometry = true): unknown[] {
  const identity = [node.id, node.name, node.type, node.parent?.id];
  if (node.type === 'PAGE' || node.type === 'DOCUMENT') return identity;
  const scene = node as SceneNode;
  const style = scene as SceneNode & {
    fontName?: FontName | symbol; fontSize?: number; textAlignHorizontal?: string;
    textAlignVertical?: string; lineHeight?: unknown; letterSpacing?: unknown;
    strokes?: unknown; effects?: unknown; blendMode?: string; componentProperties?: unknown;
    opacity?: number; rotation?: number;
  };
  const fontName = scene.type === 'TEXT' ? style.fontName : undefined;
  return [
    ...identity,
    scene.visible, 'opacity' in scene ? style.opacity : undefined,
    ...(includeGeometry ? [scene.x, scene.y, scene.width, scene.height] : []),
    'rotation' in scene ? style.rotation : undefined,
    scene.type === 'TEXT' ? scene.characters : undefined,
    fontName === undefined ? undefined :
      typeof fontName === 'symbol' ? String(fontName) : fontName,
    scene.type === 'TEXT' ? style.fontSize : undefined,
    scene.type === 'TEXT' ? style.textAlignHorizontal : undefined,
    scene.type === 'TEXT' ? style.textAlignVertical : undefined,
    scene.type === 'TEXT' ? style.lineHeight : undefined,
    scene.type === 'TEXT' ? style.letterSpacing : undefined,
    'strokes' in scene ? style.strokes : undefined,
    'effects' in scene ? style.effects : undefined,
    'blendMode' in scene ? style.blendMode : undefined,
    'componentProperties' in scene ? style.componentProperties : undefined,
    'fills' in scene ? JSON.stringify(scene.fills) : undefined,
  ];
}

function scopeNodeFingerprint(node: BaseNode): unknown {
  return [...ownNodeFingerprint(node),
    'children' in node ? (node as ChildrenMixin).children.map((child) => scopeNodeFingerprint(child)) : undefined];
}

async function cooperativeFingerprint(
  node: BaseNode, checkpoint: { visited: number }, signal?: { readonly aborted: boolean }
): Promise<unknown> {
  if (++checkpoint.visited % 500 === 0) {
    await yieldToUI();
    checkCancelled(signal);
  }
  let mainComponentId: string | undefined;
  if (node.type === 'INSTANCE') {
    const component = await (node as InstanceNode).getMainComponentAsync();
    checkCancelled(signal);
    mainComponentId = component?.id;
  }
  const children: unknown[] = [];
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      children.push(await cooperativeFingerprint(child, checkpoint, signal));
    }
  }
  return [...ownNodeFingerprint(node), mainComponentId, children];
}

async function fingerprintNodes(nodes: readonly BaseNode[], signal?: { readonly aborted: boolean }): Promise<string> {
  const checkpoint = { visited: 0 };
  const values: unknown[] = [];
  for (const node of nodes) values.push(await cooperativeFingerprint(node, checkpoint, signal));
  checkCancelled(signal);
  return JSON.stringify(values);
}

/** Full subtree including geometry; used to tell whether an application changed anything. */
export function nodeFingerprint(node: BaseNode): string {
  return JSON.stringify(scopeNodeFingerprint(node));
}

/**
 * Only the properties a sync writes on this node. Descendants and position
 * are excluded on purpose: applying sibling or child bindings reflows
 * auto-layout and edits nested text, and neither makes this target stale.
 */
export function contentFingerprint(node: BaseNode): string {
  return JSON.stringify(ownNodeFingerprint(node, false));
}

/** Content fingerprint plus the current main component for instances. */
export async function targetFingerprint(node: BaseNode, signal?: { readonly aborted: boolean }): Promise<string> {
  let mainComponentId: string | undefined;
  if (node.type === 'INSTANCE') {
    const component = await (node as InstanceNode).getMainComponentAsync();
    checkCancelled(signal);
    mainComponentId = component?.id;
  }
  return JSON.stringify([...ownNodeFingerprint(node, false), mainComponentId]);
}

export function resolveWorksheet(snapshot: SheetSnapshot, name: string): Worksheet | undefined {
  const exact = snapshot.data.worksheets.filter((worksheet) => worksheet.name === name);
  if (exact.length === 1) return exact[0];
  const normalized = snapshot.data.worksheets.filter((worksheet) => normalizeLabel(worksheet.name) === normalizeLabel(name));
  return normalized.length === 1 ? normalized[0] : undefined;
}

function findLabel(worksheet: Worksheet, label: string): string | undefined {
  const normalized = worksheet.labels.filter((candidate) => normalizeLabel(candidate) === normalizeLabel(label));
  return normalized.length === 1 ? normalized[0] : undefined;
}

function issue(
  issues: PreflightIssue[], code: string, message: string, bindingId: string,
  node?: BaseNode, blocking = true
): string {
  const id = `${code}:${bindingId}:${issues.length}`;
  issues.push({ id, code, severity: blocking ? 'error' : 'warning', message,
    ...(node ? { layerId: node.id, layerName: node.name } : {}), blocking });
  return id;
}

async function collectComponents(
  node: BaseNode, cache: ComponentCache,
  checkpoint: { visited: number }, signal?: { readonly aborted: boolean }
): Promise<void> {
  if (++checkpoint.visited % 500 === 0) {
    await yieldToUI();
    checkCancelled(signal);
  }
  if (node.type === 'COMPONENT') {
    cacheComponent(cache, node as ComponentNode);
  }
  if (node.type === 'COMPONENT_SET') {
    cacheComponentSet(cache, node as ComponentSetNode);
  }
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      await collectComponents(child, cache, checkpoint, signal);
    }
  }
}

async function rootsForPlan(
  roots: ScopeRoots, signal?: { readonly aborted: boolean }
): Promise<{ nodes: BaseNode[]; missing: string[] }> {
  const nodes: BaseNode[] = [];
  const missing: string[] = [];
  for (const id of roots.rootIds) {
    checkCancelled(signal);
    const node = await figma.getNodeByIdAsync(id);
    checkCancelled(signal);
    if (!node || (roots.scope !== 'selection' && node.type !== 'PAGE') ||
      (roots.scope === 'selection' && (node.type === 'PAGE' || node.type === 'DOCUMENT'))) {
      missing.push(id);
      continue;
    }
    if (node.type === 'PAGE') {
      await (node as PageNode).loadAsync();
      checkCancelled(signal);
    }
    nodes.push(node);
  }
  return { nodes, missing };
}

/** Plan repeat children virtually; no clone, append, remove, or property setter runs here. */
export async function prepareSync(options: PrepareOptions): Promise<PreparedSync> {
  const { snapshot, roots, preferences, signal, onProgress } = options;
  checkCancelled(signal);
  resetGlobalFontCache();
  const resolved = await rootsForPlan(roots, signal);
  for (const page of figma.root.children) {
    checkCancelled(signal);
    await page.loadAsync();
    checkCancelled(signal);
  }
  // An edit inside the scope while the asynchronous plan is being assembled
  // must not produce a plan whose captured values and final fingerprint
  // disagree. Only the scope roots are fingerprinted: bindings are addressed
  // by path under them, so edits elsewhere in the document cannot stale the plan.
  const startingScopeFingerprint = await fingerprintNodes(resolved.nodes, signal);
  const issues: PreflightIssue[] = [];
  const repeats: RepeatChange[] = [];
  const bindings: PlannedBinding[] = [];
  const repeatOperations: PlannedRepeat[] = [];
  const defaultWorksheet = preferences.defaultWorksheet || snapshot.data.activeWorksheet;
  const dataForIndex = { ...snapshot.data, activeWorksheet: defaultWorksheet };
  const tracker = new IndexTracker(dataForIndex);
  const cache: ComponentCache = { components: new Map(), componentSets: new Map() };

  const componentCheckpoint = { visited: 0 };
  for (const page of figma.root.children) {
    checkCancelled(signal);
    await collectComponents(page, cache, componentCheckpoint, signal);
  }
  for (const id of resolved.missing) {
    issue(issues, 'missing-root', `Saved root ${id} no longer exists. The intended scope was retained.`, `root:${id}`);
  }
  if (resolved.nodes.length === 0) {
    issue(issues, 'no-roots', 'All saved roots are missing. Choose an explicit scope before syncing.', 'scope');
  }
  for (const diagnostic of snapshot.data.diagnostics ?? []) {
    issue(issues, diagnostic.code, diagnostic.message, `data:${issues.length}`, undefined, diagnostic.severity === 'error');
  }
  for (const worksheet of snapshot.data.worksheets) {
    for (const diagnostic of worksheet.diagnostics ?? []) {
      issue(issues, diagnostic.code, diagnostic.message, `data:${issues.length}`, undefined, diagnostic.severity === 'error');
    }
  }

  let visited = 0;
  async function visit(
    node: BaseNode, rootId: string, path: number[], ancestors: ParsedLayerName[], virtual: boolean,
    afterBindingId?: string
  ): Promise<void> {
    if (++visited % 500 === 0) {
      await yieldToUI();
      checkCancelled(signal);
    }
    if (node.type === 'DOCUMENT' || node.type === 'PAGE') {
      if ('children' in node) {
        const children = (node as ChildrenMixin).children;
        for (let i = 0; i < children.length; i++) await visit(children[i], rootId, [...path, i], ancestors, virtual, afterBindingId);
      }
      return;
    }
    const parsed = parseLayerName(node.name);
    if (parsed.isIgnored || ancestors.some((ancestor) => ancestor.isIgnored)) return;
    if (node.type === 'COMPONENT' && !parsed.forceInclude) return;
    const binding = resolveInheritedParsedName(parsed, ancestors);
    const bindingId = `${rootId}:${path.join('.') || 'root'}`;
    const nodeId = virtual ? `planned:${bindingId}` : node.id;

    let projectedSwapTarget: ComponentNode | undefined;
    if (parsed.hasBinding) {
      const entry: PlannedBinding = {
        bindingId, rootId, path: [...path], originalNodeId: nodeId,
        expectedName: node.name, expectedType: node.type,
        additionalValues: [],
        ...(!virtual ? { fingerprint: await targetFingerprint(node, signal) } : {}),
      };
      const worksheetName = binding.worksheet || defaultWorksheet;
      const worksheet = resolveWorksheet(snapshot, worksheetName);
      entry.worksheet = worksheetName;
      entry.label = binding.labels[0];
      if (!worksheet) {
        entry.issueId = issue(issues, 'missing-worksheet', `Worksheet "${worksheetName}" is unavailable or ambiguous.`, bindingId, node);
      } else if (binding.labels.length === 0) {
        entry.issueId = issue(issues, 'missing-label', 'Binding has no label.', bindingId, node);
      } else {
        const label = findLabel(worksheet, binding.labels[0]);
        if (!label) {
          entry.issueId = issue(issues, 'missing-label', `Label "${binding.labels[0]}" is unavailable or ambiguous in "${worksheet.name}".`, bindingId, node);
        } else {
          const resolvedIndex = tracker.resolveIndex(label, worksheet.name, binding.index ?? { type: 'increment' });
          if (!resolvedIndex.success) {
            entry.issueId = issue(issues, 'missing-row', resolvedIndex.error ?? 'No row available.', bindingId, node);
          } else {
            entry.worksheet = worksheet.name;
            entry.label = label;
            entry.row = resolvedIndex.index + 1;
            entry.value = resolvedIndex.value;
            entry.additionalValues = binding.labels.slice(1).map((additional) => {
              const matched = findLabel(worksheet, additional);
              if (!matched) {
                entry.issueId = issue(issues, 'missing-additional-label',
                  `Additional label "${additional}" is unavailable or ambiguous in "${worksheet.name}".`, bindingId, node);
                return '';
              }
              return worksheet.rows[matched]?.[resolvedIndex.index] ?? '';
            });
            if (node.type === 'TEXT') {
              const font = await loadFontsForTextNode(node as TextNode, { signal });
              checkCancelled(signal);
              if (!font.success) {
                entry.issueId = issue(issues, 'missing-font', font.error || 'Text layer uses an unavailable font.', bindingId, node);
              }
            } else if (node.type === 'INSTANCE' && resolvedIndex.value.trim() &&
              !(resolvedIndex.value.startsWith('/') &&
                hasAnyParsedType(parseChainedSpecialTypes(resolvedIndex.value.slice(1))))) {
              const target = await resolveComponentTarget(node as InstanceNode, resolvedIndex.value, cache);
              checkCancelled(signal);
              if (!target.target) entry.issueId = issue(issues, 'component-target', target.error ?? 'Component unavailable.', bindingId, node);
              else {
                const current = await (node as InstanceNode).getMainComponentAsync();
                checkCancelled(signal);
                if (current?.id !== target.target.id) projectedSwapTarget = target.target;
              }
            } else if (isImageUrl(resolvedIndex.value) && !canHaveImageFill(node as SceneNode)) {
              entry.issueId = issue(issues, 'image-target', 'This layer cannot receive an image fill.', bindingId, node);
            }
          }
        }
      }
      Object.freeze(entry.path);
      Object.freeze(entry.additionalValues);
      bindings.push(Object.freeze(entry));
    }

    if (!('children' in node)) return;
    let children = projectedSwapTarget
      ? [...projectedSwapTarget.children]
      : [...(node as ChildrenMixin).children];
    if (node.type === 'FRAME' && parsed.isRepeatFrame) {
      const worksheetName = binding.worksheet || defaultWorksheet;
      const worksheet = resolveWorksheet(snapshot, worksheetName);
      const operation: PlannedRepeat = {
        rootId, path: Object.freeze([...path]), originalNodeId: nodeId,
        expectedName: node.name, worksheet: worksheet?.name || worksheetName,
        afterBindingId,
      };
      if (!worksheet) {
        operation.skipReason = `Repeat worksheet "${worksheetName}" is unavailable or ambiguous.`;
        operation.issueId = issue(issues, 'repeat-worksheet', operation.skipReason, bindingId, node);
      } else {
        const plan = planRepeatFrame(node as FrameNode, worksheet);
        Object.freeze(plan.removeIds);
        operation.plan = Object.freeze(plan);
        repeats.push({
          layerId: nodeId, layerName: node.name, worksheet: worksheet.name,
          currentCount: plan.currentCount, targetCount: plan.targetCount,
          additions: plan.additions, removals: plan.removals, removeIds: [...plan.removeIds],
        });
        operation.skipReason = plan.error || plan.warning;
        if (plan.error) operation.issueId = issue(issues, 'repeat-invalid', plan.error, bindingId, node);
        if (plan.warning) operation.issueId = issue(issues, 'repeat-empty', plan.warning, bindingId, node, false);
        if (!plan.error && !plan.warning) {
          children = children.slice(0, plan.targetCount);
          while (children.length < plan.targetCount) children.push((node as FrameNode).children[0]);
        }
      }
      // Pre-order paths also identify repeats inside children that Apply will clone.
      repeatOperations.push(Object.freeze(operation));
    }
    const nextAncestors = [parsed, ...ancestors];
    for (let i = 0; i < children.length; i++) {
      const childVirtual = virtual || !!projectedSwapTarget || i >= (node as ChildrenMixin).children.length ||
        (node.type === 'FRAME' && parsed.isRepeatFrame && i >= (node as FrameNode).children.length);
      await visit(children[i], rootId, [...path, i], nextAncestors, childVirtual,
        projectedSwapTarget ? bindingId : afterBindingId);
    }
  }

  onProgress?.('Planning bindings...', 12);
  for (const node of resolved.nodes) {
    const ancestors: ParsedLayerName[] = [];
    let parent = node.parent;
    while (parent && parent.type !== 'DOCUMENT') {
      if (parent.type !== 'PAGE') ancestors.push(parseLayerName(parent.name));
      parent = parent.parent;
    }
    if (ancestors.some((ancestor) => ancestor.isIgnored)) continue;
    await visit(node, node.id, [], ancestors, false);
  }
  checkCancelled(signal);
  const preflightId = `${snapshot.id}:${Date.now()}:${Math.floor(Math.random() * 1e9)}`;
  const summary: PreflightSummary = {
    preflightId, snapshotId: snapshot.id, sourceUrl: snapshot.sourceUrl,
    scope: roots.scope as SyncScope, rootIds: [...roots.rootIds], defaultWorksheet,
    preferences, totalBindings: bindings.length,
    matchedBindings: bindings.filter((entry) => entry.value !== undefined && !entry.issueId).length,
    issues, repeats,
    requiresConfirmation: repeats.some((repeat) => repeat.removals > 0) || issues.length > 0,
  };
  const scopeFingerprint = await fingerprintNodes(resolved.nodes, signal);
  if (scopeFingerprint !== startingScopeFingerprint) {
    throw new Error('The sync scope changed during preflight. Refresh the proposed changes.');
  }
  return { snapshot, roots, preferences, summary, bindings: Object.freeze(bindings),
    repeats: Object.freeze(repeatOperations),
    scopeFingerprint, missingRootIds: Object.freeze([...resolved.missing]), componentCache: cache };
}

export async function preflightIsCurrent(
  plan: PreparedSync, signal?: { readonly aborted: boolean }
): Promise<boolean> {
  const current = await rootsForPlan(plan.roots, signal);
  checkCancelled(signal);
  return current.missing.join('|') === plan.missingRootIds.join('|') &&
    (await fingerprintNodes(current.nodes, signal)) === plan.scopeFingerprint;
}

export async function resolvePlannedNode(entry: { rootId: string; path: readonly number[] }): Promise<SceneNode | null> {
  let node = await figma.getNodeByIdAsync(entry.rootId);
  for (const index of entry.path) {
    if (!node || !('children' in node)) return null;
    node = (node as ChildrenMixin).children[index] ?? null;
  }
  if (!node || node.type === 'PAGE' || node.type === 'DOCUMENT') return null;
  return node as SceneNode;
}

export function outcomeForIssue(entry: PlannedBinding): LayerOutcome {
  return {
    bindingId: entry.bindingId, layerId: entry.originalNodeId,
    layerName: entry.expectedName, status: 'skipped',
    message: entry.issueId ? 'Excluded unresolved preflight issue.' : entry.skipReason,
    worksheet: entry.worksheet, label: entry.label, resolvedRow: entry.row,
  };
}
