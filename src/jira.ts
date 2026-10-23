import { parseIsoDate, toIsoDate } from "./capacity";
import type { Connection, JiraBoard, JiraIssue, JiraSprint } from "./types";

function authHeader(connection: Connection): string {
  return "Basic " + btoa(`${connection.email}:${connection.token}`);
}

async function jiraRequest<T>(
  connection: Connection,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const method = init?.method || "GET";
  const headers: Record<string, string> = {
    "X-Jira-Base": connection.baseUrl.replace(/\/$/, ""),
    Accept: "application/json",
  };
  if (connection.email && connection.token) {
    headers.Authorization = authHeader(connection);
  }
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`/jira${path}`, {
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string; errorMessages?: string[] };
      detail = parsed.errorMessages?.join("; ") || parsed.message || parsed.error || text;
    } catch {
      /* keep raw */
    }
    throw new Error(detail || `Jira ${res.status}`);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function jiraGet<T>(connection: Connection, path: string): Promise<T> {
  return jiraRequest<T>(connection, path);
}

export async function getMyself(
  connection: Connection
): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
  return jiraGet(connection, "/rest/api/3/myself");
}

export const PREFERRED_BOARD_NAME = "VPS Support";

export function findPreferredBoard(boards: JiraBoard[]): JiraBoard | undefined {
  const needle = PREFERRED_BOARD_NAME.toLowerCase();
  return boards.find((board) => board.name.toLowerCase().includes(needle));
}

export function isIgnoredBoardName(name: string): boolean {
  return /sprint[-_\s]*integration/i.test(name);
}

export function resolveBoard(boards: JiraBoard[], savedBoardId: number | null): JiraBoard | undefined {
  const preferred = findPreferredBoard(boards);
  if (preferred) return preferred;
  const saved = boards.find((board) => board.id === savedBoardId);
  if (saved && !isIgnoredBoardName(saved.name)) return saved;
  return boards[0];
}

function sprintDayRange(sprint: JiraSprint): { start: string; end: string } | null {
  if (!sprint.startDate || !sprint.endDate) return null;
  return {
    start: toIsoDate(parseIsoDate(sprint.startDate)),
    end: toIsoDate(parseIsoDate(sprint.endDate)),
  };
}

function coversDate(sprint: JiraSprint, dayIso: string): boolean {
  const range = sprintDayRange(sprint);
  return Boolean(range && range.start <= dayIso && dayIso <= range.end);
}

function wednesdayOnOrAfter(day: Date): string {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const add = (3 - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + add);
  return toIsoDate(next);
}

function isWeeklySupportSprint(name: string): boolean {
  return /^Sprint \d{4}-\d{2}-\d{2}/i.test(name.trim());
}

/** Date key from VPS weekly sprint name (`Sprint YYYY-MM-DD`), else end/start date. */
function sprintSortDateKey(sprint: JiraSprint): string {
  const match = sprint.name.trim().match(/^Sprint (\d{4}-\d{2}-\d{2})/i);
  if (match) return match[1];
  if (sprint.endDate) return toIsoDate(parseIsoDate(sprint.endDate));
  if (sprint.startDate) return toIsoDate(parseIsoDate(sprint.startDate));
  return "";
}

/**
 * Dropdown order: VPS weekly sprints from the current one forward (by date),
 * then older VPS sprints (newest first), then non-VPS sprints.
 * "All" is rendered separately and stays first in the UI.
 */
