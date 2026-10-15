import fs from "node:fs";
import path from "node:path";

const buckets = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const BLOCKED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "server.ps1",
  "barys-system.txt",
]);

export function clientIp(req) {
  const address = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "";
  return address || "unknown";
}

export function guardRate(name, ip, limit) {
  const now = Math.floor(Date.now() / 1000);
  if (buckets.size > 2000) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.start >= 60) buckets.delete(key);
    }
  }
  const key = `${name}|${ip || "unknown"}`;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= 60) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function blocked(rel) {
  const norm = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const leaf = path.posix.basename(norm).toLowerCase();
  if (BLOCKED_NAMES.has(leaf) || leaf.startsWith(".env")) return true;
  if (norm === "data" || norm.startsWith("data/")) return true;
  if (norm === ".git" || norm.startsWith(".git/")) return true;
  if (norm === "node_modules" || norm.startsWith("node_modules/")) return true;
  if (norm === "src" || norm.startsWith("src/")) return true;
  if (norm === "barys" || norm.startsWith("barys/")) return true;
  return false;
}

function safeRelative(rel) {
  const norm = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.includes("\0")) return "";
  const parts = norm.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  return parts.join("/");
}

function fileInside(base, relative) {
  const clean = safeRelative(relative);
  if (!clean) return null;
  const root = path.resolve(base);
  const full = path.resolve(root, clean);
  if (!isInside(root, full)) return null;
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return null;
  if (stat.isDirectory()) {
    const index = path.join(full, "index.html");
    let indexStat;
    try {
      indexStat = fs.lstatSync(index);
    } catch {
      return null;
    }
    if (indexStat.isSymbolicLink() || !indexStat.isFile() || !isInside(root, index)) return null;
    return index;
  }
  return stat.isFile() ? full : null;
}

function sendFile(req, res, file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "X-Content-Type-Options": "nosniff",
  };
  if (ext === ".html") headers["Cache-Control"] = "no-cache";
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(file);
  const fail = () => {
    stream.destroy();
    if (!res.headersSent) res.writeHead(404);
    res.destroy();
  };
  stream.on("error", fail);
  res.on("error", fail);
  stream.pipe(res);
}

export function servePublicFile(req, res, root) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return true;
  }
  if (pathname === "/health" || pathname === "/chat" || pathname.startsWith("/api/")) return false;

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return true;
  }
  if (rel.includes("\0")) {
    res.writeHead(400);
    res.end();
    return true;
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (blocked(rel)) {
    res.writeHead(404);
    res.end();
    return true;
  }

  const uploadPrefix = "assets/products/uploads/";
  let file = null;
  if (rel.startsWith(uploadPrefix)) {
    file = fileInside(path.join(root, "assets", "products", "uploads"), rel.slice(uploadPrefix.length));
  } else {
    const distRoot = path.join(root, "dist");
    file = fileInside(distRoot, rel);
    if (!file && rel !== "index.html" && !path.posix.extname(safeRelative(rel))) {
      file = fileInside(distRoot, "index.html");
    }
  }
  if (!file) {
    res.writeHead(404);
    res.end();
    return true;
  }
  sendFile(req, res, file);
  return true;
}
