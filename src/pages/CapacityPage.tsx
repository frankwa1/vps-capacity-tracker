import { formatHours, initials, type MemberRow } from "../capacity";
import { CapacityRow } from "../components/CapacityRow";
import { TeamSidebar } from "../components/TeamSidebar";
import { ALL_SPRINTS_ID, displayStatus, issueUrl, statusClass } from "../ui";
import type { MemberRole, MergeEnvStatus, TeamConfig } from "../types";

export function CapacityPage(props: {
  team: TeamConfig;
  workDates: string[];
  sprintDates: string[];
  people: MemberRow[];
  rows: MemberRow[];
  teamLoad: number;
  teamCapacity: number;
  teamPct: number;
  sprintId: number | null;
  openId: string | null;
  baseUrl: string;
  error: string | null;
  loading: boolean;
  refreshedAt: Date | null;
  mergeStatuses: Record<string, MergeEnvStatus>;
  onToggleWeekday: (index: number) => void;
  onCycleHoliday: (iso: string) => void;
  onCyclePersonal: (accountId: string, iso: string) => void;
  onSetRole: (accountId: string, role: MemberRole | "") => void;
  onSetDailyHours: (accountId: string, dailyHours: number) => void;
  onToggleRow: (id: string) => void;
}) {
  return (
    <div className="layout">
      <TeamSidebar
        team={props.team}
        workDates={props.workDates}
        sprintDates={props.sprintDates}
        people={props.people}
        onToggleWeekday={props.onToggleWeekday}
        onCycleHoliday={props.onCycleHoliday}
        onCyclePersonal={props.onCyclePersonal}
        onSetRole={props.onSetRole}
        onSetDailyHours={props.onSetDailyHours}
      />

      <main className="main">
        {props.error ? <div className="error">{props.error}</div> : null}
        <h2 className="section-title">Team members capacity</h2>
        {props.sprintId === ALL_SPRINTS_ID ? (
          <div className="empty">Select a specific sprint to view team capacity. Use All on the My tickets page.</div>
        ) : (
          <>
            <p className="hint">Load = remaining estimate hours. Click a row for ticket details.</p>
            {props.rows.length <= 1 && !props.loading ? (
              <div className="empty">Connect Jira in Settings, then refresh a sprint to see capacity.</div>
            ) : (
              <div className="board">
                <CapacityRow
                  name="Team + Unassigned"
                  avatar="TM"
                  subtitle={`${props.people.length} people`}
                  loadHours={props.teamLoad}
                  capacityHours={props.teamCapacity}
                  pct={props.teamPct}
                  open={false}
                  onClick={() => undefined}
                  clickable={false}
                />
                {props.rows.map((row) => {
                  const id = row.accountId || "unassigned";
                  const pct =
                    row.capacityHours > 0
                      ? (row.loadHours / row.capacityHours) * 100
                      : row.loadHours > 0
                        ? 100
                        : 0;
                  return (
                    <div key={id}>
                      <CapacityRow
                        name={row.displayName}
                        avatar={initials(row.displayName)}
                        subtitle={
                          row.accountId
                            ? `${row.remainingDays.toFixed(row.remainingDays % 1 ? 1 : 0)} remaining working days`
                            : `${row.issues.length} tickets`
                        }
                        loadHours={row.loadHours}
                        capacityHours={row.capacityHours}
                        pct={pct}
                        open={props.openId === id}
                        onClick={() => props.onToggleRow(id)}
                      />
                      {props.openId === id ? (
                        <div className="tickets">
                          {row.issues.length === 0 ? <div className="meta">No tickets in this sprint.</div> : null}
                          {row.issues.map((issue) => {
                            const status = displayStatus(issue, props.mergeStatuses);
                            return (
                              <div className="ticket" key={issue.key}>
                                {issue.parentKey ? (
                                  <>
                                    <a href={issueUrl(props.baseUrl, issue.parentKey)} target="_blank" rel="noreferrer">
                                      {issue.parentKey}
                                    </a>
                                    <span className="ticket-parent-title" title={issue.parentSummary || ""}>
                                      {issue.parentSummary}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span />
                                    <span />
                                  </>
                                )}
                                <a href={issueUrl(props.baseUrl, issue.key)} target="_blank" rel="noreferrer">
                                  {issue.key}
                                </a>
                                <span>{issue.summary}</span>
                                <span className={statusClass(status)}>{status}</span>
                                <span>{formatHours(issue.remainingSeconds / 3600)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div className="footer">
                  Last refreshed {props.refreshedAt ? props.refreshedAt.toLocaleString() : "never"}
                  {props.loading ? " — loading…" : ""}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