export function sortSprintsForDropdown(sprints: JiraSprint[], today = new Date()): JiraSprint[] {
  const vps: JiraSprint[] = [];
  const other: JiraSprint[] = [];
  for (const sprint of sprints) {
    if (isWeeklySupportSprint(sprint.name)) vps.push(sprint);
    else other.push(sprint);
  }

  const current = pickCurrentSprint(vps, null, today);
  const currentKey = current ? sprintSortDateKey(current) : toIsoDate(today);

  const vpsFromCurrent = vps
    .filter((sprint) => sprintSortDateKey(sprint) >= currentKey)
    .sort((a, b) => sprintSortDateKey(a).localeCompare(sprintSortDateKey(b)));

  const vpsPast = vps
    .filter((sprint) => sprintSortDateKey(sprint) < currentKey)
    .sort((a, b) => sprintSortDateKey(b).localeCompare(sprintSortDateKey(a)));

  const otherSorted = [...other].sort((a, b) => {
    const rank = (s: JiraSprint) => (s.state === "active" ? 0 : s.state === "future" ? 1 : 2);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return String(b.startDate || "").localeCompare(String(a.startDate || ""));
  });

  return [...vpsFromCurrent, ...vpsPast, ...otherSorted];
}

function pickSoonestEnd(sprints: JiraSprint[]): JiraSprint {
  return [...sprints].sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)))[0];
}

function pickCurrentWeeklySprint(sprints: JiraSprint[], todayIso: string): JiraSprint | undefined {
  // Name date is authoritative (Sprint YYYY-MM-DD); many old sprints stay "active" in Jira.
  const weekly = sprints.filter((sprint) => isWeeklySupportSprint(sprint.name));
  if (!weekly.length) return undefined;

  const withKeys = weekly.map((sprint) => ({
    sprint,
    key: sprintSortDateKey(sprint),
    range: sprintDayRange(sprint),
  }));
  const covering = withKeys
    .filter((item) => item.range && item.range.start <= todayIso && todayIso <= item.range.end)
    .sort((a, b) => a.key.localeCompare(b.key));
  if (covering.length) return covering[0].sprint;

  const upcoming = withKeys
    .filter((item) => item.key >= todayIso)
    .sort((a, b) => a.key.localeCompare(b.key));
  return upcoming[0]?.sprint;
}

export function pickCurrentSprint(
  sprints: JiraSprint[],
  preferredId: number | null,
  today = new Date()
): JiraSprint | undefined {
  const todayIso = toIsoDate(today);
  const preferred = preferredId ? sprints.find((sprint) => sprint.id === preferredId) : undefined;
  if (preferred) {
    const range = sprintDayRange(preferred);
    // Keep an explicit dropdown choice unless it is a VPS weekly sprint that already ended.
    const staleWeekly =
      isWeeklySupportSprint(preferred.name) && Boolean(range && range.end < todayIso);
    if (!staleWeekly) return preferred;
  }

  const currentWeekly = pickCurrentWeeklySprint(sprints, todayIso);
  if (currentWeekly) return currentWeekly;

  const covering = sprints.filter((sprint) => coversDate(sprint, todayIso));
  if (covering.length) {
    const coveringWeekly = covering.filter((sprint) => isWeeklySupportSprint(sprint.name));
    return pickSoonestEnd(coveringWeekly.length ? coveringWeekly : covering);
  }

  const weekEnd = wednesdayOnOrAfter(today);
  const named = sprints.find(
    (sprint) => sprint.name.includes(weekEnd) || sprint.name.includes(weekEnd.replace(/-/g, ""))
  );
  if (named) return named;

  const started = sprints.filter((sprint) => {
    const range = sprintDayRange(sprint);
    return range ? range.start <= todayIso : false;
  });
  if (started.length) {
    started.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    return started[0];
  }

  const upcoming = sprints.filter((sprint) => {
    const range = sprintDayRange(sprint);
    return range ? range.start > todayIso : false;
  });
  if (upcoming.length) {
    upcoming.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    return upcoming[0];
  }

  return sprints.find((sprint) => sprint.state === "active") || sprints[0];
}

