/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ] }]; },
  // Incident records and local credentials are runtime data, never deployment assets.
  outputFileTracingExcludes: { '/*': ['./.data/**/*', './.env*', './.git/**/*', './config/**/*', './deploy/local/**/*'] },
}

module.exports = nextConfig;
