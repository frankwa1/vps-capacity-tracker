import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = resolve(root, "dist");
const port = Number(process.env.PORT || 8787);
const host = "127.0.0.1";

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function loadLocalJira() {
  const path = resolve(root, "jira.local.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function send(res, status, body, contentType) {
  res.writeHead(status, { "Content-Type": contentType || "text/plain; charset=utf-8" });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyJira(req, res, suffix) {
  try {
    const local = loadLocalJira();
    const baseHeader = String(req.headers["x-jira-base"] || local.baseUrl || "");
    if (!/^https?:\/\//i.test(baseHeader)) {
      sendJson(res, 400, { error: "Missing X-Jira-Base header and jira.local.json baseUrl" });
      return;
    }

    const origin = new URL(baseHeader).origin;
    const target = origin + suffix;
    const method = req.method || "GET";
    const headers = { Accept: "application/json" };
    if (req.headers.authorization) {
      headers.Authorization = String(req.headers.authorization);
    } else if (local.email && local.token) {
      headers.Authorization = "Basic " + Buffer.from(`${local.email}:${local.token}`).toString("base64");
    }

    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      const body = await readBody(req);
      if (body.length) {
        init.body = body;
        headers["Content-Type"] = String(req.headers["content-type"] || "application/json");
      }
    }

    const upstream = await fetch(target, init);
    const body = await upstream.text();
    send(res, upstream.status, body, upstream.headers.get("content-type") || "application/json; charset=utf-8");
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : "Proxy failed" });
  }
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const full = resolve(dist, normalize(relative));
  if (!full.startsWith(dist)) return null;
  return full;
}

function serveStatic(res, urlPath) {
  let file = safeFile(urlPath);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    file = join(dist, "index.html");
  }
  if (!existsSync(file)) {
    send(res, 500, "Run npm run build before starting the host.");
    return;
  }
  const type = mime[extname(file).toLowerCase()] || "application/octet-stream";
  send(res, 200, readFileSync(file), type);
}

if (!existsSync(join(dist, "index.html"))) {
  console.error("dist/index.html is missing. Run npm run build first.");
  process.exit(1);
}

let buildRunning = false;

function runNpmBuild(res) {
  if (buildRunning) {
    sendJson(res, 409, { ok: false, error: "Build already running" });
    return;
  }
  buildRunning = true;
  let child;
  try {
    child = spawn("npm run build", {
      cwd: root,
      windowsHide: true,
      shell: true,
    });
  } catch (err) {
    buildRunning = false;
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "Could not start build" });
    return;
  }
  let output = "";
  let replied = false;
  const finish = (status, body) => {
    if (replied) return;
    replied = true;
    buildRunning = false;
    sendJson(res, status, body);
  };
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk;
  });
  child.on("error", (err) => finish(500, { ok: false, error: err.message }));
  child.on("close", (code) => {
    if (code === 0) {
      finish(200, { ok: true });
      return;
    }
    const tail = output.trim().split(/\r?\n/).slice(-20).join("\n");
    finish(500, { ok: false, error: tail || `Build failed (${code})` });
  });
}

function toLocalIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function previousNightMergeWindow(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);

    yesterday.setDate(yesterday.getDate() - 1);

  const start = new Date(yesterday);
  const yDay = yesterday.getDay();
  if (yDay === 0) start.setDate(start.getDate() - 2);
  else if (yDay === 6) start.setDate(start.getDate() - 1);
  return { start, end: now, startIso: toLocalIsoDate(start) };
}

function extractTicketNumbers(title) {
  const found = [];
  const seen = new Set();
  const re = /VPS[-\s]?(\d+)/gi;
  let match;
  while ((match = re.exec(String(title || ""))) !== null) {
    const num = match[1];
    if (seen.has(num)) continue;
    seen.add(num);
    found.push(num);
  }
  return found;
}

function runGhJson(args) {
  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      // shell:true on Windows so gh resolves via PATH the same way as an interactive terminal
      child = spawn("gh", args, { cwd: root, windowsHide: true, shell: true });
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Could not start gh"));
      return;
    }
    let output = "";
    let errOut = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      errOut += chunk;
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((errOut || output || `gh failed (${code})`).trim()));
        return;
      }
      try {
        resolvePromise(JSON.parse(output || "[]"));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse gh output"));
      }
    });
  });
}

