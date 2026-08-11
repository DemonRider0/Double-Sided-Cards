import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presetRoot = path.join(root, "assets", "scene-presets");
const indexPath = path.join(presetRoot, "index.json");
const presetFiles = ["tutorial.json", "missao-0-5.json"];
const presets = [];

for (const filename of presetFiles) {
  const preset = JSON.parse(await readFile(path.join(presetRoot, filename), "utf8"));
  if (
    typeof preset.id !== "string" ||
    typeof preset.name !== "string" ||
    typeof preset.savedAt !== "string" ||
    !Number.isInteger(preset.itemCount) ||
    preset.itemCount !== preset.items?.length
  ) {
    throw new Error(`Preset sem resumo valido: ${filename}`);
  }

  presets.push({
    id: preset.id,
    name: preset.name,
    savedAt: preset.savedAt,
    itemCount: preset.itemCount,
    url: `assets/scene-presets/${filename}`,
  });
}

await writeFile(indexPath, `${JSON.stringify({ version: 1, presets }, null, 2)}\n`);
console.log(`Indice criado com ${presets.length} mapas.`);
