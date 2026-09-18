import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module: must stay external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // The OAuth callback's query string holds the (single-use) authorization code and state: keep it out of
  // the dev server's request log. (Production builds do not log incoming requests.)
  logging: { incomingRequests: { ignore: [/\/api\/auth\/google/] } },
  // The landing page used to live at /guide; it is the site root now (the app starts at /upload).
  redirects: async () => [{ source: "/guide", destination: "/", permanent: false }],
};

export default nextConfig;
