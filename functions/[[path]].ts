import worker, { Env } from "../worker/index";

/**
 * Cloudflare Pages Function Root Handler
 * Automatically handles API routes (/reader3/*, /assets/*, /health)
 * and passes through all other requests to the Vue static assets in frontend/dist.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // If the request is for the backend API or asset streaming, handle it via Worker
  if (
    url.pathname.startsWith("/reader3/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/health"
  ) {
    return worker.fetch(context.request, context.env, {
      waitUntil: (promise: Promise<any>) => context.waitUntil(promise),
      passThroughOnException: () => context.passThroughOnException(),
    } as any);
  }

  // Otherwise, fall through to static frontend files (HTML/CSS/JS in frontend/dist)
  return context.next();
};
