import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import {
  IconNavigateBack24,
  IconNavigateForward24,
} from '@create-figma-plugin/ui';
import {
  ActionButton,
  IconButton,
  LiveRegion,
  Notice,
  SettingsButton,
} from './components';
import {
  state,
  worksheet,
  defaultWorksheet,
  binding,
  browse,
  changePage,
  backToInput,
  fetchStart,
  syncStart,
} from './controller';

const ROWS = 100;
const MAX_CELLS = 2000;

function activateCell(
  event: JSX.TargetedKeyboardEvent<HTMLElement>,
  action: () => void,
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

function WorksheetTabs() {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const sheets = state.data?.worksheets || [];
  function navigate(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sheets.length - 1
          : Math.max(
              0,
              Math.min(
                sheets.length - 1,
                index + (event.key === 'ArrowLeft' ? -1 : 1),
              ),
            );
    event.preventDefault();
    browse(sheets[next].name);
    tabs.current[next]?.focus();
  }
  return (
    <div className="worksheet-bar">
      <div className="worksheet-tabs" role="tablist">
        {sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            type="button"
            ref={(node) => {
              tabs.current[index] = node;
            }}
            className={`plain-button tab ${sheet.name === state.browsing ? 'active' : ''}`}
            role="tab"
            aria-selected={sheet.name === state.browsing}
            tabIndex={sheet.name === state.browsing ? 0 : -1}
            onClick={() => browse(sheet.name)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      {state.hasSelection &&
        state.browsing &&
        state.browsing !== defaultWorksheet() && (
          <div className="worksheet-bind-host">
            <ActionButton
              id="bind-worksheet-btn"
              className="worksheet-bind-action"
              title={`Add an explicit ${state.browsing} worksheet binding to the selected layers`}
              onClick={() =>
                binding({ type: 'worksheet', worksheet: state.browsing })
              }
            >
              {`Use ${state.browsing} for selected layers`}
            </ActionButton>
          </div>
        )}
    </div>
  );
}

function Pager({
  kind,
  current,
  pageSize,
  total,
}: {
  kind: 'row' | 'column';
  current: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;
  const plural = kind === 'row' ? 'Rows' : 'Columns';
  const first = current * pageSize + 1;
  const last = Math.min(total, first + pageSize - 1);
  return (
    <div className="pagination-group">
      <IconButton
        id={`${kind}-prev-btn`}
        label={`Previous ${plural.toLowerCase()}`}
        disabled={current === 0}
        onClick={() => changePage(kind, current - 1)}
      >
        <IconNavigateBack24 />
      </IconButton>
      <span className="pagination-label">{`${plural} ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}</span>
      <IconButton
        id={`${kind}-next-btn`}
        label={`Next ${plural.toLowerCase()}`}
        disabled={current >= pages - 1}
        onClick={() => changePage(kind, current + 1)}
      >
        <IconNavigateForward24 />
      </IconButton>
    </div>
  );
}

function DataTable() {
  const sheet = worksheet();
  if (!sheet || !sheet.labels.length)
    return (
      <div className="preview-table-container">
        <p className="preview-empty">No columns found in this worksheet.</p>
      </div>
    );
  const rowCount = Math.max(
    0,
    ...sheet.labels.map((label) => sheet.rows[label]?.length || 0),
  );
  const columnsPerPage = Math.max(
    1,
    Math.floor(MAX_CELLS / Math.max(1, Math.min(ROWS, rowCount || 1))),
  );
  const labels = sheet.labels.slice(
    state.colPage * columnsPerPage,
    (state.colPage + 1) * columnsPerPage,
  );
  const firstRow = state.rowPage * ROWS;
  const visibleRows = Array.from(
    { length: Math.min(ROWS, Math.max(0, rowCount - firstRow)) },
    (_, offset) => firstRow + offset + 1,
  );
  return (
    <div className="preview-table-container">
      <div className="preview-table-scroll">
        <table className="preview-table">
          <thead>
            <tr>
              <th className="index-header">#</th>
              {labels.map((label, column) => {
                const action = () => binding({ type: 'label', label });
                return (
                  <th
                    key={column}
                    className="clickable-header"
                    tabIndex={0}
                    role="button"
                    title={`Apply ${label} to selected layers`}
                    onClick={action}
                    onKeyDown={(event) => activateCell(event, action)}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((index) => {
              const selectRow = () =>
                binding({
                  type: 'index',
                  index: { type: 'specific', value: index },
                });
              return (
                <tr key={index}>
                  <td
                    className="index-cell clickable"
                    tabIndex={0}
                    onClick={selectRow}
                    onKeyDown={(event) => activateCell(event, selectRow)}
                  >
                    {index}
                  </td>
                  {labels.map((label, column) => {
                    const value = sheet.rows[label]?.[index - 1] || '';
                    const action = () =>
                      binding({ type: 'label', label, row: index });
                    return (
                      <td
                        key={column}
                        className="value-cell clickable"
                        tabIndex={0}
                        aria-label={`${label} row ${index}: ${value || 'empty'}`}
                        onClick={action}
                        onKeyDown={(event) => activateCell(event, action)}
                      >
                        {value || '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(rowCount > ROWS || sheet.labels.length > columnsPerPage) && (
        <div className="table-pagination">
          <Pager
            kind="row"
            current={state.rowPage}
            pageSize={ROWS}
            total={rowCount}
          />
          <Pager
            kind="column"
            current={state.colPage}
            pageSize={columnsPerPage}
            total={sheet.labels.length}
          />
        </div>
      )}
    </div>
  );
}

export function Preview() {
  return (
    <div className="plugin-container preview-mode">
      <header>
        <IconButton id="back-btn" label="Back" onClick={backToInput}>
          <IconNavigateBack24 />
        </IconButton>
        <h1>Preview data</h1>
        <SettingsButton />
      </header>
      <main>
        {state.error && <Notice message={state.error} />}
        <div className="preview-info">
          <div className="preview-metadata">
            <span className="worksheet-name">{state.browsing}</span>
            <span className="separator">•</span>
            <span>{worksheet()?.labels.length || 0} columns</span>
            <span className="separator">•</span>
            <span>
              {state.snapshot
                ? `Fetched ${Math.floor((Date.now() - state.snapshot.fetchedAt) / 1000)}s ago`
                : 'No snapshot'}
            </span>
          </div>
        </div>
        <DataTable />
      </main>
      <WorksheetTabs />
      <footer className="actions">
        <ActionButton id="refresh-btn" onClick={() => fetchStart(false)}>
          Refresh
        </ActionButton>
        <ActionButton id="sync-preview-btn" primary onClick={syncStart}>
          Review sync
        </ActionButton>
      </footer>
      <LiveRegion />
    </div>
  );
}
