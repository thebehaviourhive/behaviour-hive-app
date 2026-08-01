"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";

type EntryType = "win" | "observation" | "update";
type Environment = "school" | "other";
type Status = "idle" | "saving" | "waiting-for-connection" | "success";

const ENTRY_TYPE_OPTIONS: { value: EntryType; label: string }[] = [
  { value: "win", label: "Win" },
  { value: "observation", label: "New Observation" },
  { value: "update", label: "Update" },
];

export function StrategyLedgerSheet({
  isOpen,
  onClose,
  passportId,
  userId,
}: {
  isOpen: boolean;
  onClose: () => void;
  passportId: string;
  userId: string;
}) {
  const [entryType, setEntryType] = useState<EntryType>("win");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState<Environment>("school");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  function resetAndClose() {
    setEntryType("win");
    setDescription("");
    setEnvironment("school");
    setStatus("idle");
    setError(null);
    onClose();
  }

  async function handleSave() {
    if (!description.trim()) return;
    setError(null);

    const supabase = createClient();
    const errorMessage = await insertWithOfflineRetry(
      () =>
        supabase.from("strategy_ledger").insert({
          passport_id: passportId,
          submitted_by: userId,
          entry_type: entryType,
          description: description.trim(),
          environment,
        }),
      setStatus
    );

    if (errorMessage) {
      setStatus("idle");
      setError(errorMessage);
      return;
    }

    setStatus("success");
    setTimeout(resetAndClose, 900);
  }

  const isSaving = status === "saving" || status === "waiting-for-connection";

  return (
    <BottomSheet isOpen={isOpen} onClose={resetAndClose}>
      {status === "success" ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
            ✅
          </span>
          <p className="font-heading text-lg font-semibold text-brand-neutral-black">
            Added to the ledger!
          </p>
        </div>
      ) : (
        <>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
            Add to Ledger
          </h2>

          <div className="mt-4 flex gap-2">
            {ENTRY_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setEntryType(option.value)}
                className={`flex-1 rounded-2xl border px-2 py-3 text-sm font-semibold transition-colors ${
                  entryType === option.value
                    ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                    : "border-black/10 bg-white text-black/60"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="mt-5 block text-sm font-semibold text-brand-neutral-black">
            Description
          </label>
          <textarea
            ref={textareaRef}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? Be as specific as possible — the more detail the more useful this will be."
            className="mt-1.5 w-full resize-none overflow-hidden rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />

          <p className="mt-5 mb-1.5 text-sm font-semibold text-brand-neutral-black">
            Environment
          </p>
          <div className="flex gap-2">
            {(["school", "other"] as Environment[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setEnvironment(option)}
                className={`flex-1 rounded-2xl border px-2 py-2.5 text-sm font-semibold capitalize transition-colors ${
                  environment === option
                    ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                    : "border-black/10 bg-white text-black/60"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!description.trim() || isSaving}
            className="mt-6 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "waiting-for-connection"
              ? "Waiting for connection…"
              : status === "saving"
                ? "Saving…"
                : "Save to Ledger"}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
