import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const uploadToken = randomBytes(32).toString("base64url");
const readCapability = randomBytes(32).toString("base64url");
const uploadOnly = process.argv.includes("--upload-only");

function putSecret(name, value) {
  const result = spawnSync(wrangler, ["secret", "put", name], {
    cwd: root,
    input: `${value}\n`,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Não foi possível configurar ${name} no Worker.`);
  }
}

putSecret("POC_UPLOAD_TOKEN", uploadToken);
if (!uploadOnly) {
  putSecret("POC_READ_CAPABILITY", readCapability);
}

console.log("\nCapability temporária de upload da POC (guarde e cole no painel):");
console.log(uploadToken);
console.log(
  uploadOnly
    ? "\nA capability de leitura existente foi preservada."
    : "\nA capability de leitura foi salva somente como secret do Worker.",
);
