import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dataDir = "/app/data";
const uploadDir = "/app/assets/products/uploads";

function account(name) {
  let text = "";
  try {
    text = fs.readFileSync("/etc/passwd", "utf8");
  } catch {
    return null;
  }
  const line = text.split("\n").find((row) => row.startsWith(`${name}:`));
  if (!line) return null;
  const parts = line.split(":");
  const uid = Number(parts[2]);
  const gid = Number(parts[3]);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null;
  return { uid, gid };
}

function ownTree(dir, uid, gid) {
  try {
    fs.lchownSync(dir, uid, gid);
  } catch {
    return false;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        fs.lchownSync(full, uid, gid);
      } catch {
        return false;
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (!ownTree(full, uid, gid)) return false;
      continue;
    }
    try {
      fs.lchownSync(full, uid, gid);
    } catch {
      return false;
    }
  }
  return true;
}

function writableAs(dir, uid, gid) {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  const result = spawnSync(
    process.execPath,
    ["-e", "const fs=require('node:fs'); const file=process.argv[1]; fs.writeFileSync(file,'ok'); fs.rmSync(file);", probe],
    { uid, gid }
  );
  try {
    fs.rmSync(probe, { force: true });
  } catch {
    /* probe is already gone when the check succeeds */
  }
  return result.status === 0;
}

const nodeUser = account("node");
const rootUser = typeof process.getuid === "function" && process.getuid() === 0;
if (rootUser && nodeUser) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  ownTree(dataDir, nodeUser.uid, nodeUser.gid);
  ownTree(uploadDir, nodeUser.uid, nodeUser.gid);
  if (writableAs(dataDir, nodeUser.uid, nodeUser.gid) && writableAs(uploadDir, nodeUser.uid, nodeUser.gid)) {
    process.setgid(nodeUser.gid);
    process.setuid(nodeUser.uid);
  } else {
    console.error("Пользователь node не может записать базу. Сервер остаётся root, чтобы заказы сохранялись.");
  }
}

await import("./worker.js");
