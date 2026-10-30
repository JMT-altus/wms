/**
 * Real Resend delivery check for the employee invite ("login details") email.
 *
 * Sends the actual CredentialsInviteEmail template through Resend using the
 * configured RESEND_API_KEY / RESEND_FROM_EMAIL — the same sender the Invite
 * Employee action uses — to the address you pass. Nothing is written to the
 * database and no Firebase account is created or changed; the password slot
 * carries a placeholder, never a real credential.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/smoke-test-invite-email.ts <email>
 *
 * Exit 0 = Resend accepted the message (an id is printed). Exit 1 = it did
 * not; the reason is printed. With the resend.dev sandbox sender only the
 * Resend account owner's address is accepted — that is the restriction a
 * verified domain lifts.
 *
 * Bypasses `lib/email/resend.ts` (it uses `import "server-only"`, which throws
 * outside an RSC) and inlines the same SDK call; the template is shared.
 */
import { Resend } from "resend";
import { CredentialsInviteEmail } from "../emails/credentials-invite";

const SANDBOX = /@resend\.dev\s*>?\s*$/i;

async function main() {
  const to = process.argv[2]?.trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("Usage: pnpm tsx --env-file=.env.local scripts/smoke-test-invite-email.ts <email>");
    process.exit(1);
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[smoke] RESEND_API_KEY is not set");
    process.exit(1);
  }
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    console.error("[smoke] RESEND_FROM_EMAIL is not set — the app sends nothing without it");
    process.exit(1);
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

  console.log(`[smoke] from: ${from}${SANDBOX.test(from) ? "  (Resend sandbox sender — delivers only to the account owner)" : ""}`);
  console.log(`[smoke] to:   ${to}`);

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: "Your JMT Drive Solutions Dashboard login details (delivery test)",
    react: CredentialsInviteEmail({
      inviteeName: "Delivery test",
      inviterName: "WMS smoke test",
      email: to,
      password: "(not included in this test)",
      loginUrl: `${siteUrl}/login`,
    }),
  });
  if (error) {
    console.error(`[smoke] FAILED — ${error.name}: ${error.message}`);
    if (/testing emails to your own email address|verify a domain/i.test(error.message)) {
      console.error(
        "[smoke] This is Resend's sandbox restriction. Verify your domain at https://resend.com/domains\n" +
          "        (add the DNS records it shows), then set RESEND_FROM_EMAIL to an address on that domain.",
      );
    }
    process.exit(1);
  }
  console.log(`[smoke] OK — Resend accepted the message, id ${data?.id ?? "(none)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] unexpected failure:", err instanceof Error ? err.message : err);
  process.exit(1);
});
