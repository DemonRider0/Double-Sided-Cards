import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const port = Number.parseInt(process.argv[2] ?? "5173", 10);
const localAssetsDir = path.join(root, ".local-assets");
const scenePresetPath = path.join(root, "assets", "scene-preset.json");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
]);

function getCorsHeaders(request) {
  const origin = request.headers.origin;
  const requestedHeaders = request.headers["access-control-request-headers"];

  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      requestedHeaders ||
      "Content-Type, Access-Control-Request-Private-Network, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network",
  };
}

function resolveRequestPath(rawPathname) {
  const pathname = rawPathname === "/" ? "/index.html" : rawPathname;
  const safePath = decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const filePath = path.resolve(root, safePath);

  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return null;
  }

  return filePath;
}

function sanitizeName(rawName) {
  return (rawName || "image")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

function extensionFromMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/svg+xml") return ".svg";
  return ".png";
}

function getPublicOrigin(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || (request.socket.encrypted ? "https" : "http");
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || request.headers.host;

  return `${proto}://${host}`;
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function handleLocalAssetUpload(request, requestUrl, response) {
  if (request.method !== "POST") {
    response.writeHead(405, getCorsHeaders(request));
    response.end("Metodo nao permitido");
    return;
  }

  const originalName = sanitizeName(requestUrl.searchParams.get("name"));
  const mime = request.headers["content-type"]?.split(";")[0] || "image/png";
  const parsedExtension = path.extname(originalName);
  const extension = parsedExtension || extensionFromMime(mime);
  const baseName = path.basename(originalName, parsedExtension).slice(0, 64) || "image";
  const filename = `${Date.now()}-${randomUUID()}-${baseName}${extension}`;
  const filePath = path.join(localAssetsDir, filename);
  const body = await readRequestBody(request);

  await mkdir(localAssetsDir, { recursive: true });
  await writeFile(filePath, body);

  const assetUrl = `${getPublicOrigin(request)}/.local-assets/${encodeURIComponent(filename)}`;
  response.writeHead(200, {
    ...getCorsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ url: assetUrl }));
}

async function handleRemoteAssetCache(request, requestUrl, response) {
  const remoteUrl = requestUrl.searchParams.get("url");

  if (!remoteUrl) {
    response.writeHead(400, getCorsHeaders(request));
    response.end("URL ausente");
    return;
  }

  const remoteResponse = await fetch(remoteUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 Cartas-Duplas-Servidor-Local",
    },
  });

  if (!remoteResponse.ok) {
    response.writeHead(502, getCorsHeaders(request));
    response.end("Imagem remota indisponivel");
    return;
  }

  const mime = remoteResponse.headers.get("content-type")?.split(";")[0] || "image/png";
  if (!mime.startsWith("image/")) {
    response.writeHead(415, getCorsHeaders(request));
    response.end("A URL remota nao e uma imagem");
    return;
  }

  const requestedName = sanitizeName(requestUrl.searchParams.get("name"));
  const parsedExtension = path.extname(requestedName);
  const extension = parsedExtension || extensionFromMime(mime);
  const baseName = path.basename(requestedName, parsedExtension).slice(0, 64) || "image";
  const filename = `${Date.now()}-${randomUUID()}-${baseName}${extension}`;
  const filePath = path.join(localAssetsDir, filename);
  const body = Buffer.from(await remoteResponse.arrayBuffer());

  await mkdir(localAssetsDir, { recursive: true });
  await writeFile(filePath, body);

  const assetUrl = `${getPublicOrigin(request)}/.local-assets/${encodeURIComponent(filename)}`;
  response.writeHead(200, {
    ...getCorsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ url: assetUrl }));
}

function isScenePreset(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.version === 1 &&
      Array.isArray(value.items) &&
      value.metadata &&
      typeof value.metadata === "object",
  );
}

async function handleScenePresetSave(request, response) {
  if (request.method !== "POST") {
    response.writeHead(405, getCorsHeaders(request));
    response.end("Metodo nao permitido");
    return;
  }

  const body = await readRequestBody(request);
  const preset = JSON.parse(body.toString("utf8"));

  if (!isScenePreset(preset)) {
    response.writeHead(400, getCorsHeaders(request));
    response.end("Tabuleiro padrao invalido");
    return;
  }

  await mkdir(path.dirname(scenePresetPath), { recursive: true });
  await writeFile(scenePresetPath, `${JSON.stringify(preset, null, 2)}\n`, "utf8");

  response.writeHead(200, {
    ...getCorsHeaders(request),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(
    JSON.stringify({
      itemCount: preset.items.length,
      savedAt: preset.savedAt,
      url: "/assets/scene-preset.json",
    }),
  );
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, getCorsHeaders(request));
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (requestUrl.pathname === "/__local_asset") {
      await handleLocalAssetUpload(request, requestUrl, response);
      return;
    }

    if (requestUrl.pathname === "/__remote_asset") {
      await handleRemoteAssetCache(request, requestUrl, response);
      return;
    }

    if (requestUrl.pathname === "/__scene_preset") {
      await handleScenePresetSave(request, response);
      return;
    }

    const filePath = resolveRequestPath(requestUrl.pathname);

    if (!filePath) {
      response.writeHead(403, getCorsHeaders(request));
      response.end("Acesso negado");
      return;
    }

    const servedPath = await resolveServedPath(filePath);
    const body = await readFile(servedPath);
    const extension = path.extname(servedPath);
    response.writeHead(200, {
      ...getCorsHeaders(request),
      "Cache-Control": "no-store",
      "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, {
      ...getCorsHeaders(request),
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Nao encontrado");
  }
});

async function resolveServedPath(filePath) {
  try {
    await readFile(filePath);
    return filePath;
  } catch {
    if (!path.extname(filePath)) {
      for (const candidate of [`${filePath}.js`, path.join(filePath, "index.js")]) {
        try {
          await readFile(candidate);
          return candidate;
        } catch {
          // Tenta a proxima opcao de resolucao de modulo para navegador.
        }
      }
    }

    throw new Error("Nao encontrado");
  }
}

server.listen(port, () => {
  console.log(`Servidor local de Cartas Duplas: http://localhost:${port}/manifest.json`);
});
