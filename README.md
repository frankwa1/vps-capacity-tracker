# VPS Capacity Tracker

Local web app that mirrors the portable Capacity Tracker: remaining Jira estimate vs remaining sprint capacity.

## Run

Install once so the app stays available after you sign in to Windows (no `npm run dev`):

1. Double-click `install.cmd`
2. Open [http://127.0.0.1:8787/](http://127.0.0.1:8787/) anytime, or the **VPS Capacity Tracker** desktop shortcut

`start.cmd` opens that URL and starts the host if it is not already running. Use `uninstall.cmd` to remove the Startup shortcut.

For UI work with hot reload:

```bash
nvm use 22.14.0
npm install
npm run dev
```

## Jira setup

Email defaults to `frank.wang@fox.com`.

Put the API token in **`jira.local.json`** (gitignored so I can read it locally without committing it):

```json
{
  "baseUrl": "https://teamfox.atlassian.net",
  "email": "frank.wang@fox.com",
  "token": "your-atlassian-api-token"
}
```

Copy from `jira.local.example.json` if needed. Restart the host (`uninstall.cmd` then `install.cmd`, or `start.cmd`) after the first create; later token edits are picked up on the next Jira request.

Settings in the UI can still override the token. Create a token at [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

## How capacity is calculated

- **Load** = sum of remaining estimate on that person's sprint issues
- **Capacity** = remaining working days × daily hours
- Remaining days start **today** (or sprint start if the sprint is in the future), count selected weekdays, minus team holidays and personal time off
- Date chips cycle **working → full day off → half day**