async function loadMergedPrsByBase(base) {
  return runGhJson([
    "search",
    "prs",
    "--owner=fox-wctt",
    "--author=@me",
    "--merged",
    `--base=${base}`,
    "--limit=100",
    "--json=title",
  ]);
}

function runMergedTicketLookup(res) {
  const { start, end, startIso } = previousNightMergeWindow();
  const args = [
    "search",
    "prs",
    "--author=@me",
    "--merged",
    `--merged-at=>=${startIso}`,
    "--owner=fox-wctt",
    "--limit=50",
    "--json=title,closedAt,url,number",
  ];
  void runGhJson(args)
    .then((prs) => {
      const startMs = start.getTime();
      const endMs = end.getTime();
      const numbers = [];
      const seen = new Set();
      for (const pr of prs) {
        const closed = Date.parse(pr.closedAt || "");
        if (!Number.isFinite(closed) || closed < startMs || closed > endMs) continue;
        for (const num of extractTicketNumbers(pr.title)) {
          if (seen.has(num)) continue;
          seen.add(num);
          numbers.push(num);
        }
      }
      numbers.sort((a, b) => Number(b) - Number(a));
      sendJson(res, 200, {
        ok: true,
        tickets: numbers.join(","),
        count: numbers.length,
        from: startIso,
        to: toLocalIsoDate(end),
      });
    })
    .catch((err) => {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "Could not start gh" });
    });
}

function ticketKeyFromNumber(num) {
  return `VPS-${num}`;
}

function collectTicketKeysFromPrs(prs, into) {
  for (const pr of prs) {
    for (const num of extractTicketNumbers(pr.title)) {
      into.add(ticketKeyFromNumber(num));
    }
  }
}

function buildMergeStatuses(developPrs, masterPrs) {
  const developKeys = new Set();
  const masterKeys = new Set();
  collectTicketKeysFromPrs(developPrs, developKeys);
  collectTicketKeysFromPrs(masterPrs, masterKeys);
  /** @type {Record<string, "QA1" | "QA2">} */
  const statuses = {};
  for (const key of developKeys) statuses[key] = "QA2";
  // master wins when a ticket is on both lanes
  for (const key of masterKeys) statuses[key] = "QA1";
  return { statuses, developCount: developKeys.size, masterCount: masterKeys.size };
}

function runTicketMergeStatusLookup(res) {
  void (async () => {
    // Sequential + retry: parallel gh searches sometimes return empty on Windows.
    let developPrs = await loadMergedPrsByBase("develop");
    let masterPrs = await loadMergedPrsByBase("master");
    if (developPrs.length === 0 && masterPrs.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
      developPrs = await loadMergedPrsByBase("develop");
      masterPrs = await loadMergedPrsByBase("master");
    }
    const result = buildMergeStatuses(developPrs, masterPrs);
    sendJson(res, 200, { ok: true, ...result });
  })().catch((err) => {
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "Merge status lookup failed" });
  });
}

const server = createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/local-jira" || url.startsWith("/local-jira?")) {
    if (req.method && req.method !== "GET") {
      send(res, 405, "Method Not Allowed");
      return;
    }
    sendJson(res, 200, loadLocalJira());
    return;
  }
  if (url === "/build" || url.startsWith("/build?")) {
    if (req.method !== "POST") {
      send(res, 405, "Method Not Allowed");
      return;
    }
    runNpmBuild(res);
    return;
  }
  if (url === "/merged-ticket-numbers" || url.startsWith("/merged-ticket-numbers?")) {
    if (req.method !== "GET") {
      send(res, 405, "Method Not Allowed");
      return;
    }
    runMergedTicketLookup(res);
    return;
  }
  if (url === "/ticket-merge-status" || url.startsWith("/ticket-merge-status?")) {
    if (req.method !== "GET") {
      send(res, 405, "Method Not Allowed");
      return;
    }
    runTicketMergeStatusLookup(res);
    return;
  }
  if (url === "/jira" || url.startsWith("/jira/") || url.startsWith("/jira?")) {
    void proxyJira(req, res, url.slice("/jira".length) || "/");
    return;
  }
  serveStatic(res, url);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Open http://${host}:${port}/`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Capacity Tracker http://${host}:${port}/`);
});
