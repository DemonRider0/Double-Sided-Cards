import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

await mkdir(dist, { recursive: true });

for (const [input, output] of [
  ["src/app.js", "app.js"],
  ["src/sdk-boot.js", "sdk-boot.js"],
  ["src/sdk-client.js", "sdk-client.js"],
  ["src/background.js", "background.js"],
]) {
  const bundle = await rollup({
    input: path.join(root, input),
    plugins: [
      {
        name: "local-events",
        resolveId(source) {
          if (source === "events") {
            return path.join(root, "vendor", "events.js");
          }

          return null;
        },
      },
      nodeResolve({
        browser: true,
        preferBuiltins: false,
      }),
    ],
  });

  await bundle.write({
    file: path.join(dist, output),
    format: "esm",
    intro: 'const process = { env: { NODE_ENV: "production" } };',
    sourcemap: false,
  });
  await bundle.close();
}
