import type { Connection, TeamConfig } from "./types";
import { DEFAULT_CONNECTION, DEFAULT_TEAM } from "./types";

const CONNECTION_KEY = "vps-capacity-connection";
const TEAM_KEY = "vps-capacity-team";

export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    if (!raw) return { ...DEFAULT_CONNECTION };
    const parsed = JSON.parse(raw) as Partial<Connection>;
    return {
      ...DEFAULT_CONNECTION,
      ...parsed,
      email: parsed.email || DEFAULT_CONNECTION.email,
      token: parsed.token || DEFAULT_CONNECTION.token,
      baseUrl: parsed.baseUrl || DEFAULT_CONNECTION.baseUrl,
    };
  } catch {
    return { ...DEFAULT_CONNECTION };
  }
}

export function mergeLocalConfig(connection: Connection, local: Partial<Connection>): Connection {
  return {
    ...connection,
    baseUrl: local.baseUrl || connection.baseUrl,
    email: local.email || connection.email,
    token: local.token || connection.token,
  };
}

export async function fetchLocalConfig(): Promise<Partial<Connection>> {
  const res = await fetch("/local-jira");
  if (!res.ok) return {};
  return (await res.json()) as Partial<Connection>;
}

export function saveConnection(connection: Connection): void {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export function loadTeam(): TeamConfig {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    if (!raw) return structuredClone(DEFAULT_TEAM);
    const parsed = JSON.parse(raw) as TeamConfig;
    return {
      workingWeekdays: parsed.workingWeekdays?.length === 7 ? parsed.workingWeekdays : DEFAULT_TEAM.workingWeekdays,
      holidays: parsed.holidays || {},
      members: parsed.members || {},
    };
  } catch {
    return structuredClone(DEFAULT_TEAM);
  }
}

export function saveTeam(team: TeamConfig): void {
  localStorage.setItem(TEAM_KEY, JSON.stringify(team));
}
