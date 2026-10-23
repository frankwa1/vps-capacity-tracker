import { useEffect, useMemo, useState } from "react";
import {
  buildRows,
  cycleDayOff,
  datesInRange,
  ensureMember,
  defaultOffDates,
  effectiveDaysOff,
  isDoneIssue,
  parseIsoDate,
  sprintWorkingBounds,
} from "./capacity";
import { SettingsModal } from "./components/SettingsModal";
import { TopBar } from "./components/TopBar";
import { findPreferredBoard, getBoards, getMyself, getMyOpenIssues, getNewOpenTickets, getSprintIssues, getSprints, pickCurrentSprint, ensureBoard, parseParentTicketInput, resolveBoard, updateHoursForIssues, updateJiraForParents, type NewOpenTicket, type UpdateJiraResult } from "./jira";
import { CapacityPage } from "./pages/CapacityPage";
import { MyTicketsPage } from "./pages/MyTicketsPage";
import { fetchLocalConfig, loadConnection, loadTeam, mergeLocalConfig, saveConnection, saveTeam } from "./storage";
import type { Connection, JiraBoard, JiraIssue, JiraSprint, MemberRole, MergeEnvStatus, TeamConfig } from "./types";
import { ALL_SPRINTS_ID, type AppPage } from "./ui";

