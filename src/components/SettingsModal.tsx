import type { Connection, JiraBoard } from "../types";

export function SettingsModal(props: {
  draft: Connection;
  boards: JiraBoard[];
  tokenFromFile: boolean;
  loading: boolean;
  onChange: (draft: Connection) => void;
  onLoadBoards: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Jira settings</h2>
        <p className="hint">
          Put your API token in <code>jira.local.json</code> (gitignored) or paste it here. Email defaults to
          frank.wang@fox.com.
        </p>
        <label className="field">
          Jira site
          <input
            value={props.draft.baseUrl}
            onChange={(event) => props.onChange({ ...props.draft, baseUrl: event.target.value })}
            placeholder="https://teamfox.atlassian.net"
          />
        </label>
        <label className="field">
          Email
          <input
            value={props.draft.email}
            onChange={(event) => props.onChange({ ...props.draft, email: event.target.value })}
            placeholder="frank.wang@fox.com"
          />
        </label>
        <label className="field">
          API token
          <input
            type="password"
            value={props.draft.token}
            onChange={(event) => props.onChange({ ...props.draft, token: event.target.value })}
            placeholder="Loaded from jira.local.json when set"
          />
          {props.tokenFromFile ? <span className="hint">Loaded from jira.local.json</span> : null}
        </label>
        <label className="field">
          Board
          <select
            value={props.draft.boardId || ""}
            onChange={(event) => {
              const id = Number(event.target.value);
              const board = props.boards.find((item) => item.id === id);
              props.onChange({ ...props.draft, boardId: id || null, boardName: board?.name || "" });
            }}
            onFocus={props.onLoadBoards}
          >
            <option value="">{props.boards.length ? "Select a board" : "Focus this field to load boards"}</option>
            {props.boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name} ({board.type})
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={props.onSave} disabled={props.loading}>
            {props.loading ? "Saving..." : "Save & load"}
          </button>
        </div>
      </div>
    </div>
  );
}
