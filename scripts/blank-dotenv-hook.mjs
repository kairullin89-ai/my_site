import fs from "node:fs";
import path from "node:path";

if (process.env.SMOKE_BLANK_ENV === "1") {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function blankDotEnv(file, options) {
    if (path.basename(String(file)) === ".env") return "";
    return readFileSync.call(fs, file, options);
  };
}