export default function App() {
  const [connection, setConnection] = useState<Connection>(loadConnection);
  const [team, setTeam] = useState<TeamConfig>(loadTeam);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<Connection>(loadConnection);
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [sprintId, setSprintId] = useState<number | null>(null);
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [tokenFromFile, setTokenFromFile] = useState(false);
  const [me, setMe] = useState("");
  const [meAccountId, setMeAccountId] = useState<string | null>(null);
  const [page, setPage] = useState<AppPage>("capacity");
  const [parentInput, setParentInput] = useState("");
  const [updatingJira, setUpdatingJira] = useState(false);
  const [updatingHours, setUpdatingHours] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [loadingNewTickets, setLoadingNewTickets] = useState(false);
  const [building, setBuilding] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateResults, setUpdateResults] = useState<UpdateJiraResult[] | null>(null);
  const [newTickets, setNewTickets] = useState<NewOpenTicket[] | null>(null);
  const [mergeStatuses, setMergeStatuses] = useState<Record<string, MergeEnvStatus>>({});

  const selectedSprint = sprints.find((s) => s.id === sprintId) || null;
  const sprintDates = useMemo(() => {
    if (!selectedSprint?.startDate || !selectedSprint?.endDate) return [];
    const bounds = sprintWorkingBounds(selectedSprint.startDate, selectedSprint.endDate);
    return datesInRange(bounds.start, bounds.end);
  }, [selectedSprint]);
  const workDates = sprintDates.filter((iso) => team.workingWeekdays[parseIsoDate(iso).getDay()]);
  const rows = useMemo(() => buildRows(issues, team, sprintDates), [issues, team, sprintDates]);
  const people = rows.filter((row) => row.accountId);
  const teamLoad = rows.reduce((sum, row) => sum + row.loadHours, 0);
  const teamCapacity = people.reduce((sum, row) => sum + row.capacityHours, 0);
  const teamPct = teamCapacity > 0 ? (teamLoad / teamCapacity) * 100 : teamLoad > 0 ? 100 : 0;

  useEffect(() => saveConnection(connection), [connection]);
  useEffect(() => saveTeam(team), [team]);

  useEffect(() => {
    void (async () => {
      let next = connection;
      try {
        const local = await fetchLocalConfig();
        if (local.token || local.email || local.baseUrl) {
          next = mergeLocalConfig(connection, local);
          setConnection(next);
          setDraft(next);
          setTokenFromFile(Boolean(local.token));
        }
      } catch {
        /* file config is optional */
      }
      if (next.email) {
        void refreshAll(next, null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectAndLoadBoards(next = draft) {
    const myself = await getMyself(next);
    setMe(myself.displayName);
    setMeAccountId(myself.accountId || null);
    const list = await getBoards(next);
    setBoards(list);
    return list;
  }

  async function refreshMergeStatuses() {
    try {
      const res = await fetch("/ticket-merge-status");
      const body = (await res.json()) as {
        ok?: boolean;
        statuses?: Record<string, MergeEnvStatus>;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        // Keep prior QA1/QA2 map so a transient gh failure does not wipe statuses to To Do.
        return;
      }
      const next = body.statuses || {};
      // Empty successful responses are flaky on Windows; do not clear a good cache.
      if (Object.keys(next).length === 0) return;
      setMergeStatuses(next);
    } catch {
      // keep prior statuses
    }
  }

  async function refreshAll(next = connection, preferredSprintId: number | null = sprintId) {
    if (!next.token && !next.email) {
      setShowSettings(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const myself = await getMyself(next);
      setMe(myself.displayName);
      setMeAccountId(myself.accountId || null);
      next = await ensureBoard(next);
      if (next.boardId !== connection.boardId || next.boardName !== connection.boardName) {
        setConnection(next);
        setDraft(next);
      }
      if (!next.boardId) {
        setShowSettings(true);
        return;
      }
      const sprintList = await getSprints(next, next.boardId);
      setSprints(sprintList);
      if (preferredSprintId === ALL_SPRINTS_ID) {
        setSprintId(ALL_SPRINTS_ID);
        const openIssues = await getMyOpenIssues(next);
        setIssues(openIssues);
        setRefreshedAt(new Date());
        void refreshMergeStatuses();
        return;
      }
      const chosen = pickCurrentSprint(sprintList, preferredSprintId);
      if (!chosen) {
        setIssues([]);
        setSprintId(null);
        return;
      }
      setSprintId(chosen.id);
      const sprintIssues = await getSprintIssues(next, chosen.id, chosen.name);
      setIssues(sprintIssues);
      setTeam((current) => {
        const copy: TeamConfig = { ...current, members: { ...current.members } };
        for (const issue of sprintIssues) {
          if (issue.accountId && issue.displayName && issue.assigneeActive !== false && !isDoneIssue(issue)) {
            ensureMember(copy, issue.accountId, issue.displayName);
          }
        }
        return copy;
      });
      setRefreshedAt(new Date());
      void refreshMergeStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Jira data");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setLoading(true);
    setError(null);
    try {
      const list = await connectAndLoadBoards(draft);
      const board = resolveBoard(list, draft.boardId);
      const next: Connection = await ensureBoard({
        ...draft,
        boardId: board?.id || draft.boardId,
        boardName: board?.name || draft.boardName,
      });
      setDraft(next);
      setConnection(next);
      setShowSettings(false);
      await refreshAll(next, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to Jira");
    } finally {
      setLoading(false);
    }
  }

  function toggleWeekday(index: number) {
    setTeam((current) => {
      const workingWeekdays = [...current.workingWeekdays];
      workingWeekdays[index] = !workingWeekdays[index];
      return { ...current, workingWeekdays };
    });
  }

  function cycleHoliday(iso: string) {
    setTeam((current) => {
      const next = cycleDayOff(current.holidays[iso]);
      const holidays = { ...current.holidays };
      if (next === 0) delete holidays[iso];
      else holidays[iso] = next;
      return { ...current, holidays };
    });
  }

  function cyclePersonal(accountId: string, iso: string) {
    setTeam((current) => {
      const member = current.members[accountId];
      if (!member) return current;
      const person = people.find((row) => row.accountId === accountId);
      const defaults = defaultOffDates(person?.role, sprintDates, current.workingWeekdays, person?.displayName);
      const effective = effectiveDaysOff(member.daysOff, defaults);
      const next = cycleDayOff(effective[iso]);
      const daysOff = { ...member.daysOff };
      if (next === 0 && !defaults.includes(iso)) delete daysOff[iso];
      else daysOff[iso] = next;
      return {
        ...current,
        members: {
          ...current.members,
          [accountId]: { ...member, daysOff },
        },
      };
    });
  }

  function setRole(accountId: string, role: MemberRole | "") {
    setTeam((current) => {
      const member = current.members[accountId];
      if (!member) return current;
      const next = { ...member };
      if (role) next.role = role;
      else delete next.role;
      return {
        ...current,
        members: {
          ...current.members,
          [accountId]: next,
        },
      };
    });
  }

  function setDailyHours(accountId: string, dailyHours: number) {
    setTeam((current) => {
      const member = current.members[accountId];
      if (!member) return current;
      return {
        ...current,
        members: {
          ...current.members,
          [accountId]: { ...member, dailyHours },
        },
      };
    });
  }

  async function onBuild() {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/build", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error || "Build failed");
        return;
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build failed");
    } finally {
      setBuilding(false);
    }
  }

  async function onGetTicketNumbers() {
    setLoadingTickets(true);
    setUpdateError(null);
    try {
      const res = await fetch("/merged-ticket-numbers");
      const body = (await res.json()) as { ok?: boolean; tickets?: string; error?: string; count?: number };
      if (!res.ok || !body.ok) {
        setUpdateError(body.error || "Could not load merged ticket numbers");
        setPage("my-tickets");
        return;
      }
      setParentInput(body.tickets || "");
      if (!body.tickets) {
        setUpdateError("No merged tickets found for the previous night window");
        setPage("my-tickets");
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Could not load merged ticket numbers");
      setPage("my-tickets");
    } finally {
      setLoadingTickets(false);
    }
  }

  async function onNewTickets() {
    setLoadingNewTickets(true);
    setUpdateError(null);
    setNewTickets(null);
    setPage("my-tickets");
    try {
      const tickets = await getNewOpenTickets(connection);
      setNewTickets(tickets);
      setParentInput(tickets.map((t) => t.key.replace(/^VPS-/i, "")).join(","));
      if (tickets.length === 0) {
        setUpdateError("No open tickets created in the last 3 days");
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Could not load new tickets");
    } finally {
      setLoadingNewTickets(false);
    }
  }

  async function onUpdateJira() {
    const parents = parseParentTicketInput(parentInput);
    if (parents.length === 0) {
      setUpdateError("Enter parent ticket numbers like 12345,23333");
      setUpdateResults(null);
      setPage("my-tickets");
      return;
    }
    setUpdatingJira(true);
    setUpdateError(null);
    setUpdateResults(null);
    setPage("my-tickets");
    try {
      const results = await updateJiraForParents(connection, parents);
      setUpdateResults(results);
      await refreshAll(connection, sprintId);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Update Jira failed");
    } finally {
      setUpdatingJira(false);
    }
  }

  async function onUpdateHours(ticketIssues: JiraIssue[], hours: number) {
    if (!Number.isFinite(hours) || hours <= 0) {
      setUpdateError("Enter a valid hours value greater than 0");
      setUpdateResults(null);
      return;
    }
    const estimateSeconds = Math.round(hours * 3600);
    const toUpdate = ticketIssues.filter(
      (issue) => Number(issue.originalSeconds || 0) !== estimateSeconds
    );
    if (toUpdate.length === 0) {
      setUpdateError(null);
      setUpdateResults([
        {
          parentKey: "—",
          ok: true,
          message: `All selected subtasks already have ${hours}h`,
        },
      ]);
      return;
    }
    setUpdatingHours(true);
    setUpdateError(null);
    setUpdateResults(null);
    try {
      const results = await updateHoursForIssues(connection, toUpdate, hours);
      setUpdateResults(results);
      await refreshAll(connection, sprintId);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Update Hours failed");
    } finally {
      setUpdatingHours(false);
    }
  }

  return (
    <div className="app">
      <TopBar
        boardName={connection.boardName}
        me={me}
        page={page}
        onPageChange={setPage}
        sprintId={sprintId}
        sprints={sprints}
        loading={loading}
        parentInput={parentInput}
        onParentInputChange={setParentInput}
        updatingJira={updatingJira}
        onUpdateJira={() => void onUpdateJira()}
        loadingTickets={loadingTickets}
        onGetTicketNumbers={() => void onGetTicketNumbers()}
        loadingNewTickets={loadingNewTickets}
        onNewTickets={() => void onNewTickets()}
        onSprintChange={(id) => {
          setSprintId(id);
          void refreshAll(connection, id);
        }}
        onOpenSettings={() => setShowSettings(true)}
        building={building}
        onBuild={() => void onBuild()}
        onRefresh={() =>
          // Refresh always re-selects the date-based current VPS sprint (keeps All if chosen).
          // Avoid staying on last week's sprint where tickets like VPS-67513 no longer appear.
          void refreshAll(connection, sprintId === ALL_SPRINTS_ID ? ALL_SPRINTS_ID : null)
        }
      />

      {page === "capacity" ? (
        <CapacityPage
          team={team}
          workDates={workDates}
          sprintDates={sprintDates}
          people={people}
          rows={rows}
          teamLoad={teamLoad}
          teamCapacity={teamCapacity}
          teamPct={teamPct}
          sprintId={sprintId}
          openId={openId}
          baseUrl={connection.baseUrl}
          error={error}
          loading={loading}
          refreshedAt={refreshedAt}
          mergeStatuses={mergeStatuses}
          onToggleWeekday={toggleWeekday}
          onCycleHoliday={cycleHoliday}
          onCyclePersonal={cyclePersonal}
          onSetRole={setRole}
          onSetDailyHours={setDailyHours}
          onToggleRow={(id) => setOpenId(openId === id ? null : id)}
        />
      ) : (
        <MyTicketsPage
          issues={issues}
          me={me}
          meAccountId={meAccountId}
          sprintId={sprintId}
          baseUrl={connection.baseUrl}
          error={error}
          updateError={updateError}
          updateResults={updateResults}
          newTickets={newTickets}
          loading={loading}
          updatingJira={updatingJira}
          updatingHours={updatingHours}
          loadingNewTickets={loadingNewTickets}
          refreshedAt={refreshedAt}
          mergeStatuses={mergeStatuses}
          onUpdateHours={(ticketIssues, hours) => void onUpdateHours(ticketIssues, hours)}
          onGetSelectedVpsNumbers={(numbers) => {
            setParentInput(numbers);
            setUpdateError(numbers ? null : "No VPS numbers in the selected rows");
          }}
        />
      )}

      {showSettings ? (
        <SettingsModal
          draft={draft}
          boards={boards}
          tokenFromFile={tokenFromFile}
          loading={loading}
          onChange={setDraft}
          onLoadBoards={() => {
            if (boards.length === 0 && draft.email) {
              void connectAndLoadBoards(draft)
                .then((list) => {
                  const vpsBoard = findPreferredBoard(list);
                  if (!draft.boardId && vpsBoard) {
                    setDraft((current) => ({ ...current, boardId: vpsBoard.id, boardName: vpsBoard.name }));
                  }
                })
                .catch((err) => setError(err instanceof Error ? err.message : "Could not load boards"));
            }
          }}
          onCancel={() => setShowSettings(false)}
          onSave={() => void saveSettings()}
        />
      ) : null}
    </div>
  );
}
