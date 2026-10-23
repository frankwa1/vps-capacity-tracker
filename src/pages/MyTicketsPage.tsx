import { Fragment, useEffect, useMemo, useState } from "react";
import { formatHours, isDoneIssue } from "../capacity";
import type { NewOpenTicket, UpdateJiraResult } from "../jira";
import { ALL_SPRINTS_ID, displayStatus, issueUrl, statusClass, ticketNumber } from "../ui";
import type { JiraIssue, MergeEnvStatus } from "../types";

type TicketGroup = {
  parentKey: string;
  parentSummary: string;
  issues: JiraIssue[];
};

type SortColumn = "ticket" | "description" | "subtask" | "status" | "sprint" | "estimate";
type SortDir = "asc" | "desc";

const SORT_COLUMNS: { id: SortColumn; label: string }[] = [
  { id: "ticket", label: "Ticket" },
  { id: "description", label: "Description" },
  { id: "subtask", label: "Subtask" },
  { id: "status", label: "Status" },
  { id: "sprint", label: "Sprint" },
  { id: "estimate", label: "Estimated Hours" },
];

function groupStatusText(group: TicketGroup, mergeStatuses: Record<string, MergeEnvStatus>): string {
  // Status is about the parent ticket (QA1/QA2 from merge), not each subtask's To Do.
  const parentStatus = displayStatus(
    { key: group.parentKey, parentKey: group.parentKey, status: group.issues[0]?.status || "" },
    mergeStatuses
  );
  if (parentStatus === "QA1" || parentStatus === "QA2") return parentStatus;
  const statuses = [
    ...new Set(group.issues.map((issue) => displayStatus(issue, mergeStatuses)).filter(Boolean)),
  ];
  const qa = statuses.find((status) => status === "QA1" || status === "QA2");
  if (qa) return qa;
  return statuses.join(", ") || "—";
}

function groupSprintText(group: TicketGroup): string {
  return [...new Set(group.issues.map((issue) => issue.sprintName || "").filter(Boolean))].join(", ") || "—";
}

function groupEstimateSeconds(group: TicketGroup): number {
  return group.issues.reduce((sum, issue) => sum + (issue.originalSeconds || 0), 0);
}

function compareGroups(
  a: TicketGroup,
  b: TicketGroup,
  column: SortColumn,
  dir: SortDir,
  mergeStatuses: Record<string, MergeEnvStatus>
): number {
  const sign = dir === "asc" ? 1 : -1;
  let cmp = 0;
  if (column === "ticket") {
    cmp = ticketNumber(a.parentKey) - ticketNumber(b.parentKey) || a.parentKey.localeCompare(b.parentKey);
  } else if (column === "description") {
    cmp = a.parentSummary.localeCompare(b.parentSummary, undefined, { sensitivity: "base" });
  } else if (column === "subtask") {
    const subA = a.issues[0]?.key || "";
    const subB = b.issues[0]?.key || "";
    cmp = ticketNumber(subA) - ticketNumber(subB) || subA.localeCompare(subB);
  } else if (column === "status") {
    cmp = groupStatusText(a, mergeStatuses).localeCompare(groupStatusText(b, mergeStatuses), undefined, {
      sensitivity: "base",
    });
  } else if (column === "sprint") {
    cmp = groupSprintText(a).localeCompare(groupSprintText(b), undefined, { sensitivity: "base" });
  } else {
    cmp = groupEstimateSeconds(a) - groupEstimateSeconds(b);
  }
  if (cmp !== 0) return sign * cmp;
  return ticketNumber(b.parentKey) - ticketNumber(a.parentKey) || b.parentKey.localeCompare(a.parentKey);
}

