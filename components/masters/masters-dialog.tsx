"use client";

import * as React from "react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { MASTERS_GRADIENT_BAR } from "./theme";

/**
 * The Masters create/edit popup — the shared `CenterDialog` wearing the Masters
 * accent. Kept as a named wrapper so call sites read as Masters code and the
 * accent is applied in exactly one place.
 */
export function MastersDialog(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  return <CenterDialog {...props} accentBar={MASTERS_GRADIENT_BAR} />;
}
