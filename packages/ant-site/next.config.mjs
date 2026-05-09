/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Workspace TS package — Next must transpile it (no separate `next` build).
  transpilePackages: ['@ant/auth-client'],
};

export default nextConfig;
