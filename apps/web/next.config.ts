import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@0run/shared"],
  // Standalone output for the Docker runner. In a monorepo the trace root must be the
  // repo root, otherwise packages/shared is left out of .next/standalone.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
