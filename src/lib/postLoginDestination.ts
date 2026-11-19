// Keep shared post links useful across login, without accepting external redirects.
export function postLoginDestination(state: unknown): string {
  if (!state || typeof state !== "object" || !("from" in state)) return "/";
  const from = state.from;
  if (typeof from !== "string" || from.length > 2048 || !from.startsWith("/") || /[\\\r\n]/.test(from)) return "/";
  try {
    const url = new URL(from, "https://zeronet.vercel.app");
    if (url.origin !== "https://zeronet.vercel.app" || !/^\/posts\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(url.pathname)) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
