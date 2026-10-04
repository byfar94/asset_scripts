// dashboard.js — live component status page with "Finder" buttons.
//
//   npm run dashboard            start on http://127.0.0.1:4848 and open Chrome
//   --port <n>                   another port
//   --folder <root>              assets root (default: the real tree)
//   --no-open                    don't launch the browser
//
// Every page load rescans the tree, so the page is always current — just
// refresh. Clicking "Finder" on a row asks this server to run macOS `open` on
// that component's folder. "Add component" posts a form to /add, which creates
// a folder skeleton + meta.json + summary via lib/add.js (create-only, never
// overwrites). The server listens on localhost only; /open accepts only paths
// that resolve inside the assets root; /add and /open refuse requests whose
// Origin is not this server. Ctrl+C to stop.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

import { DEFAULT_ROOT, parseArgs } from "./lib/args.js";
import { scanTree } from "./lib/status.js";
import { renderPage } from "./lib/html.js";
import { indexTree, createComponent } from "./lib/add.js";

const args = parseArgs(process.argv.slice(2));
const ROOT_DIR = path.resolve(args.value("--folder") ?? DEFAULT_ROOT);
const PORT = Number(args.value("--port") ?? 4848);
const NO_OPEN = args.has("--no-open");

if (!fs.existsSync(ROOT_DIR) || !fs.statSync(ROOT_DIR).isDirectory()) {
  console.error(`Assets root not found: ${ROOT_DIR}`);
  process.exit(1);
}

function safeDir(rel, sub) {
  if (typeof rel !== "string" || !rel) return null;
  let abs = path.resolve(ROOT_DIR, rel);
  if (sub) abs = path.join(abs, sub);
  if (abs !== ROOT_DIR && !abs.startsWith(ROOT_DIR + path.sep)) return null;
  try {
    if (!fs.statSync(abs).isDirectory()) return null;
  } catch {
    return null;
  }
  return abs;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const sendJson = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/add" && req.method === "POST") {
    if (!sameOrigin(req)) return sendJson(res, 403, { outcome: "error", message: "forbidden origin" });
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendJson(res, 400, { outcome: "error", message: err.message });
    }
    const result = createComponent({ rootDir: ROOT_DIR, index: indexTree(ROOT_DIR), row: body });
    const { meta, ...rest } = result;
    console.log(`[add] ${rest.outcome}${rest.rel ? ` ${rest.rel}` : ""}${rest.message ? ` — ${rest.message}` : ""}`);
    return sendJson(res, rest.outcome === "created" ? 201 : 200, rest);
  }
  if (url.pathname === "/") {
    const data = scanTree(ROOT_DIR);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(renderPage(data, { live: true }));
    return;
  }
  if (url.pathname === "/open") {
    if (!sameOrigin(req)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden origin");
      return;
    }
    const sub = url.searchParams.get("sub") ?? "";
    const dir = safeDir(url.searchParams.get("rel"), /^[a-z_]+$/i.test(sub) ? sub : "");
    if (!dir) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("not a component folder");
      return;
    }
    spawn("open", [dir], { stdio: "ignore", detached: true }).unref();
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://127.0.0.1:${PORT}/`;
  console.log(`Component status dashboard: ${addr}`);
  console.log(`Root: ${ROOT_DIR}`);
  console.log("Refresh the page to rescan. Ctrl+C to stop.");
  if (!NO_OPEN) spawn("open", [addr], { stdio: "ignore", detached: true }).unref();
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — is the dashboard already running? Try --port ${PORT + 1}.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
