import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Resolve this config file's directory in both ESM and CJS contexts so
// Turbopack's workspace-root detection always points at the project.
// Without this pin, a stray lockfile higher up the filesystem (e.g.
// ~/package-lock.json from a global pnpm install) makes Next 16 infer
// the home directory as the workspace root, which silently breaks
// every dynamic API route (they 404 because Next is compiling out of
// the wrong tree).
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot
  },
  // sharp is a native module used by the logo-invert route — keep it external
  // so Next doesn't try to bundle its platform-specific binaries.
  serverExternalPackages: ["sharp"],
  // The Learn library moved from /docs to /learn to match its branding.
  // Permanently redirect old URLs so existing links and search results
  // (the guides are a public SEO surface) keep working.
  async redirects() {
    return [
      { source: "/docs", destination: "/learn", permanent: true },
      { source: "/docs/:slug", destination: "/learn/:slug", permanent: true }
    ];
  }
};

export default nextConfig;