export async function getBoards(connection: Connection, name?: string): Promise<JiraBoard[]> {
  const boards: JiraBoard[] = [];
  let startAt = 0;
  const nameQuery = name ? `&name=${encodeURIComponent(name)}` : "";
  const pageLimit = name ? 50 : 500;
  for (;;) {
    const page = await jiraGet<{
      isLast: boolean;
      values: { id: number; name: string; type: string }[];
    }>(connection, `/rest/agile/1.0/board?maxResults=50&startAt=${startAt}${nameQuery}`);
    boards.push(...page.values.map((b) => ({ id: b.id, name: b.name, type: b.type })));
    if (page.isLast || page.values.length === 0) break;
    startAt += page.values.length;
    if (startAt >= pageLimit) break;
  }
  return boards.sort((a, b) => a.name.localeCompare(b.name));
}

/** Use saved board id when present; otherwise look up VPS Support by name (one request). */
export async function ensureBoard(connection: Connection): Promise<Connection> {
  if (connection.boardId && !isIgnoredBoardName(connection.boardName || "")) {
    return {
      ...connection,
      boardName: connection.boardName || PREFERRED_BOARD_NAME,
    };
  }
  const boards = await getBoards(connection, PREFERRED_BOARD_NAME);
  const board = findPreferredBoard(boards) || boards[0];
  if (!board) return connection;
  return { ...connection, boardId: board.id, boardName: board.name };
}

async function fetchSprintsByState(
  connection: Connection,
  boardId: number,
  state: string,
  max = 500
): Promise<JiraSprint[]> {
  const sprints: JiraSprint[] = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraGet<{
      isLast: boolean;
      values: Array<{
        id: number;
        name: string;
        state: string;
        startDate?: string;
        endDate?: string;
      }>;
    }>(
      connection,
      `/rest/agile/1.0/board/${boardId}/sprint?state=${state}&maxResults=50&startAt=${startAt}`
    );
    sprints.push(
      ...page.values.map((sprint) => ({
        id: sprint.id,
        name: sprint.name,
        state: sprint.state,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      }))
    );
    if (page.isLast || page.values.length === 0) break;
    startAt += page.values.length;
    if (startAt >= max) break;
  }
  return sprints;
}

export async function getSprints(connection: Connection, boardId: number): Promise<JiraSprint[]> {
  const [active, future] = await Promise.all([
    fetchSprintsByState(connection, boardId, "active"),
    fetchSprintsByState(connection, boardId, "future"),
  ]);
  const byId = new Map<number, JiraSprint>();
  for (const sprint of [...future, ...active]) {
    byId.set(sprint.id, sprint);
  }
  return sortSprintsForDropdown([...byId.values()]);
}

type IssuePage = {
  startAt: number;
  maxResults: number;
  total: number;
  issues: Array<{
    key: string;
    fields: Record<string, unknown> & {
      summary: string;
      timeestimate: number | null;
      timeoriginalestimate?: number | null;
      status?: { name: string; statusCategory?: { key: string } };
      issuetype?: { name: string };
      assignee?: { accountId: string; displayName: string; active?: boolean } | null;
      parent?: { key: string; fields?: { summary?: string } } | null;
    };
  }>;
};

type SprintFieldValue = {
  id?: number;
  name?: string;
  state?: string;
  endDate?: string;
};

let sprintFieldIdPromise: Promise<string | null> | null = null;

async function getSprintFieldId(connection: Connection): Promise<string | null> {
  if (!sprintFieldIdPromise) {
    sprintFieldIdPromise = (async () => {
      try {
        const fields = await jiraGet<Array<{ id: string; name: string; schema?: { custom?: string } }>>(
          connection,
          "/rest/api/3/field"
        );
        const sprint = fields.find(
          (field) =>
            field.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint" || /^sprint$/i.test(field.name)
        );
        return sprint?.id || null;
      } catch {
        return null;
      }
    })();
  }
  return sprintFieldIdPromise;
}

function sprintFieldEntries(raw: unknown): SprintFieldValue[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const named = raw.match(/name=([^,\]]+)/);
    return named?.[1] ? [{ name: named[1].trim() }] : [];
  }
  if (Array.isArray(raw)) return raw as SprintFieldValue[];
  if (typeof raw === "object" && raw && "name" in (raw as object)) return [raw as SprintFieldValue];
  return [];
}

