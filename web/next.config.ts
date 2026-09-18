import type { NextConfig } from "next";

const config: NextConfig = {
  // pg is a native-ish driver; keep it out of the bundler
  serverExternalPackages: ["pg"],
};

export default config;
