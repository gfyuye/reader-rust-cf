import worker, { Env } from "../worker/index";

/**
 * Cloudflare Pages Function Root Handler
 * Routes API endpoints (/reader3/*, /health) to Worker backend,
 * and allows all static frontend assets (HTML, JS, CSS, SVG) to be served by Pages CDN.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // 1. All backend API routes and health checks go to Worker
  if (url.pathname.startsWith("/reader3/") || url.pathname === "/health") {
    return worker.fetch(context.request, context.env, {
      waitUntil: (promise: Promise<any>) => context.waitUntil(promise),
      passThroughOnException: () => context.passThroughOnException(),
    } as any);
  }

  // 2. Try static asset from Pages CDN first (serves JS, CSS, images, etc.)
  const response = await context.next();
  if (response.status !== 404) {
    return response;
  }

  // 3. If 404, check if it's an uploaded user asset under /assets/{user_ns}/...
  if (url.pathname.startsWith("/assets/") && context.env?.BUCKET) {
    return worker.fetch(context.request, context.env, {
      waitUntil: (promise: Promise<any>) => context.waitUntil(promise),
      passThroughOnException: () => context.passThroughOnException(),
    } as any);
  }

  // 4. SPA Fallback: for client-side HTML5 history navigation (e.g. /shelf, /explore),
  // return index.html instead of 404
  if (context.request.headers.get("Accept")?.includes("text/html")) {
    const indexReq = new Request(new URL("/", context.request.url).toString(), context.request);
    return context.env.ASSETS ? context.env.ASSETS.fetch(indexReq) : context.next();
  }

  return response;
};