function parseSprintName(raw: unknown, today = new Date()): string | null {
  const sprints = sprintFieldEntries(raw).filter((sprint) => sprint?.name);
  if (sprints.length === 0) return null;

  const todayIso = toIsoDate(today);
  const weekly = sprints.filter((sprint) => isWeeklySupportSprint(String(sprint.name)));
  const pool = weekly.length ? weekly : sprints;

  const withKeys = pool.map((sprint) => {
    const name = String(sprint.name);
    const dateMatch = name.trim().match(/^Sprint (\d{4}-\d{2}-\d{2})/i);
    const dateKey =
      dateMatch?.[1] ||
      (sprint.endDate ? toIsoDate(parseIsoDate(String(sprint.endDate))) : "");
    return {
      name,
      dateKey,
      active: /active/i.test(String(sprint.state || "")),
    };
  });

  // Prefer current/future VPS weekly sprint (soonest end on/after today), then most recent past.
  const currentOrFuture = withKeys
    .filter((sprint) => sprint.dateKey && sprint.dateKey >= todayIso)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (currentOrFuture.length) {
    const active = currentOrFuture.find((sprint) => sprint.active);
    return (active || currentOrFuture[0]).name;
  }

  const past = withKeys
    .filter((sprint) => sprint.dateKey)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  if (past.length) return past[0].name;

  const active = withKeys.find((sprint) => sprint.active);
  return active?.name || withKeys[0]?.name || null;
}

function mapIssue(issue: IssuePage["issues"][number], sprintFieldId?: string | null): JiraIssue {
  const sprintName = sprintFieldId ? parseSprintName(issue.fields[sprintFieldId]) : null;
  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name || "",
    statusCategory: issue.fields.status?.statusCategory?.key || "",
    issueType: issue.fields.issuetype?.name || "",
    remainingSeconds: issue.fields.timeestimate || 0,
    originalSeconds: Number(issue.fields.timeoriginalestimate || 0),
    accountId: issue.fields.assignee?.accountId || null,
    displayName: issue.fields.assignee?.displayName || null,
    assigneeActive: issue.fields.assignee ? issue.fields.assignee.active !== false : undefined,
    parentKey: issue.fields.parent?.key || null,
    parentSummary: issue.fields.parent?.fields?.summary || null,
    sprintName,
  };
}

const ISSUE_FIELDS = "summary,assignee,status,issuetype,timeestimate,timeoriginalestimate,parent";

export async function getSprintIssues(
  connection: Connection,
  sprintId: number,
  sprintName?: string
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let startAt = 0;
  for (;;) {
    const page = await jiraGet<IssuePage>(
      connection,
      `/rest/agile/1.0/sprint/${sprintId}/issue?maxResults=100&startAt=${startAt}&fields=${ISSUE_FIELDS}`
    );
    issues.push(
      ...page.issues.map((issue) => ({
        ...mapIssue(issue),
        sprintName: sprintName || null,
      }))
    );
    startAt += page.issues.length;
    if (startAt >= page.total || page.issues.length === 0) break;
  }
  return issues;
}

export async function getMyOpenIssues(connection: Connection): Promise<JiraIssue[]> {
  const jql = "assignee = currentUser() AND statusCategory != Done ORDER BY key DESC";
  const sprintFieldId = await getSprintFieldId(connection);
  const fields = sprintFieldId ? `${ISSUE_FIELDS},${sprintFieldId}` : ISSUE_FIELDS;
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  for (;;) {
    const params = new URLSearchParams({
      jql,
      maxResults: "100",
      fields,
    });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);

    const page = await jiraGet<{
      issues: IssuePage["issues"];
      nextPageToken?: string;
    }>(connection, `/rest/api/3/search/jql?${params.toString()}`);

    issues.push(...page.issues.map((issue) => mapIssue(issue, sprintFieldId)));
    if (!page.nextPageToken || page.issues.length === 0) break;
    nextPageToken = page.nextPageToken;
    if (issues.length > 2000) break;
  }
  return issues;
}

