/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The webhook and cron routes run on the Node.js runtime (needed for the
  // `postgres` driver and XML parsing). App Router routes default to Node.js.
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
