import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

function isProjectMedia(urlPath) {
  return (
    urlPath === "/manufacture_01.jpg" ||
    urlPath.startsWith("/assets/")
  );
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function serveProjectMedia(req, res, next) {
  try {
    const urlPath = decodeURIComponent((req.url || "").split("?")[0]);
    if (!isProjectMedia(urlPath)) return next();
    const rel = urlPath.replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    const fromRoot = path.relative(root, file);
    const ext = path.extname(file).toLowerCase();
    const allowed =
      fromRoot === "manufacture_01.jpg" ||
      (fromRoot.startsWith(`assets${path.sep}`) && MEDIA_TYPES[ext]);
    if (!allowed || !isInside(root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return next();
    }
    res.setHeader("Content-Type", MEDIA_TYPES[ext] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  } catch {
    next();
  }
}

function copyProjectMedia() {
  return {
    name: "copy-project-media",
    configureServer(server) {
      server.middlewares.use(serveProjectMedia);
    },
    closeBundle() {
      const dist = path.join(root, "dist");
      fs.mkdirSync(dist, { recursive: true });
      for (const name of ["manufacture_01.jpg"]) {
        const from = path.join(root, name);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dist, name));
      }
      const assets = path.join(root, "assets");
      if (fs.existsSync(assets)) {
        fs.cpSync(assets, path.join(dist, "assets"), { recursive: true });
      }
    },
  };
}

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:5500",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), copyProjectMedia()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    outDir: "dist",
    assetsDir: "static",
    emptyOutDir: true,
  },
});
