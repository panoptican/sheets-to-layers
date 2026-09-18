import { useLayoutEffect, useReducer, useState } from 'preact/hooks';
import { Checkbox, SegmentedControl, Textbox } from '@create-figma-plugin/ui';
import type { LayerOutcome, SyncScope } from '../core/types';
import {
  groupOutcomes,
  groupWarnings,
  outcomeCountsText,
  repeatSummaryText,
  summarizeRepeats,
  unrepresentedErrors,
  warningGroupText,
  type OutcomeGroup,
} from '../core/result-summary';
import { ActionButton, LiveRegion, Notice, SettingsButton } from './components';
import { Preview } from './preview';
import { SettingsDialog } from './settings-dialog';
import {
  state,
  subscribe,
  connect,
  setUrl,
  setScope,
  fetchStart,
  cancel,
  apply,
  retry,
  excludeIssue,
  backFromReview,
  backToPreview,
  selectLayer,
} from './controller';

function Input() {
  const options = [
    { value: 'document', children: 'Entire document' },
    { value: 'page', children: 'Current page' },
    ...(state.hasSelection
      ? [{ value: 'selection', children: 'Current selection' }]
      : []),
  ];
  return (
    <div className="plugin-container">
      <header>
        <h1 id="plugin-title">Sheets to Layers</h1>
      </header>
      <main>
        <section className="url-input">
          <label className="field-label" htmlFor="sheets-url">
            Google Sheets URL
          </label>
          <Textbox
            id="sheets-url"
            value={state.url}
            placeholder="Paste your shareable Google Sheets link"
            onValueInput={setUrl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') fetchStart(true);
            }}
          />
        </section>
        <section className="scope-selection">
          <div className="field-label">Sync scope</div>
          <div className="scope-control">
            <SegmentedControl
              value={state.scope}
              options={options}
              onValueChange={(value) => setScope(value as SyncScope)}
            />
          </div>
        </section>
        {state.error && <Notice message={state.error} />}
      </main>
      <footer className="actions">
        <ActionButton id="fetch-btn" onClick={() => fetchStart(false)}>
          Fetch
        </ActionButton>
        <ActionButton id="sync-btn" primary onClick={() => fetchStart(true)}>
          Fetch &amp; Sync
        </ActionButton>
      </footer>
      <LiveRegion />
    </div>
  );
}

function Running() {
  return (
    <div className="plugin-container syncing">
      <main>
        <div className="progress-container">
          <div className="progress-track">
            <div
              className="progress-bar"
              style={{
                width: `${Math.min(100, Math.max(0, state.progress.value))}%`,
              }}
            />
          </div>
          <p className="progress-text">
            {state.progress.message || 'Working…'}
          </p>
        </div>
      </main>
      <footer className="actions">
        <ActionButton id="cancel-sync-btn" onClick={cancel}>
          Cancel
        </ActionButton>
      </footer>
      <LiveRegion />
    </div>
  );
}

function Review() {
  const plan = state.preflight;
  const orientationChoices = Object.entries(
    plan?.preferences.orientations || {},
  )
    .map(
      ([name, orientation]) =>
        `${name}: ${orientation === 'columns' ? 'headers in first row' : 'headers in first column'}`,
    )
    .join('; ');
  const entries: Array<[string, string, string?]> = plan
    ? [
        ['Source', plan.sourceUrl, 'preflight-source'],
        [
          'Scope',
          `${plan.scope === 'document' ? 'Entire document' : plan.scope === 'page' ? 'Current page' : 'Current selection'} (${plan.rootIds.length} ${plan.rootIds.length === 1 ? 'root' : 'roots'})`,
        ],
        ['Default worksheet', plan.defaultWorksheet],
        [
          'Data orientation',
          orientationChoices ||
            'Auto-detect headers in the first row or first column',
        ],
        [
          'Blank text',
          plan.preferences.blankText === 'leave-unchanged'
            ? 'Leave blank text unchanged'
            : 'Clear and hide blank text',
        ],
      ]
    : [];
  const applyDisabled =
    !plan ||
    plan.issues.some(
      (issue) => issue.blocking && !state.excluded.has(issue.id),
    );
  return (
    <div className="plugin-container preview-mode preflight-mode">
      <header>
        <h1>Review sync</h1>
        <SettingsButton />
      </header>
      <main>
        {!plan ? (
          <Notice message="No proposed changes are available." />
        ) : (
          <>
            <dl className="preflight-details">
              {entries.map(([term, value, className]) => (
                <>
                  <dt key={`${term}-term`}>{term}</dt>
                  <dd key={term} className={className}>
                    {value}
                  </dd>
                </>
              ))}
            </dl>
            {summarizeRepeats(plan.repeats).map((line) => (
              <p key={line.key} className="repeat-change">
                {repeatSummaryText(line)}
              </p>
            ))}
            {plan.issues.map((issue) => (
              <div
                key={issue.id}
                className={`issue ${issue.blocking ? 'blocking' : ''}`}
              >
                <Checkbox
                  id={`preflight-issue-${issue.id}`}
                  value={state.excluded.has(issue.id)}
                  onValueChange={(checked) => excludeIssue(issue.id, checked)}
                >
                  {`Exclude ${issue.blocking ? 'blocking ' : ''}issue: ${issue.message}`}
                </Checkbox>
              </div>
            ))}
          </>
        )}
      </main>
      <footer className="actions">
        <ActionButton id="preflight-back-btn" onClick={backFromReview}>
          Back
        </ActionButton>
        <ActionButton
          id="apply-btn"
          primary
          disabled={applyDisabled}
          onClick={apply}
        >
          Sync layers
        </ActionButton>
      </footer>
      <LiveRegion />
    </div>
  );
}

