/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const baseSecurityHeaders: Record<string, string> = {
  "cache-control": "private, no-store",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function secured(response: Response, localRequest: boolean) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(baseSecurityHeaders)) if (!headers.has(name)) headers.set(name, value);
  const frameAncestors = localRequest ? "'self'" : "'self' https://chatgpt.com https://*.chatgpt.com https://*.openai.com";
  if (!headers.has("content-security-policy")) headers.set("content-security-policy", `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors ${frameAncestors}; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const localRequest = isLocalHost(url.hostname);

    if (url.pathname.startsWith("/api/") && !localRequest) {
      const userId = request.headers.get("oai-authenticated-user-id")?.trim();
      const email = request.headers.get("oai-authenticated-user-email")?.trim();
      if (!userId || !email) return secured(Response.json({ error: "Authentication is required." }, { status: 401 }), localRequest);
    }

    if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || (!origin && !localRequest)) return secured(Response.json({ error: "The request origin is not allowed." }, { status: 403 }), localRequest);
      const contentType = request.headers.get("content-type")?.toLowerCase() || "";
      if (!contentType.startsWith("application/json") && !contentType.startsWith("multipart/form-data")) return secured(Response.json({ error: "Use JSON or multipart form data for API updates." }, { status: 415 }), localRequest);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return secured(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths), localRequest);
    }

    return secured(await handler.fetch(request, env, ctx), localRequest);
  },
};

export default worker;
