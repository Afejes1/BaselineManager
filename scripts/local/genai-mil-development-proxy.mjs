import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join, resolve, sep } from "node:path";

const PORT = 38471;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const STATUS_MARKER = Buffer.from("\n__A2O_HTTP_STATUS__:", "utf8");
const clean = (value) => typeof value === "string" ? value.trim() : "";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function authorized(value) {
  const expected = Buffer.from(clean(process.env.GENAI_MIL_LOCAL_PROXY_TOKEN), "utf8");
  const actual = Buffer.from(clean(value), "utf8");
  return expected.length === 64 && actual.length === expected.length && timingSafeEqual(expected, actual);
}

function sendJson(response, status, message) {
  const body = JSON.stringify({ error: { message } });
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close", "cache-control": "no-store" });
  response.end(body);
}

if (clean(process.env.GENAI_MIL_TLS_MODE) !== "development-insecure") fail("Development TLS mode is not enabled.");
if (!/^[a-f0-9]{64}$/.test(clean(process.env.GENAI_MIL_LOCAL_PROXY_TOKEN))) fail("The local proxy token is missing or invalid.");

let endpoint;
try { endpoint = new URL(clean(process.env.GENAI_MIL_API_URL)); }
catch { fail("The configured GenAI.mil endpoint is invalid."); }
const endpointHost = endpoint.hostname.toLowerCase();
if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || !(endpointHost === "genai.mil" || endpointHost.endsWith(".genai.mil"))) fail("The development proxy accepts only an HTTPS GenAI.mil endpoint.");

const secretRoot = realpathSync(resolve(".a2o-secrets"));
const headerCandidate = resolve(secretRoot, "genai-mil.curl.headers");
if (!existsSync(headerCandidate)) fail("The protected curl header file is missing. Run npm run local:genai:tls-bypass.");
const headerPath = realpathSync(headerCandidate);
if (!headerPath.startsWith(`${secretRoot}${sep}`)) fail("The protected curl header path escaped local secret storage.");
const headerLines = readFileSync(headerPath, "utf8").split(/\r?\n/).filter(Boolean);
if (headerLines.length !== 2 || headerLines[0].toLowerCase() !== "content-type: application/json" || !/^authorization: bearer \S+$/i.test(headerLines[1])) fail("The protected curl header file is invalid. Re-run npm run local:genai:tls-bypass.");

const systemRoot = clean(process.env.SystemRoot);
const curlExecutable = systemRoot ? join(systemRoot, "System32", "curl.exe") : "";
if (!curlExecutable || !existsSync(curlExecutable)) fail("Windows curl.exe is required for the development TLS bypass.");

const server = createServer((request, response) => {
  const remote = request.socket.remoteAddress || "";
  if (!(remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1")) return sendJson(response, 403, "The development proxy accepts loopback requests only.");
  if (request.method !== "POST" || request.url !== "/genai") return sendJson(response, 404, "Not found.");
  if (!authorized(request.headers["x-a2o-genai-proxy-token"])) return sendJson(response, 403, "The local development proxy token was not accepted.");
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return sendJson(response, 413, "The grounded assistant request exceeded the local proxy limit.");

  const chunks = [];
  let received = 0;
  request.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) request.destroy(new Error("request_too_large"));
    else chunks.push(chunk);
  });
  request.on("error", (error) => {
    if (!response.headersSent) sendJson(response, error.message === "request_too_large" ? 413 : 400, "The local proxy could not read the request.");
  });
  request.on("end", () => {
    const child = spawn(curlExecutable, [
      "--silent", "--show-error", "--no-progress-meter",
      "--request", "POST",
      "--url", endpoint.toString(),
      "--header", `@${headerPath}`,
      "--data-binary", "@-",
      "--connect-timeout", "15",
      "--max-time", "45",
      "--max-redirs", "0",
      "--proto", "=https",
      "--ssl-no-revoke",
      "--insecure",
      "--write-out", "\n__A2O_HTTP_STATUS__:%{http_code}",
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_RESPONSE_BYTES) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => { if (Buffer.concat(stderr).length < 32_768) stderr.push(chunk); });
    child.on("error", () => { if (!response.headersSent) sendJson(response, 502, "The local development TLS transport could not start curl.exe."); });
    child.on("close", (code) => {
      if (response.headersSent) return;
      if (outputBytes > MAX_RESPONSE_BYTES) return sendJson(response, 502, "The GenAI.mil response exceeded the local proxy limit.");
      const output = Buffer.concat(stdout);
      const markerIndex = output.lastIndexOf(STATUS_MARKER);
      const statusText = markerIndex >= 0 ? output.subarray(markerIndex + STATUS_MARKER.length).toString("utf8").trim() : "";
      const status = Number(statusText);
      if (code !== 0 || markerIndex < 0 || !Number.isInteger(status) || status < 100 || status > 599) {
        const diagnostic = Buffer.concat(stderr).toString("utf8").replace(/authorization:\s*bearer\s+\S+/ig, "authorization: Bearer [redacted]").slice(0, 300);
        return sendJson(response, 502, `GenAI.mil could not be reached through the development TLS transport${diagnostic ? `: ${diagnostic}` : "."}`);
      }
      const body = output.subarray(0, markerIndex);
      response.writeHead(status, { "content-type": "application/json", "content-length": body.length, connection: "close", "cache-control": "no-store" });
      response.end(body);
    });
    child.stdin.end(Buffer.concat(chunks));
  });
});

server.headersTimeout = 10_000;
server.requestTimeout = 50_000;
server.listen(PORT, "127.0.0.1");
server.on("error", () => fail("The local GenAI.mil development TLS proxy could not bind to 127.0.0.1:38471."));
