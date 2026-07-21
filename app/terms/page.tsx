import type { Metadata } from "next";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service · JMT Drive Solutions Dashboard",
  description:
    "Terms governing access to the JMT Drive Solutions operations dashboard.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="JMT Drive Solutions · Legal"
      title="Terms of Service"
      lastUpdated="2026-05-14"
      intro="These terms govern your access to the JMT Drive Solutions operations dashboard. The platform is for the exclusive use of JMT Drive Solutions and the staff they authorise."
    >
      <h2>1 · The short version</h2>
      <p>
        The dashboard is an internal operations tool. You only get access if a
        JMT Drive Solutions administrator invites you. You agree to use it for
        JMT Drive Solutions's business purposes, to keep client information
        confidential, and to not share your password with anyone.
      </p>

      <h2>2 · Who's behind this</h2>
      <p>
        <strong>The platform owner:</strong> JMT Drive Solutions. JMT Drive Solutions
        builds and maintains the dashboard software and owns the operational
        data captured in it.
      </p>
      <p>
        When you sign in, you accept these terms: you agree to abide by
        JMT Drive Solutions's platform rules and to handle JMT Drive Solutions's
        operational data responsibly.
      </p>

      <h2>3 · Eligibility &amp; accounts</h2>
      <p>
        Access is invite-only. Public sign-up is disabled. A JMT Drive Solutions
        administrator must create an account on your behalf. By accepting an
        invite you confirm that:
      </p>
      <ul>
        <li>You are a JMT Drive Solutions employee, director, or contractor with a written engagement.</li>
        <li>The email address tied to your invite is your work email and remains under your sole control.</li>
        <li>You are at least 18 years old.</li>
        <li>You will not let anyone else use your credentials.</li>
      </ul>
      <p>
        If you leave the organisation, your account will be deactivated; this
        does not delete the historical record of your activity on tasks you
        worked on.
      </p>

      <h2>4 · Acceptable use</h2>
      <p>You agree NOT to:</p>
      <ul>
        <li>
          Use the dashboard to view, copy, or share client data
          for any purpose outside your role at JMT Drive Solutions.
        </li>
        <li>
          Attempt to access tasks, employees, or settings that fall outside
          your assigned permissions.
        </li>
        <li>
          Bypass authentication, the role-based gates (admin / initiator /
          doer), the rate limiters in Firebase Auth, or the row-level
          security on the database.
        </li>
        <li>
          Automate scraping or bulk-exporting data through the UI or API
          beyond the export features the dashboard exposes (CSV download,
          activity export).
        </li>
        <li>
          Upload content that is unlawful, defamatory, infringes any
          third-party right, or contains malware.
        </li>
        <li>
          Reverse-engineer, decompile, or attempt to extract the source code
          of the dashboard outside of any open-sourced components.
        </li>
      </ul>

      <h2>5 · Data &amp; confidentiality</h2>
      <p>
        Client communications, internal notes, and the operational task data
        captured in the dashboard are confidential business information of
        JMT Drive Solutions. You will treat them as such — no screenshots in public
        channels, no forwarding outside the organisation, no public
        commentary on identifiable clients.
      </p>
      <p>
        How we handle data on the technical side is detailed in our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>6 · Intellectual property</h2>
      <p>
        The dashboard software, its design, brand marks, and all derivative
        analytics are owned by JMT Drive Solutions. The operational data you
        generate using the dashboard — tasks, comments, status history,
        attached notes — belongs to JMT Drive Solutions.
      </p>

      <h2>7 · Service availability</h2>
      <p>
        The dashboard is provided on a best-effort basis. We use Vercel for
        the application layer, Supabase (Singapore region) for the database,
        Firebase Auth (US region) for identity, Resend for email, and
        optionally Slack / WhatsApp Cloud API / Web Push for notifications.
        We do not guarantee uninterrupted service — providers occasionally
        have outages, and we may take the dashboard down for maintenance
        with notice in the team channel.
      </p>

      <h2>8 · Termination</h2>
      <p>
        A JMT Drive Solutions administrator may deactivate your account at any time
        — immediately on separation from the organisation, or sooner if
        these terms are violated. Deactivation revokes your Firebase session
        and prevents further sign-in; your historical task contributions
        remain in the database for audit purposes.
      </p>

      <h2>9 · Disclaimers &amp; liability</h2>
      <p>
        The dashboard is provided <strong>"AS IS"</strong>, without warranties
        of any kind. JMT Drive Solutions does not warrant that the software is free
        of defects, that data will never be lost, or that the analytics
        derived from it are accurate enough for regulatory or legal
        decisions. You will not rely on the dashboard as the sole record of
        any operational decision.
      </p>
      <p>
        To the maximum extent permitted by Indian law, JMT Drive Solutions is not
        liable for any indirect, incidental, special, or consequential
        damages arising from your use of the dashboard.
      </p>

      <h2>10 · Governing law</h2>
      <p>
        These terms are governed by the laws of India. Any dispute will be
        subject to the exclusive jurisdiction of the courts at Mumbai,
        Maharashtra.
      </p>

      <h2>11 · Changes</h2>
      <p>
        We may update these terms as the dashboard evolves. Material changes
        will be announced in the dashboard's notification feed and via email
        to all active users. Continued use of the dashboard after the
        notification constitutes acceptance of the updated terms.
      </p>

      <h2>12 · Contact</h2>
      <p>
        Questions, concerns, or notices under these terms can go to{" "}
        <a href="mailto:mihir.jmtds@gmail.com">mihir.jmtds@gmail.com</a>.
      </p>
    </LegalShell>
  );
}
