"use client";

import { useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { submitModule } from "@/app/(app)/forms/actions";
import { visibleFields, type FormFieldDef } from "@/lib/forms/field-types";
import { Field, FieldInput } from "./form-fields";

/**
 * Generic "request" dialog for a module (Reimbursement / Leave / Reference /
 * Breakthrough). Renders from the resolved (admin-editable) field list and the
 * live Product Name options.
 */
export function DynamicFormDialog({
  module,
  title,
  buttonLabel,
  fields,
  productOptions,
  isAdmin,
  look,
}: {
  module: string;
  title: string;
  buttonLabel: string;
  fields: FormFieldDef[];
  productOptions: string[];
  isAdmin: boolean;
  /** "wms": the approved WMS look (Reimbursements). Omitted: the original look the other modules keep. */
  look?: "wms";
}) {
  const wms = look === "wms";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setValue = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));
  const visible = visibleFields(fields, values);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await submitModule({ module, fields: values });
      if (!res.ok) { setError(res.error); return; }
      fireToast({ message: `${title} submitted.` });
      setValues({});
      setOpen(false);
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setValues({}); setError(null); } }}>
      <Dialog.Trigger asChild>
        {wms ? (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A6CFF] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] transition-colors hover:bg-[#0058D6] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/30">
            <Plus size={15} strokeWidth={2.4} /> {buttonLabel}
          </button>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 rounded-md py-2.5 px-5 text-[14px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #0A6CFF, #0751BE)" }}
          >
            <Plus size={16} strokeWidth={2.6} /> {buttonLabel}
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-[90]" />
        <Dialog.Content
          className={
            wms
              ? "wms-form fixed left-1/2 top-1/2 z-[100] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[#DCE4F0] bg-white p-5 shadow-[0_18px_40px_-16px_rgba(11,31,68,0.3)] max-h-[calc(100dvh-32px)]"
              : "fixed left-1/2 top-1/2 z-[100] -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl bg-white border border-[#E2E8F0] p-6 shadow-lg max-h-[calc(100dvh-32px)] overflow-y-auto"
          }
        >
          <Dialog.Title className={wms ? "mb-0.5 text-[17px] font-semibold text-[#0B1F44]" : "font-serif text-xl text-[#0F172A] mb-1"}>{title}</Dialog.Title>
          <Dialog.Description className={wms ? "mb-4 text-[13px] text-[#5B6B85]" : "text-[15px] text-[#64748B] mb-4"} style={{ lineHeight: 1.5 }}>
            Fill the form below. An admin reviews each submission.
          </Dialog.Description>
          <form onSubmit={onSubmit} className={wms ? "space-y-3.5" : "space-y-4"}>
            {visible.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <FieldInput field={f} value={values[f.key] ?? ""} onChange={setValue} productOptions={productOptions} isAdmin={isAdmin} />
              </Field>
            ))}
            {error && (
              <div role="alert" className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[14px] text-[#0751BE]">
                {error}
              </div>
            )}
            {wms ? (
              <div className="-mx-5 flex justify-end gap-2 border-t border-[#E6ECF5] px-5 pt-3.5">
                <Dialog.Close asChild>
                  <button type="button" className="h-9 rounded-lg border border-[#DCE4F0] bg-white px-3.5 text-[13px] font-semibold text-[#334155] hover:bg-[#F5F8FC]" disabled={pending}>Cancel</button>
                </Dialog.Close>
                <button type="submit" disabled={pending}
                  className="h-9 rounded-lg bg-[#0A6CFF] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] hover:bg-[#0058D6] disabled:opacity-50">
                  {pending ? "Submitting…" : "Submit"}
                </button>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <button type="button" className="px-4 py-2.5 text-[14px] font-medium text-[#64748B]" disabled={pending}>Cancel</button>
                </Dialog.Close>
                <button type="submit" disabled={pending}
                  className="rounded-md py-2.5 px-5 text-[14px] font-bold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #0A6CFF, #0751BE)" }}>
                  {pending ? "Submitting…" : "Submit"}
                </button>
              </div>
            )}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
