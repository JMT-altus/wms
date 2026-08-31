import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  /**
   * gstinapi.in API key for the KYC form's "Verify GSTIN".
   *
   * Optional: the form works without it and the button reports that lookup is
   * not configured, so a missing key must not stop the app booting.
   * Server-side only — deliberately NOT NEXT_PUBLIC_*, which would ship the
   * key to every browser.
   */
  GSTIN_API_KEY: z.string().min(8).optional(),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GSTIN_API_KEY: process.env.GSTIN_API_KEY,
});
