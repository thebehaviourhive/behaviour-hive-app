"use client";

import { useRef, useState } from "react";
import { useAttachments, type Attachment, type AttachmentArtefactType } from "@/hooks/useAttachments";

// PRD 7 Stage 2 -- the upload/list/view control shared by both
// assessment editors, and (Silo 2 placeholders) the clinical plan
// editor. "View" fetches the file itself (via useAttachments' own
// fetch-with-retry, never a bare window.open(signedUrl)) so a failed
// or expired attempt can actually be detected and retried once with a
// fresh URL -- see that hook's own comment for why the retry exists
// and why it isn't a security smell.
export function AttachmentsSection({
  artefactId,
  artefactType,
  isLocked,
  title = "Attachments",
  helpText,
}: {
  artefactId: string;
  artefactType: AttachmentArtefactType;
  isLocked: boolean;
  title?: string;
  helpText?: string;
}) {
  const { attachments, loadError, reload, upload, isUploading, uploadError, remove, fetchAttachment } =
    useAttachments(artefactId, artefactType);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewingError, setViewingError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await upload(file);
  }

  async function handleView(attachment: Attachment) {
    setViewingError(null);
    setViewingId(attachment.id);
    const { blobUrl, error } = await fetchAttachment(attachment);
    setViewingId(null);
    if (error || !blobUrl) {
      setViewingError(error ?? "Couldn't open this file.");
      return;
    }
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    // Give the new tab a minute to actually load the blob before
    // releasing it -- this object URL is only ever held in memory,
    // never persisted, never the same URL a second view would reuse.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async function handleRemove(attachment: Attachment) {
    setRemovingId(attachment.id);
    await remove(attachment);
    setRemovingId(null);
  }

  return (
    <section>
      <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">{title}</p>
      {helpText && <p className="-mt-0.5 mb-2 text-xs text-brand-neutral-black/50">{helpText}</p>}

      {loadError && <p className="mb-2 text-sm text-red-600">{loadError}</p>}
      {uploadError && <p className="mb-2 text-sm text-red-600">{uploadError}</p>}
      {viewingError && <p className="mb-2 text-sm text-red-600">{viewingError}</p>}

      {attachments === null ? (
        <div className="h-12 animate-pulse rounded-xl bg-brand-off-white/50" />
      ) : attachments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/50">
          No files attached yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 bg-white px-3 py-2">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => handleView(a)}
                  disabled={viewingId === a.id}
                  className="truncate text-left text-sm font-medium text-brand-prussian-blue underline underline-offset-2 disabled:opacity-50"
                >
                  {viewingId === a.id ? "Opening…" : a.originalFilename}
                </button>
                <p className="text-xs text-brand-neutral-black/40">{formatFileSize(a.sizeBytes)}</p>
              </div>
              {!isLocked && (
                <button
                  type="button"
                  onClick={() => handleRemove(a)}
                  disabled={removingId === a.id}
                  aria-label={`Remove ${a.originalFilename}`}
                  className="flex-shrink-0 text-lg text-brand-neutral-black/30 disabled:opacity-40"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isLocked && (
        <div className="mt-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/heic"
            className="hidden"
            onChange={handleFileChosen}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="text-xs font-semibold text-brand-prussian-blue disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isUploading ? "Uploading…" : "+ Attach a file"}
          </button>
        </div>
      )}

      {loadError && (
        <button type="button" onClick={reload} className="mt-1 text-xs font-semibold text-brand-prussian-blue">
          Retry
        </button>
      )}
    </section>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
