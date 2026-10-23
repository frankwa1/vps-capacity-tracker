import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

type JiraLocalConfig = {
  baseUrl?: string;
  email?: string;
  token?: string;
};

function loadLocalJira(): JiraLocalConfig {
  const path = resolve(__dirname, "jira.local.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JiraLocalConfig;
  } catch {
    return {};
  }
}

function sendJson(res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function jiraProxy(): Plugin {
  const handle = async (
    req: { url?: string; headers: Record<string, string | string[] | undefined> },
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }
  ) => {
    try {
      const local = loadLocalJira();
      const baseHeader = String(req.headers["x-jira-base"] || local.baseUrl || "");
      if (!/^https?:\/\//i.test(baseHeader)) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Missing X-Jira-Base header and jira.local.json baseUrl" }));
        return;
      }

      const origin = new URL(baseHeader).origin;
      const suffix = req.url || "/";
      const target = origin + suffix;
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (req.headers.authorization) {
        headers.Authorization = String(req.headers.authorization);
      } else if (local.email && local.token) {
        headers.Authorization = "Basic " + Buffer.from(`${local.email}:${local.token}`).toString("base64");
      }

      const upstream = await fetch(target, { headers });
      const body = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      res.end(body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Proxy failed" }));
    }
  };

  return {
    name: "jira-proxy",
    configureServer(server) {
      server.middlewares.use("/local-jira", (req, res, next) => {
        if (req.method && req.method !== "GET") {
          next();
          return;
        }
        sendJson(res, 200, loadLocalJira());
      });
      server.middlewares.use("/jira", handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/local-jira", (req, res, next) => {
        if (req.method && req.method !== "GET") {
          next();
          return;
        }
        sendJson(res, 200, loadLocalJira());
      });
      server.middlewares.use("/jira", handle);
    },
  };
}

export default defineConfig({
  plugins: [react(), jiraProxy()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
