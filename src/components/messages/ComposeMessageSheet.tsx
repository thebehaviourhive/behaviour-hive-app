"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import type { MessageCategory, MessageRecipientCandidate } from "@/types/messages";
import { ROLE_LABEL } from "@/types/messages";

const BODY_MAX = 200;

// Shared compose sheet -- one implementation for every sending role
// (constraint: "no duplicate implementations"). A ticket, not a chat
// starter: recipient(s) + category are required, the body is optional
// (a category chip alone -- "Collection/drop-off" -- can be the whole
// message), and Response Required is deliberately styled as the
// exception, not the default, with its own "only if you need an answer"
// helper copy right under it.
export function ComposeMessageSheet({
  isOpen,
  onClose,
  passportId,
  childName,
  candidates,
  categories,
  institutionPhone,
  onSent,
}: {
  isOpen: boolean;
  onClose: () => void;
  passportId: string;
  // Categories are pre-filtered by the caller (useMessageCategories(role))
  // -- this sheet doesn't need to know the sender's role itself.
  childName: string;
  candidates: MessageRecipientCandidate[];
  categories: MessageCategory[];
  institutionPhone: string | null;
  onSent: () => void;
}) {
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [responseRequired, setResponseRequired] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) return;
    // Reset on close, not on open -- avoids a visible flash of empty
    // state while the sheet's own close animation/unmount is still
    // playing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedRecipientIds([]);
    setSelectedCategoryId(null);
    setBody("");
    setResponseRequired(false);
    setSendError(null);
  }, [isOpen]);

  function toggleRecipient(id: string) {
    setSelectedRecipientIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]
    );
  }

  async function handleSend() {
    if (!selectedCategoryId || selectedRecipientIds.length === 0 || isSending) return;

    setIsSending(true);
    setSendError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("send_message", {
      p_passport_id: passportId,
      p_category_id: selectedCategoryId,
      p_body: body.trim() ? body.trim() : null,
      p_response_required: responseRequired,
      p_recipient_ids: selectedRecipientIds,
    });

    setIsSending(false);
    if (error) {
      setSendError(error.message);
      return;
    }

    onSent();
    onClose();
  }

  const canSend = Boolean(selectedCategoryId) && selectedRecipientIds.length > 0 && !isSending;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Message about {childName}
      </h2>

      <p className="mt-4 text-sm font-semibold text-brand-neutral-black">To</p>
      {candidates.length === 0 ? (
        <p className="mt-1.5 text-sm text-brand-neutral-black/60">
          No one else is linked to {childName}&apos;s passport yet.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {candidates.map((candidate) => {
            const isSelected = selectedRecipientIds.includes(candidate.recipientId);
            return (
              <button
                key={candidate.recipientId}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleRecipient(candidate.recipientId)}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                  isSelected
                    ? "border-transparent bg-brand-prussian-blue text-white"
                    : "border-black/10 bg-white text-brand-neutral-black/70"
                }`}
              >
                {candidate.fullName ?? ROLE_LABEL[candidate.role]}
                <span className={isSelected ? "text-white/70" : "text-brand-neutral-black/40"}>
                  {" "}
                  · {ROLE_LABEL[candidate.role]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-sm font-semibold text-brand-neutral-black">What&apos;s this about?</p>
      {categories.length === 0 ? (
        <p className="mt-1.5 text-sm text-brand-neutral-black/60">Loading categories…</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {categories.map((category) => {
            const isSelected = selectedCategoryId === category.id;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedCategoryId(category.id)}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                  isSelected
                    ? "border-transparent bg-brand-golden-brown text-white"
                    : "border-black/10 bg-white text-brand-neutral-black/70"
                }`}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-sm font-semibold text-brand-neutral-black">
        Add a note <span className="font-normal text-brand-neutral-black/40">(optional)</span>
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
        rows={3}
        placeholder="A few words, if the category chip alone doesn't say it all…"
        className="mt-1.5 w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />
      <p className="mt-1 text-right text-xs text-brand-neutral-black/40">
        {body.length}/{BODY_MAX}
      </p>

      {/* Response Required: deliberately the visual exception, not the
          default -- small, outlined, off by default, with its own
          helper line rather than reading like a normal setting. */}
      <button
        type="button"
        aria-pressed={responseRequired}
        onClick={() => setResponseRequired((current) => !current)}
        className={`mt-4 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
          responseRequired
            ? "border-brand-golden-brown bg-brand-golden-brown/10"
            : "border-dashed border-black/15 bg-transparent"
        }`}
      >
        <span>
          <span className="block text-sm font-semibold text-brand-neutral-black">
            Response required
          </span>
          <span className="block text-xs text-brand-neutral-black/50">Only if you need an answer.</span>
        </span>
        <span
          aria-hidden
          className={`flex h-6 w-11 flex-shrink-0 items-center rounded-full px-0.5 transition-colors ${
            responseRequired ? "justify-end bg-brand-golden-brown" : "justify-start bg-black/15"
          }`}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
        </span>
      </button>

      {/* Emergency boundary footer -- structural teacher protection
          (constraint 2, zero urgency mechanics): the app itself tells
          people not to route anything time-sensitive through this
          surface, rather than relying on senders to remember. */}
      <p className="mt-4 text-xs leading-relaxed text-brand-neutral-black/50">
        Messages are checked when people have time. For anything urgent today,{" "}
        {institutionPhone ? (
          <a href={`tel:${institutionPhone}`} className="font-semibold text-brand-prussian-blue underline underline-offset-2">
            phone the school
          </a>
        ) : (
          "phone the school"
        )}
        .
      </p>

      {sendError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {sendError}
        </p>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className="mt-4 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? "Sending…" : "Send"}
      </button>
    </BottomSheet>
  );
}
