/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native/runtime-loaded packages must not be bundled by webpack.
  serverExternalPackages: ["@prisma/client", "@mybuild/db", "bullmq"],
};

export default nextConfig;
