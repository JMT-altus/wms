import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Resend sender: the `from` address comes from RESEND_FROM_EMAIL at call
// time with no hard-coded fallback, Resend's sandbox restriction is reported
// in actionable words, and nothing is sent when email isn't configured.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => send(...a) };
  },
}));

import { describeResendError, isSandboxSender, sendCredentialsEmail, sendDigestEmail } from "@/lib/email/resend";

const SANDBOX_MSG =
  "You can only send testing emails to your own email address (jmt.altus@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.";

const args = { email: "new.hire@example.com", inviteeName: "New Hire", inviterName: "Admin", password: "secret", loginUrl: "https://wms.example/login" };

beforeEach(() => {
  send.mockReset();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
});
afterEach(() => vi.unstubAllEnvs());

describe("sender configuration", () => {
  it("uses RESEND_FROM_EMAIL as the from address", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "JMT Drive Solutions <noreply@jmtdrives.com>");
    send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    const res = await sendCredentialsEmail(args);
    expect(res).toEqual({ id: "em_1", error: null });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ from: "JMT Drive Solutions <noreply@jmtdrives.com>", to: "new.hire@example.com" });
  });

  it("sends nothing and says why when RESEND_FROM_EMAIL is unset — no resend.dev fallback", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    const res = await sendCredentialsEmail(args);
    expect(res).toEqual({ id: null, error: "RESEND_FROM_EMAIL not set" });
    expect(send).not.toHaveBeenCalled();
    // Soft senders (digest, notifications) skip quietly, as they do without an API key.
    expect(await sendDigestEmail({ recipient: { email: "a@b.c", name: "A" }, pendingTasks: [], siteUrl: "" })).toEqual({ id: null, error: null });
    expect(send).not.toHaveBeenCalled();
  });

  it("recognises the resend.dev sandbox sender in either form", () => {
    expect(isSandboxSender("onboarding@resend.dev")).toBe(true);
    expect(isSandboxSender("JMT Drive Solutions Dashboard <onboarding@resend.dev>")).toBe(true);
    expect(isSandboxSender("JMT Drive Solutions <noreply@jmtdrives.com>")).toBe(false);
    expect(isSandboxSender(null)).toBe(false);
  });
});

describe("Resend errors", () => {
  it("translates the sandbox restriction into what it is and what fixes it, naming the owner address", () => {
    const out = describeResendError(SANDBOX_MSG);
    expect(out).toMatch(/testing mode/);
    expect(out).toMatch(/jmt\.altus@gmail\.com/);
    expect(out).toMatch(/resend\.com\/domains/);
    expect(out).toMatch(/RESEND_FROM_EMAIL/);
  });

  it("passes any other provider message through unchanged", () => {
    expect(describeResendError("API key is invalid")).toBe("API key is invalid");
  });

  it("the credentials sender returns the translated message when Resend refuses the recipient", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "JMT Drive Solutions Dashboard <onboarding@resend.dev>");
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: SANDBOX_MSG } });
    const res = await sendCredentialsEmail(args);
    expect(res.id).toBeNull();
    expect(res.error).toMatch(/testing mode.*verify your domain/i);
  });

  it("an SDK exception becomes an error result, never a throw", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@jmtdrives.com");
    send.mockRejectedValue(new Error("network down"));
    expect(await sendCredentialsEmail(args)).toEqual({ id: null, error: "network down" });
  });
});
