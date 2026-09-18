"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// PRD 7 Stage 2 -- file storage. First caller: assessments only, per
// Daniel's own decision (the table is generic -- artefact_type/
// artefact_id -- but this hook doesn't need to be; a future artefact
// type gets its own hook, or this one grows a second entry point, when
// that artefact exists to attach to).
const BUCKET = "clinical-attachments";
const ARTEFACT_TYPE = "assessment" as const;
const SIGNED_URL_TTL_SECONDS = 300;

export interface Attachment {
  id: string;
  storagePath: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface AttachmentRow {
  id: string;
  storage_path: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

export function useAttachments(assessmentId: string) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("attachments")
      .select("id, storage_path, original_filename, content_type, size_bytes, uploaded_at")
      .eq("artefact_type", ARTEFACT_TYPE)
      .eq("artefact_id", assessmentId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("Failed to load attachments:", error);
      setLoadError("Couldn't load attachments.");
      setAttachments(null);
      return;
    }

    setAttachments((data as AttachmentRow[]).map(mapAttachment));
  }, [assessmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Upload: the file lands in Storage FIRST (gated by storage.objects'
  // own INSERT policy, keyed on the path's own artefact_type/
  // artefact_id segments -- no `attachments` row exists yet at this
  // point), then a second, separate insert records the metadata row
  // (gated by attachments' own INSERT policy). If the metadata insert
  // fails after a successful upload, the file itself is cleaned up
  // rather than left as an orphan object with no matching row -- the
  // opposite failure direction from an orphaned ROW (inert, harmless),
  // matching this codebase's own general preference for failing toward
  // the safer, more inspectable state.
  const upload = useCallback(
    async (file: File): Promise<{ error: string | null }> => {
      setIsUploading(true);
      setUploadError(null);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsUploading(false);
        setUploadError("You need to be signed in to attach a file.");
        return { error: "You need to be signed in to attach a file." };
      }

      const safeName = file.name.replace(/[^\w.\- ]/g, "_");
      const path = `${ARTEFACT_TYPE}/${assessmentId}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

      if (uploadErr) {
        setIsUploading(false);
        setUploadError(uploadErr.message);
        return { error: uploadErr.message };
      }

      // uploaded_by = the real caller, not inferred or defaulted --
      // attachments' own INSERT policy requires uploaded_by = auth.uid()
      // explicitly (found live, verification: a missing uploaded_by
      // fails the policy's own WITH CHECK, not a bare NOT NULL error).
      const { error: insertErr } = await supabase.from("attachments").insert({
        artefact_type: ARTEFACT_TYPE,
        artefact_id: assessmentId,
        storage_path: path,
        original_filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        uploaded_by: user.id,
      });

      setIsUploading(false);

      if (insertErr) {
        console.error("Attachment metadata insert failed after a successful upload -- removing the orphaned file:", insertErr);
        await supabase.storage.from(BUCKET).remove([path]);
        setUploadError("Couldn't save this attachment. Please try again.");
        return { error: "Couldn't save this attachment. Please try again." };
      }

      await load();
      return { error: null };
    },
    [assessmentId, load]
  );

  // Delete: storage object first -- if that succeeds but the metadata
  // row's own delete then fails, what's left is an orphaned ROW (inert
  // metadata pointing at a file that's genuinely gone), never an
  // orphaned FILE that's still sitting in Storage with nothing left to
  // authorize deleting it. The safer failure direction, same reasoning
  // as upload's own cleanup-on-partial-failure.
  const remove = useCallback(
    async (attachment: Attachment): Promise<{ error: string | null }> => {
      const supabase = createClient();
      const { error: removeErr } = await supabase.storage.from(BUCKET).remove([attachment.storagePath]);
      if (removeErr) return { error: removeErr.message };

      const { error: deleteErr } = await supabase.from("attachments").delete().eq("id", attachment.id);
      if (deleteErr) return { error: deleteErr.message };

      await load();
      return { error: null };
    },
    [load]
  );

  // THE RETRY, AND WHY IT EXISTS -- read this before touching it. A
  // signed URL is a five-minute bearer token, generated fresh right
  // before this function is ever called (never cached, never stored --
  // there is no earlier point in this codebase's own flow where a URL
  // could even BE stale going in). A fetch against it can still fail
  // for an entirely ORDINARY reason that has nothing to do with
  // authorization being wrong: the download itself took longer than
  // five minutes (a large PDF on a slow connection), or the connection
  // dropped and the browser silently re-issued the request as a fresh
  // one that lands a moment after the original token's own expiry.
  // Retrying ONCE with a brand-new signed URL is how that specific,
  // expected case recovers on its own. This is NOT blanket retry-on-
  // failure and it is NOT papering over a real authorization bug --
  // it retries exactly once, only for this fetch, and if the SECOND
  // attempt also fails, that failure is surfaced as a real error, not
  // silently swallowed. A future reader seeing "retry on 403" here
  // should read this comment before assuming it's hiding something --
  // it exists because Storage's own signed-URL expiry is deliberately
  // short-lived (Daniel's own instruction: five minutes, not sixty,
  // specifically to keep a leaked or logged URL's own exposure window
  // small), and a short expiry means a normal, non-adversarial retry
  // has to be part of the design, not an afterthought bolted on when
  // someone's download breaks in the field.
  const fetchAttachment = useCallback(
    async (attachment: Attachment): Promise<{ blobUrl: string | null; error: string | null }> => {
      const supabase = createClient();

      async function attempt(): Promise<Response | null> {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(attachment.storagePath, SIGNED_URL_TTL_SECONDS);
        if (error || !data) return null;
        try {
          const resp = await fetch(data.signedUrl);
          return resp.ok ? resp : null;
        } catch {
          return null;
        }
      }

      let resp = await attempt();
      if (!resp) {
        // The one retry described above -- a fresh signed URL, a fresh
        // fetch. Never a second retry beyond this.
        resp = await attempt();
      }

      if (!resp) {
        return { blobUrl: null, error: "Couldn't open this file. Please try again." };
      }

      const blob = await resp.blob();
      return { blobUrl: URL.createObjectURL(blob), error: null };
    },
    []
  );

  return { attachments, loadError, reload: load, upload, isUploading, uploadError, remove, fetchAttachment };
}
