import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  devIndicators: false,
  serverExternalPackages: ["firebase-admin", "pdfkit"],
  async redirects() {
    return [
      // Collection moved out of Forms into its own module. Old links, bookmarks
      // and notification deep-links keep working; the Collection layout then
      // applies the module's own access check.
      { source: "/forms/collection", destination: "/collection/dashboard", permanent: false },
      { source: "/forms/collection/:path*", destination: "/collection/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