export function MyTicketsPage(props: {
  issues: JiraIssue[];
  me: string;
  meAccountId: string | null;
  sprintId: number | null;
  baseUrl: string;
  error: string | null;
  updateError: string | null;
  updateResults: UpdateJiraResult[] | null;
  newTickets: NewOpenTicket[] | null;
  loading: boolean;
  updatingJira: boolean;
  updatingHours: boolean;
  loadingNewTickets: boolean;
  refreshedAt: Date | null;
  mergeStatuses: Record<string, MergeEnvStatus>;
  onUpdateHours: (issues: JiraIssue[], hours: number) => void;
  onGetSelectedVpsNumbers: (numbers: string) => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [hoursInput, setHoursInput] = useState("2");
  const [sortColumn, setSortColumn] = useState<SortColumn>("ticket");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const myTickets = useMemo(() => {
    return props.issues.filter((issue) => {
      // All = open tickets only; a specific sprint includes Done work assigned to me.
      if (props.sprintId === ALL_SPRINTS_ID && isDoneIssue(issue)) return false;
      return props.meAccountId
        ? issue.accountId === props.meAccountId
        : Boolean(props.me && issue.displayName === props.me);
    });
  }, [props.issues, props.me, props.meAccountId, props.sprintId]);

  /** One row per parent; multiple of my subtasks are concatenated with links. */
  const ticketGroups = useMemo(() => {
    const groups: TicketGroup[] = [];
    const byParent = new Map<string, TicketGroup>();
    for (const issue of myTickets) {
      const parentKey = issue.parentKey || issue.key;
      let group = byParent.get(parentKey);
      if (!group) {
        group = {
          parentKey,
          parentSummary: issue.parentKey ? issue.parentSummary || "" : issue.summary,
          issues: [],
        };
        byParent.set(parentKey, group);
        groups.push(group);
      }
      group.issues.push(issue);
    }
    for (const group of groups) {
      group.issues.sort(
        (a, b) => ticketNumber(a.key) - ticketNumber(b.key) || a.key.localeCompare(b.key)
      );
    }
    return groups
      .slice()
      .sort((a, b) => compareGroups(a, b, sortColumn, sortDir, props.mergeStatuses));
  }, [myTickets, sortColumn, sortDir, props.mergeStatuses]);

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDir(column === "ticket" || column === "subtask" || column === "estimate" ? "desc" : "asc");
  }

  useEffect(() => {
    const visible = new Set(myTickets.map((issue) => issue.key));
    setSelectedKeys((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of current) {
        if (visible.has(key)) next.add(key);
        else changed = true;
      }
      return changed || next.size !== current.size ? next : current;
    });
  }, [myTickets]);

  const allSelected = myTickets.length > 0 && selectedKeys.size === myTickets.length;
  const targetTickets = selectedKeys.size > 0
    ? myTickets.filter((issue) => selectedKeys.has(issue.key))
    : myTickets;
  const hoursValue = Number(hoursInput);
  const estimateSeconds = Number.isFinite(hoursValue) && hoursValue > 0 ? Math.round(hoursValue * 3600) : null;
  const differingCount =
    estimateSeconds == null
      ? 0
      : targetTickets.filter((issue) => Number(issue.originalSeconds || 0) !== estimateSeconds).length;

  function toggleGroup(keys: string[]) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      const allOn = keys.every((key) => next.has(key));
      for (const key of keys) {
        if (allOn) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(myTickets.map((issue) => issue.key)));
  }

  return (
    <main className="main my-tickets-page">
      {props.error ? <div className="error">{props.error}</div> : null}
      <h2 className="section-title">My open tickets</h2>
      <p className="hint">
        {props.sprintId === ALL_SPRINTS_ID
          ? "Incomplete work assigned to you across sprints. Click a column header to sort."
          : "All work assigned to you in the selected sprint (including Done). Click a column header to sort."}
      </p>
      {props.updateError ? <div className="error">{props.updateError}</div> : null}
      {props.updateResults ? (
        <div className="update-jira-results">
          {props.updateResults.map((result, index) => (
            <div key={`${result.parentKey}-${result.issueKey || "none"}-${index}`} className={result.ok ? "ok" : "bad"}>
              {result.parentKey}
              {result.issueKey ? ` → ${result.issueKey}` : ""}: {result.message}
            </div>
          ))}
        </div>
      ) : null}

      {props.loadingNewTickets ? <div className="hint">Loading new tickets…</div> : null}
      {props.newTickets && props.newTickets.length > 0 ? (
        <div className="new-tickets-panel">
          <h2 className="section-title">New tickets (last 3 days)</h2>
          <div className="new-tickets-grid">
            {props.newTickets.map((ticket) => (
              <div className="new-ticket-row" key={ticket.key}>
                <a href={issueUrl(props.baseUrl, ticket.key)} target="_blank" rel="noreferrer">
                  {ticket.key}
                </a>
                <span className="ticket-parent-title" title={ticket.summary}>
                  {ticket.summary || "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!props.meAccountId && !props.me && !props.loading ? (
        <div className="empty">Connect Jira in Settings to see your tickets.</div>
      ) : myTickets.length === 0 && !props.loading ? (
        <div className="empty">
          {props.sprintId === ALL_SPRINTS_ID
            ? "No incomplete tickets assigned to you."
            : "No tickets assigned to you in this sprint."}
        </div>
      ) : (
        <>
          <div className="my-tickets-actions">
            <span className="my-tickets-selection-hint">
              {selectedKeys.size > 0
                ? `${selectedKeys.size} selected`
                : "None selected — Update Hours applies to all"}
            </span>
            <label className="my-tickets-hours">
              Hours
              <input
                type="number"
                min="0.25"
                step="0.25"
                className="my-tickets-hours-input"
                value={hoursInput}
                disabled={props.updatingHours || props.updatingJira || props.loading}
                onChange={(e) => setHoursInput(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={props.updatingHours || props.updatingJira || props.loading || myTickets.length === 0}
              onClick={() => {
                const hours = Number(hoursInput);
                if (!Number.isFinite(hours) || hours <= 0) return;
                props.onUpdateHours(targetTickets, hours);
              }}
              title={
                differingCount
                  ? `Update ${differingCount} subtask(s) to ${hoursInput || "2"}h`
                  : `All targeted subtasks already have ${hoursInput || "2"}h`
              }
            >
              {props.updatingHours ? "Updating hours..." : "Update Hours"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={props.updatingHours || props.updatingJira || props.loading || selectedKeys.size === 0}
              onClick={() => {
                const seen = new Set<string>();
                const numbers: string[] = [];
                for (const issue of myTickets) {
                  if (!selectedKeys.has(issue.key)) continue;
                  const parentKey = issue.parentKey || issue.key;
                  const num = String(ticketNumber(parentKey) || "");
                  if (!num || seen.has(num)) continue;
                  seen.add(num);
                  numbers.push(num);
                }
                props.onGetSelectedVpsNumbers(numbers.join(","));
              }}
              title="Copy checked parent ticket numbers into the Update Jira field"
            >
              Get selected VPS numbers
            </button>
          </div>
          <div className="tickets my-ticket-list">
            <div className="my-ticket my-ticket-header">
              <label className="my-ticket-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all tickets"
                />
              </label>
              {SORT_COLUMNS.map((column) => {
                const active = sortColumn === column.id;
                return (
                  <button
                    key={column.id}
                    type="button"
                    className={`my-ticket-sort${active ? " active" : ""}`}
                    onClick={() => toggleSort(column.id)}
                    aria-label={`Sort by ${column.label}`}
                  >
                    {column.label}
                    <span className="my-ticket-sort-indicator" aria-hidden="true">
                      {active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            {ticketGroups.map((group) => {
              const keys = group.issues.map((issue) => issue.key);
              const selected = keys.every((key) => selectedKeys.has(key));
              const status = groupStatusText(group, props.mergeStatuses);
              const sprint = groupSprintText(group);
              const estimateSecondsTotal = groupEstimateSeconds(group);
              return (
                <div className={`my-ticket${selected ? " selected" : ""}`} key={group.parentKey}>
                  <label className="my-ticket-check">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleGroup(keys)}
                      aria-label={`Select ${group.parentKey}`}
                    />
                  </label>
                  <a href={issueUrl(props.baseUrl, group.parentKey)} target="_blank" rel="noreferrer">
                    {group.parentKey}
                  </a>
                  <span className="ticket-parent-title" title={group.parentSummary}>
                    {group.parentSummary}
                  </span>
                  <span className="my-ticket-subtasks">
                    {group.issues.map((issue, index) => (
                      <Fragment key={issue.key}>
                        {index > 0 ? ", " : null}
                        <a href={issueUrl(props.baseUrl, issue.key)} target="_blank" rel="noreferrer">
                          {issue.key}
                        </a>
                      </Fragment>
                    ))}
                  </span>
                  <span className={statusClass(status)}>{status}</span>
                  <span className="my-ticket-sprint" title={sprint}>
                    {sprint}
                  </span>
                  <span className={`my-ticket-estimate${!estimateSecondsTotal ? " zero" : ""}`}>
                    {formatHours(estimateSecondsTotal / 3600)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <div className="footer">
        Last refreshed {props.refreshedAt ? props.refreshedAt.toLocaleString() : "never"}
        {props.loading || props.updatingJira || props.updatingHours || props.loadingNewTickets ? " — loading…" : ""}
      </div>
    </main>
  );
}
