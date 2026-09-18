/**
 * A redirect to a path on THIS site, sent as a relative Location. The browser resolves it against the address
 * it actually used, so it is right behind a proxy too — unlike an absolute URL built from request.url, which
 * behind Railway's proxy is the container's own address (https://localhost:8080/…). No host header is trusted.
 * `path` must be an app path starting with a single "/" (never a caller-supplied value).
 */
export function localRedirect(path: string, status: 302 | 303 | 307 = 303): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("localRedirect: not a local path");
  return new Response(null, { status, headers: { Location: path } });
}
