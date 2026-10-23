import type { DayOff, JiraIssue, MergeEnvStatus } from "./types";

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
export const ALL_SPRINTS_ID = -1;

export type AppPage = "capacity" | "my-tickets";

export function issueUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, "")}/browse/${key}`;
}

export function ticketNumber(key: string): number {
  const match = key.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

export function chipClass(value: DayOff | undefined): string {
  if (value === 1) return "chip on";
  if (value === 0.5) return "chip half";
  return "chip";
}

export function statusClass(status: string): string {
  const value = status.toLowerCase();
  if (/done|closed|resolved/.test(value)) return "status done";
  if (/block|hold/.test(value)) return "status blocked";
  if (/qa\d*|\bqa\b|test/.test(value)) return "status qa";
  if (/progress|development|review/.test(value)) return "status progress";
  return "status todo";
}

function mergeStatusForKey(
  key: string | null | undefined,
  mergeStatuses: Record<string, MergeEnvStatus>
): MergeEnvStatus | undefined {
  if (!key) return undefined;
  if (mergeStatuses[key]) return mergeStatuses[key];
  const num = ticketNumber(key);
  if (!num) return undefined;
  return mergeStatuses[`VPS-${num}`] || mergeStatuses[String(num)];
}

/** Prefer merge-based QA lane over Jira status when the parent/ticket PR is on develop or master. */
export function displayStatus(
  issue: Pick<JiraIssue, "key" | "parentKey" | "status">,
  mergeStatuses: Record<string, MergeEnvStatus>
): string {
  const parentKey = issue.parentKey || issue.key;
  return (
    mergeStatusForKey(parentKey, mergeStatuses) ||
    mergeStatusForKey(issue.key, mergeStatuses) ||
    issue.status
  );
}
