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
      // Customer Master and Tally Data Import moved from Admin & Master Setup into
      // Forms. Bookmarks and old links land on the new sections, where the Forms
      // layout applies the module's access check (and the pages their own).
      { source: "/master-setup/customers", destination: "/forms/customer-master", permanent: false },
      { source: "/master-setup/tally-import", destination: "/forms/tally-import", permanent: false },
      { source: "/master-setup/tally-import/:path*", destination: "/forms/tally-import/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
