"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { LogOut } from "lucide-react";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";

/** "Sign out" button for the hub header — mirrors the user-menu flow. */
export function HubSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut(getFirebaseAuth());
    } catch {
      /* best effort */
    }
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      /* best effort */
    }
    router.replace("/login" as Route);
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-white text-[14.5px] font-semibold transition-opacity disabled:opacity-60"
      style={{ background: "linear-gradient(135deg, #0A6CFF 0%, #0A6CFF 42%, #17B6A0 100%)", boxShadow: "0 8px 20px -8px rgba(10,108,255,0.55)" }}
    >
      <LogOut size={16} strokeWidth={2.4} />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