function OutcomeRow({ outcome }: { outcome: LayerOutcome }) {
  return (
    <button
      type="button"
      className={`plain-button outcome ${outcome.status}`}
      onClick={() => selectLayer(outcome.layerId)}
      aria-label={`Select ${outcome.layerName}, ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`}
    >
      {`${outcome.layerName}: ${outcome.status}${outcome.message ? ` — ${outcome.message}` : ''}`}
    </button>
  );
}

/** Rows revealed per click inside an expanded group. */
const OUTCOME_PAGE_SIZE = 200;

/**
 * One collapsed row per layer name. Groups that need attention (failed or
 * skipped) start expanded; the rest expand on demand and page their rows.
 */
function OutcomeGroupView({ group }: { group: OutcomeGroup }) {
  const needsAttention = group.counts.failed > 0 || group.counts.skipped > 0;
  const [open, setOpen] = useState(needsAttention);
  const [limit, setLimit] = useState(OUTCOME_PAGE_SIZE);
  const total = group.outcomes.length;
  const remaining = Math.max(0, total - limit);
  return (
    <section className={`outcome-group ${group.status}`}>
      <button
        type="button"
        className="plain-button outcome-group-header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="outcome-group-disclosure" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="outcome-group-name">{group.name}</span>
        <span className="outcome-group-counts">
          {outcomeCountsText(group.counts)}
        </span>
      </button>
      {open && (
        <div className="outcome-group-rows">
          {group.outcomes.slice(0, limit).map((outcome) => (
            <OutcomeRow key={outcome.bindingId} outcome={outcome} />
          ))}
          {remaining > 0 && (
            <button
              type="button"
              className="plain-button outcome-group-more"
              onClick={() => setLimit(limit + OUTCOME_PAGE_SIZE)}
            >
              {`Show ${Math.min(remaining, OUTCOME_PAGE_SIZE)} more of ${remaining} remaining`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Result() {
  const result = state.result;
  return (
    <div className="plugin-container preview-mode">
      <header>
        <h1>Sync result</h1>
      </header>
      <main>
        {result && (
          <>
            <p className="result-summary">{`${result.status}: ${result.counts.changed} changed, ${result.counts.unchanged} unchanged, ${result.counts.skipped} skipped, ${result.counts.failed} failed.`}</p>
            {groupOutcomes(result.outcomes).map((group) =>
              group.outcomes.length === 1 ? (
                <OutcomeRow key={group.key} outcome={group.outcomes[0]} />
              ) : (
                <OutcomeGroupView key={group.key} group={group} />
              ),
            )}
            {groupWarnings(result.warnings).map((group) => (
              <p key={group.key} className="result-warning">
                {warningGroupText(group)}
              </p>
            ))}
            {unrepresentedErrors(result).map((error, index) => (
              <p key={index} className="result-error">
                {error.layerName ? `${error.layerName}: ${error.error}` : error.error}
              </p>
            ))}
          </>
        )}
      </main>
      <footer className="actions">
        <ActionButton id="result-back-btn" onClick={backToPreview}>
          Back to preview
        </ActionButton>
        {!!result?.counts.failed && (
          <ActionButton id="retry-btn" primary onClick={retry}>
            Retry failed
          </ActionButton>
        )}
      </footer>
      <LiveRegion />
    </div>
  );
}

export function App() {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(() => {
    const unsubscribe = subscribe(() => refresh(undefined));
    const disconnect = connect();
    return () => {
      disconnect();
      unsubscribe();
    };
  }, []);
  return (
    <>
      {state.mode === 'input' ? (
        <Input />
      ) : state.mode === 'preview' ? (
        <Preview />
      ) : state.mode === 'running' ? (
        <Running />
      ) : state.mode === 'preflight' ? (
        <Review />
      ) : (
        <Result />
      )}
      {(state.mode === 'preview' || state.mode === 'preflight') &&
        state.previewSettings && (
          <SettingsDialog initialPreferences={state.previewSettings} />
        )}
    </>
  );
}