const DEFAULT_ESTIMATE_SECONDS = 2 * 3600;

export function parseParentTicketInput(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const token of text.split(",").map((part) => part.trim()).filter(Boolean)) {
    const match = token.match(/^(?:([A-Za-z][A-Za-z0-9]+)-)?(\d+)$/);
    if (!match) continue;
    const key = `${(match[1] || "VPS").toUpperCase()}-${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export type NewOpenTicket = {
  key: string;
  summary: string;
};

/** Open VPS tickets created in the last 3 days; unique by parent (or self), desc. */
export async function getNewOpenTickets(connection: Connection): Promise<NewOpenTicket[]> {
  const jql = "project = VPS AND statusCategory != Done AND created >= -3d ORDER BY key DESC";
  const issues = await searchJqlIssues(connection, jql, "summary,parent");
  const seen = new Set<string>();
  const tickets: NewOpenTicket[] = [];
  for (const issue of issues) {
    if (!issue?.key) continue;
    const key = issue.fields?.parent?.key || issue.key;
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = issue.fields?.parent
      ? issue.fields.parent.fields?.summary || ""
      : issue.fields?.summary || "";
    tickets.push({ key, summary });
  }
  tickets.sort((a, b) => ticketNumber(b.key) - ticketNumber(a.key) || b.key.localeCompare(a.key));
  return tickets;
}

function ticketNumber(key: string): number {
  const match = key.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

type TimedIssue = {
  key: string;
  originalSeconds: number;
  spentSeconds: number;
};

async function searchJqlIssues(
  connection: Connection,
  jql: string,
  fields: string
): Promise<IssuePage["issues"]> {
  const issues: IssuePage["issues"] = [];
  let nextPageToken: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ jql, maxResults: "100", fields });
    if (nextPageToken) params.set("nextPageToken", nextPageToken);
    const page = await jiraGet<{
      issues?: IssuePage["issues"];
      nextPageToken?: string;
    }>(connection, `/rest/api/3/search/jql?${params.toString()}`);
    const batch = page.issues || [];
    issues.push(...batch);
    if (!page.nextPageToken || batch.length === 0) break;
    nextPageToken = page.nextPageToken;
  }
  return issues;
}

async function getOpenChildrenAssignedToMe(connection: Connection, parentKey: string): Promise<TimedIssue[]> {
  const jql = `parent = ${parentKey} AND assignee = currentUser() AND statusCategory != Done`;
  const issues = await searchJqlIssues(
    connection,
    jql,
    "timeoriginalestimate,timespent,status"
  );
  return issues.map((issue) => ({
    key: issue.key,
    originalSeconds: Number(issue.fields.timeoriginalestimate || 0),
    spentSeconds: Number(issue.fields.timespent || 0),
  }));
}

async function setOriginalEstimate(connection: Connection, issueKey: string, seconds: number): Promise<void> {
  const hours = seconds / 3600;
  const estimate = Number.isInteger(hours) ? `${hours}h` : `${hours}h`;
  await jiraRequest(connection, `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: {
      fields: {
        timetracking: {
          originalEstimate: estimate,
        },
      },
    },
  });
}

async function addWorklog(connection: Connection, issueKey: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  await jiraRequest(connection, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
    method: "POST",
    body: {
      timeSpentSeconds: seconds,
    },
  });
}

async function transitionIssue(
  connection: Connection,
  issueKey: string,
  match: (transition: { name: string; to?: { name?: string; statusCategory?: { key?: string } } }) => boolean,
  label: string
): Promise<void> {
  const data = await jiraGet<{
    transitions: Array<{
      id: string;
      name: string;
      to?: { name?: string; statusCategory?: { key?: string } };
    }>;
  }>(connection, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);

  const transition = data.transitions.find(match);
  if (!transition) {
    throw new Error(`${issueKey}: no ${label} transition available`);
  }

  await jiraRequest(connection, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    body: { transition: { id: transition.id } },
  });
}

