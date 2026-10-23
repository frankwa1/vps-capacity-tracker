import { useMemo } from "react";
import { formatChip } from "../capacity";
import { pickCurrentSprint } from "../jira";
import { ALL_SPRINTS_ID, type AppPage } from "../ui";
import type { JiraSprint } from "../types";

export function TopBar(props: {
  boardName: string;
  me: string;
  page: AppPage;
  onPageChange: (page: AppPage) => void;
  sprintId: number | null;
  sprints: JiraSprint[];
  loading: boolean;
  parentInput: string;
  onParentInputChange: (value: string) => void;
  updatingJira: boolean;
  onUpdateJira: () => void;
  loadingTickets: boolean;
  onGetTicketNumbers: () => void;
  loadingNewTickets: boolean;
  onNewTickets: () => void;
  onSprintChange: (sprintId: number) => void;
  onOpenSettings: () => void;
  building: boolean;
  onBuild: () => void;
  onRefresh: () => void;
}) {
  const currentSprintId = useMemo(() => pickCurrentSprint(props.sprints, null)?.id ?? null, [props.sprints]);

  return (
    <header className="topbar">
      <div className="title-block">
        <h1>Capacity Tracker</h1>
        <div className="badges">
          <span className="badge">{props.boardName || "VPS Support"}</span>
          <span className="badge">Sprint based</span>
          {props.me ? <span className="badge">{props.me}</span> : null}
        </div>
        <nav className="page-nav">
          <button
            className={props.page === "capacity" ? "page-nav-btn on" : "page-nav-btn"}
            onClick={() => props.onPageChange("capacity")}
          >
            Capacity
          </button>
          <button
            className={props.page === "my-tickets" ? "page-nav-btn on" : "page-nav-btn"}
            onClick={() => props.onPageChange("my-tickets")}
          >
            My tickets
          </button>
          <div className="update-jira">
            <input
              className="update-jira-input"
              value={props.parentInput}
              onChange={(event) => props.onParentInputChange(event.target.value)}
              placeholder=""
              disabled={props.updatingJira || props.loading}
              title="Comma-delimited parent ticket numbers"
            />
            <button
              className="btn btn-primary"
              onClick={props.onUpdateJira}
              disabled={props.updatingJira || props.loading || props.loadingTickets}
            >
              {props.updatingJira ? "Updating..." : "Update Jira"}
            </button>
            <button
              className="btn"
              onClick={props.onGetTicketNumbers}
              disabled={props.updatingJira || props.loading || props.loadingTickets || props.loadingNewTickets}
            >
              {props.loadingTickets ? "Loading..." : "Get ticket numbers"}
            </button>
            <button
              className="btn"
              onClick={props.onNewTickets}
              disabled={props.updatingJira || props.loading || props.loadingTickets || props.loadingNewTickets}
            >
              {props.loadingNewTickets ? "Loading..." : "New Tickets"}
            </button>
          </div>
        </nav>
      </div>
      <div className="top-actions">
        <select
          className="sprint-select"
          value={props.sprintId ?? ""}
          onChange={(event) => props.onSprintChange(Number(event.target.value))}
        >
          <option value={ALL_SPRINTS_ID}>All (my open tickets)</option>
          {props.sprints.length === 0 ? <option value="">No sprints</option> : null}
          {props.sprints.map((sprint) => (
            <option key={sprint.id} value={sprint.id}>
              {sprint.id === currentSprintId
                ? "[current] "
                : sprint.state === "future"
                  ? "[future] "
                  : sprint.state === "active"
                    ? "[active] "
                    : ""}
              {sprint.name}
              {sprint.startDate && sprint.endDate
                ? ` (${formatChip(sprint.startDate)} - ${formatChip(sprint.endDate)})`
                : ""}
            </option>
          ))}
        </select>
        <button className="btn" onClick={props.onBuild} disabled={props.building || props.loading}>
          {props.building ? "Building..." : "Build"}
        </button>
        <button className="btn" onClick={props.onOpenSettings}>
          Settings
        </button>
        <button className="btn btn-primary" onClick={props.onRefresh} disabled={props.loading}>
          {props.loading ? "Loading..." : "Refresh"}
        </button>
      </div>
    </header>
  );
}
