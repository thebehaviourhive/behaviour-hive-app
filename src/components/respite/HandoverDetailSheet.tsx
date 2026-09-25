import Link from "next/link";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { HandoverMessage } from "@/hooks/useHandoverInbox";

// Respite UI Stage 2b -- "reading a handover opens it." A single
// message, read-only -- no reply, no acknowledge. Composing and the
// full back-and-forth both stay on the child's own record, per the
// brief's own instruction; this is a fast way to see what was left,
// not a second copy of the full thread UI.
export function HandoverDetailSheet({
  message,
  recordHref,
  onClose,
}: {
  message: HandoverMessage | null;
  recordHref: (passportId: string) => string;
  onClose: () => void;
}) {
  return (
    <BottomSheet isOpen={Boolean(message)} onClose={onClose}>
      {message && (
        <div className="p-4">
          <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
            {message.childName}
          </p>
          <h2 className="mb-1 font-heading text-xl font-semibold text-brand-neutral-black">Handover</h2>
          <p className="mb-4 text-sm text-black/50">
            {message.senderName ?? "A colleague"} ·{" "}
            {new Date(message.createdAt).toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">
            {message.body || "No details written."}
          </p>
          <Link
            href={recordHref(message.passportId)}
            className="mt-4 block text-center text-sm font-semibold text-brand-prussian-blue"
          >
            Open {message.childName}&apos;s record
          </Link>
        </div>
      )}
    </BottomSheet>
  );
}
