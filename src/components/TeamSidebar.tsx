import { defaultOffDates, effectiveDaysOff, formatChip } from "../capacity";
import type { MemberRow } from "../capacity";
import { WEEKDAYS, chipClass } from "../ui";
import type { MemberRole, TeamConfig } from "../types";

export function TeamSidebar(props: {
  team: TeamConfig;
  workDates: string[];
  sprintDates: string[];
  people: MemberRow[];
  onToggleWeekday: (index: number) => void;
  onCycleHoliday: (iso: string) => void;
  onCyclePersonal: (accountId: string, iso: string) => void;
  onSetRole: (accountId: string, role: MemberRole | "") => void;
  onSetDailyHours: (accountId: string, dailyHours: number) => void;
}) {
  return (
    <aside className="sidebar">
      <h2 className="section-title">Team working days</h2>
      <div className="weekday-row">
        {WEEKDAYS.map((label, index) => (
          <button
            key={`${label}-${index}`}
            className={props.team.workingWeekdays[index] ? "weekday on" : "weekday"}
            onClick={() => props.onToggleWeekday(index)}
          >
            {label}
          </button>
        ))}
      </div>

      <h2 className="section-title">Team days off (holidays)</h2>
      <p className="hint">Click a date to cycle working → off → half day.</p>
      <div className="chip-row">
        {props.workDates.map((iso) => (
          <button key={iso} className={chipClass(props.team.holidays[iso])} onClick={() => props.onCycleHoliday(iso)}>
            {formatChip(iso)}
          </button>
        ))}
      </div>

      <h2 className="section-title">Sprint member configuration</h2>
      {props.people.map((person) => (
        <div className="member-card" key={person.accountId}>
          <div className="member-head">
            <div>
              <strong>{person.displayName}</strong>
              <span className="meta">
                {person.remainingDays.toFixed(person.remainingDays % 1 ? 1 : 0)} remaining working days
              </span>
            </div>
            <div className="member-controls">
              <label className="meta">
                Role
                <select
                  className="role"
                  value={props.team.members[person.accountId!]?.role || "auto"}
                  onChange={(event) =>
                    props.onSetRole(
                      person.accountId!,
                      event.target.value === "auto" ? "" : (event.target.value as MemberRole)
                    )
                  }
                >
                  <option value="auto">Auto{person.role ? ` (${person.role})` : ""}</option>
                  <option value="dev">Dev</option>
                  <option value="qa">QA</option>
                </select>
              </label>
              <label className="meta">
                Daily
                <input
                  className="daily"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={person.dailyHours}
                  onChange={(event) => props.onSetDailyHours(person.accountId!, Number(event.target.value) || 0)}
                />
              </label>
            </div>
          </div>
          <div className="chip-row">
            {props.workDates.map((iso) => {
              const defaults = defaultOffDates(
                person.role,
                props.sprintDates,
                props.team.workingWeekdays,
                person.displayName
              );
              const off = effectiveDaysOff(props.team.members[person.accountId!]?.daysOff || {}, defaults)[iso];
              return (
                <button
                  key={iso}
                  className={chipClass(off)}
                  onClick={() => props.onCyclePersonal(person.accountId!, iso)}
                >
                  {formatChip(iso)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
