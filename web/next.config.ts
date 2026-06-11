import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@arc-agents/db', '@caliber/x402-client'],
  // The x402 buyer SDK + viem are node-only; load them at runtime instead of
  // bundling them into the /api/metered/try-it server route.
  serverExternalPackages: ['@circle-fin/x402-batching', 'viem'],
};

export default nextConfig;