async function transitionToDone(connection: Connection, issueKey: string): Promise<void> {
  await transitionIssue(
    connection,
    issueKey,
    (t) =>
      t.to?.statusCategory?.key === "done" || /^(done|closed|resolved)$/i.test(t.to?.name || t.name),
    "Done"
  );
}

async function transitionToInQa(connection: Connection, issueKey: string): Promise<void> {
  await transitionIssue(
    connection,
    issueKey,
    (t) => /in\s*qa/i.test(t.to?.name || "") || /in\s*qa/i.test(t.name),
    "In QA"
  );
}

export type UpdateJiraResult = {
  parentKey: string;
  issueKey?: string;
  message: string;
  ok: boolean;
};

export async function updateHoursForIssues(
  connection: Connection,
  issues: Array<{ key: string; parentKey?: string | null; originalSeconds: number }>,
  hours: number = 2
): Promise<UpdateJiraResult[]> {
  const results: UpdateJiraResult[] = [];
  const estimateSeconds = Math.round(hours * 3600);

  for (const issue of issues) {
    const parentKey = issue.parentKey || issue.key;
    const currentSeconds = Number(issue.originalSeconds || 0);
    try {
      if (currentSeconds === estimateSeconds) {
        results.push({
          parentKey,
          issueKey: issue.key,
          ok: true,
          message: `Already ${hours}h`,
        });
        continue;
      }

      await setOriginalEstimate(connection, issue.key, estimateSeconds);
      results.push({
        parentKey,
        issueKey: issue.key,
        ok: true,
        message: `Set estimate from ${currentSeconds / 3600}h to ${hours}h`,
      });
    } catch (err) {
      results.push({
        parentKey,
        issueKey: issue.key,
        ok: false,
        message: err instanceof Error ? err.message : "Failed to update estimate",
      });
    }
  }

  return results;
}

export async function updateJiraForParents(
  connection: Connection,
  parentKeys: string[]
): Promise<UpdateJiraResult[]> {
  const results: UpdateJiraResult[] = [];

  for (const parentKey of parentKeys) {
    try {
      const children = await getOpenChildrenAssignedToMe(connection, parentKey);
      if (children.length === 0) {
        results.push({
          parentKey,
          ok: false,
          message: "No open child ticket assigned to you",
        });
        continue;
      }

      let childOk = false;
      for (const child of children) {
        try {
          let originalSeconds = child.originalSeconds;
          if (!originalSeconds) {
            originalSeconds = DEFAULT_ESTIMATE_SECONDS;
            await setOriginalEstimate(connection, child.key, originalSeconds);
          }

          const remainingToLog = Math.max(0, originalSeconds - child.spentSeconds);
          if (remainingToLog > 0) {
            await addWorklog(connection, child.key, remainingToLog);
          }

          await transitionToDone(connection, child.key);
          childOk = true;
          results.push({
            parentKey,
            issueKey: child.key,
            ok: true,
            message: `Set estimate/spend to ${originalSeconds / 3600}h and marked Done`,
          });
        } catch (err) {
          results.push({
            parentKey,
            issueKey: child.key,
            ok: false,
            message: err instanceof Error ? err.message : "Failed to update ticket",
          });
        }
      }

      if (childOk) {
        try {
          await transitionToInQa(connection, parentKey);
          results.push({
            parentKey,
            ok: true,
            message: "Marked parent In QA",
          });
        } catch (err) {
          results.push({
            parentKey,
            ok: false,
            message: err instanceof Error ? err.message : "Failed to mark parent In QA",
          });
        }
      }
    } catch (err) {
      results.push({
        parentKey,
        ok: false,
        message: err instanceof Error ? err.message : "Failed to find child tickets",
      });
    }
  }

  return results;
}
