export type DayOff = 0 | 0.5 | 1;

export type Connection = {
  baseUrl: string;
  email: string;
  token: string;
  boardId: number | null;
  boardName: string;
};

export type MemberRole = "dev" | "qa";

export type MemberConfig = {
  accountId: string;
  displayName: string;
  dailyHours: number;
  daysOff: Record<string, DayOff>;
  role?: MemberRole;
};

export type TeamConfig = {
  workingWeekdays: boolean[];
  holidays: Record<string, DayOff>;
  members: Record<string, MemberConfig>;
};

export type JiraBoard = {
  id: number;
  name: string;
  type: string;
};

export type JiraSprint = {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
};

export type MergeEnvStatus = "QA1" | "QA2";

export type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  statusCategory?: string;
  issueType: string;
  remainingSeconds: number;
  originalSeconds: number;
  accountId: string | null;
  displayName: string | null;
  assigneeActive?: boolean;
  parentKey?: string | null;
  parentSummary?: string | null;
  sprintName?: string | null;
};

export const DEFAULT_CONNECTION: Connection = {
  baseUrl: "https://teamfox.atlassian.net",
  email: "frank.wang@fox.com",
  token: "",
  boardId: null,
  boardName: "",
};

export const DEFAULT_TEAM: TeamConfig = {
  workingWeekdays: [false, true, true, true, true, true, false],
  holidays: {},
  members: {},
};
