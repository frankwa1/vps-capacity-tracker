import { barColor, formatHours } from "../capacity";

export function CapacityRow(props: {
  name: string;
  avatar: string;
  subtitle: string;
  loadHours: number;
  capacityHours: number;
  pct: number;
  open: boolean;
  onClick: () => void;
  clickable?: boolean;
}) {
  const width = Math.min(Math.max(props.pct, props.loadHours > 0 ? 2 : 0), 100);
  return (
    <div
      className={props.open ? "row open" : "row"}
      onClick={props.clickable === false ? undefined : props.onClick}
      style={props.clickable === false ? { cursor: "default" } : undefined}
    >
      <div className="who">
        <div className="avatar">{props.avatar}</div>
        <div className="who-text">
          <strong>{props.name}</strong>
          <span className="meta">{props.subtitle}</span>
        </div>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${width}%`, background: barColor(props.pct) }} />
      </div>
      <div className="stats">
        <b>
          {formatHours(props.loadHours)}
          {props.capacityHours > 0 ? ` of ${formatHours(props.capacityHours)}` : ""}
        </b>
        {Math.round(props.pct)}% allocated
      </div>
    </div>
  );
}
