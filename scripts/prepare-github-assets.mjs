import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, ".local-assets");
const targetDir = path.join(root, "assets", "local-assets");

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

await mkdir(targetDir, { recursive: true });
await writeFile(path.join(root, ".nojekyll"), "");

const entries = await readdir(sourceDir, { withFileTypes: true });
let copied = 0;
let totalBytes = 0;

for (const entry of entries) {
  if (!entry.isFile()) {
    continue;
  }

  const sourcePath = path.join(sourceDir, entry.name);
  const targetPath = path.join(targetDir, entry.name);
  const details = await stat(sourcePath);

  await copyFile(sourcePath, targetPath);
  copied += 1;
  totalBytes += details.size;
}

console.log(`${copied} assets copiados para assets/local-assets (${formatMb(totalBytes)}).`);
