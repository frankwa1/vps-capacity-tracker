import type { DayOff, JiraIssue, MemberConfig, MemberRole, TeamConfig } from "./types";

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function localDateFromIso(value: string): Date {
  if (value.includes("T")) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
  }
  return parseIsoDate(value);
}

/**
 * VPS sprint bounds use the UTC calendar date from Jira (YYYY-MM-DD prefix).
 * Do not convert via local timezone — e.g. 2026-10-22T05:30Z is Wed Oct 22 for the
 * sprint, not Tue Oct 21 in US Pacific.
 */
export function sprintWorkingBounds(startIso: string, endIso: string): { start: Date; end: Date } {
  return { start: parseIsoDate(startIso), end: parseIsoDate(endIso) };
}

export function formatChip(iso: string): string {
  const d = parseIsoDate(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function datesInRange(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    out.push(toIsoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function cycleDayOff(current: DayOff | undefined): DayOff {
  if (current === 1) return 0.5;
  if (current === 0.5) return 0;
  return 1;
}

export function inferRole(issues: JiraIssue[]): MemberRole | undefined {
  let dev = 0;
  let qa = 0;
  for (const issue of issues) {
    const text = `${issue.issueType} ${issue.summary}`.toLowerCase();
    if (/\bqa\b/.test(text)) qa += 1;
    if (/\bdev\b/.test(text)) dev += 1;
  }
  if (qa === 0 && dev === 0) return undefined;
  return qa > dev ? "qa" : "dev";
}

export function resolvedRole(saved: MemberRole | undefined, issues: JiraIssue[]): MemberRole | undefined {
  return saved || inferRole(issues);
}

export function defaultOffDates(
  role: MemberRole | undefined,
  sprintDates: string[],
  workingWeekdays: boolean[],
  displayName?: string,
  now = new Date()
): string[] {
  const work = sprintDates.filter((iso) => workingWeekdays[parseIsoDate(iso).getDay()]);
  const offs: string[] = [];
  if (role === "dev") offs.push(...work.slice(-2));
  if (role === "qa") offs.push(...work.slice(-1));
  const today = toIsoDate(now);
  if (displayName && /danny carrero/i.test(displayName) && work.includes(today) && !offs.includes(today)) {
    offs.push(today);
  }
  return offs;
}

export function effectiveDaysOff(personal: Record<string, DayOff>, defaults: string[]): Record<string, DayOff> {
  const out: Record<string, DayOff> = { ...personal };
  for (const iso of defaults) {
    if (!(iso in out)) out[iso] = 1;
  }
  return out;
}

export function formatHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = Math.abs(totalMinutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return "0h";
}

export function remainingWorkUnits(
  isoDates: string[],
  now: Date,
  workingWeekdays: boolean[],
  holidays: Record<string, DayOff>,
  personal: Record<string, DayOff>
): number {
  const todayIso = toIsoDate(now);
  let units = 0;
  for (const iso of isoDates) {
    if (iso < todayIso) continue;
    const weekday = parseIsoDate(iso).getDay();
    if (!workingWeekdays[weekday]) continue;
    const holiday = holidays[iso] || 0;
    const pto = iso in personal ? personal[iso] : 0;
    units += Math.max(0, 1 - holiday - pto);
  }
  return units;
}

export function isDoneIssue(issue: JiraIssue): boolean {
  if (issue.statusCategory === "done") return true;
  return /^(done|closed|resolved|cancelled|canceled|won't do|wont do|rejected)$/i.test(issue.status.trim());
}

export function countsTowardLoad(issue: JiraIssue): boolean {
  const summary = issue.summary;
  if (/\bcode review\b/i.test(summary)) return false;
  if (/deploy to qa/i.test(summary)) return false;
  return true;
}

export function remainingIssues(issues: JiraIssue[]): JiraIssue[] {
  return issues
    .filter((issue) => !isDoneIssue(issue) && countsTowardLoad(issue))
    .map((issue) =>
      issue.accountId && issue.assigneeActive === false
        ? { ...issue, accountId: null, displayName: null }
        : issue
    );
}

export function loadHours(issues: JiraIssue[], accountId: string | null): number {
  return remainingIssues(issues)
    .filter((i) => (accountId ? i.accountId === accountId : !i.accountId))
    .reduce((sum, i) => sum + i.remainingSeconds / 3600, 0);
}

export type MemberRow = {
  accountId: string | null;
  displayName: string;
  remainingDays: number;
  dailyHours: number;
  capacityHours: number;
  loadHours: number;
  issues: JiraIssue[];
  role?: MemberRole;
};

export function buildRows(
  issues: JiraIssue[],
  team: TeamConfig,
  sprintDates: string[],
  now = new Date()
): MemberRow[] {
  const allByPerson = new Map<string, JiraIssue[]>();
  for (const issue of issues) {
    if (!issue.accountId) continue;
    const list = allByPerson.get(issue.accountId) || [];
    list.push(issue);
    allByPerson.set(issue.accountId, list);
  }

  const byPerson = new Map<string, JiraIssue[]>();
  for (const issue of remainingIssues(issues)) {
    const key = issue.accountId || "__unassigned__";
    const list = byPerson.get(key) || [];
    list.push(issue);
    byPerson.set(key, list);
  }

  const ids = new Set<string>([...byPerson.keys()].filter((k) => k !== "__unassigned__"));

  const rows: MemberRow[] = [...ids].map((accountId) => {
    const saved = team.members[accountId];
    const sample = (byPerson.get(accountId) || []).find((i) => i.displayName);
    const displayName = saved?.displayName || sample?.displayName || accountId;
    const dailyHours = saved?.dailyHours ?? 6;
    const personIssues = byPerson.get(accountId) || [];
    const role = resolvedRole(saved?.role, allByPerson.get(accountId) || personIssues);
    const daysOff = effectiveDaysOff(
      saved?.daysOff || {},
      defaultOffDates(role, sprintDates, team.workingWeekdays, displayName)
    );
    const remainingDays = remainingWorkUnits(
      sprintDates,
      now,
      team.workingWeekdays,
      team.holidays,
      daysOff
    );
    return {
      accountId,
      displayName,
      remainingDays,
      dailyHours,
      capacityHours: remainingDays * dailyHours,
      loadHours: loadHours(personIssues, accountId),
      issues: personIssues,
      role,
    };
  });

  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const unassigned = byPerson.get("__unassigned__") || [];
  rows.push({
    accountId: null,
    displayName: "Unassigned",
    remainingDays: 0,
    dailyHours: 0,
    capacityHours: 0,
    loadHours: loadHours(unassigned, null),
    issues: unassigned,
  });

  return rows;
}

export function ensureMember(team: TeamConfig, accountId: string, displayName: string): MemberConfig {
  if (!team.members[accountId]) {
    team.members[accountId] = {
      accountId,
      displayName,
      dailyHours: 6,
      daysOff: {},
    };
  } else if (displayName && team.members[accountId].displayName !== displayName) {
    team.members[accountId] = { ...team.members[accountId], displayName };
  }
  return team.members[accountId];
}

export function barColor(pct: number): string {
  if (pct >= 100) return "#e74c3c";
  if (pct >= 85) return "#f39c12";
  return "#2ecc71";
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
