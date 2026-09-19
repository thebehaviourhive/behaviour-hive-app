import JSZip from "jszip";
import { createClient } from "@/lib/supabase/client";
import type { ExportAttachmentRef } from "@/lib/clinicalExport";

// PRD 8 Stage 2 -- the attachments half of export. Two separate
// artefacts by design (Daniel's own correction): window.print() stays
// exactly as it was for the document itself -- real, selectable text,
// zero new dependency, every existing read-only component reused
// unchanged. This is the other one: every attachment the caller's own
// export may include, bundled into one zip, downloaded as its own file.
//
// Same signed-URL-then-fetch-real-bytes pattern useAttachments.ts
// already established (300-second TTL, a single retry with a fresh URL
// on failure -- never a bare window.open(signedUrl), never a URL held
// past the moment it's used) -- reused here rather than reinvented,
// just fetching a Blob directly instead of building an object URL for
// on-screen display.

const BUCKET = "clinical-attachments";
const SIGNED_URL_TTL_SECONDS = 300;

async function fetchAttachmentBlob(storagePath: string): Promise<Blob | null> {
  const supabase = createClient();

  async function attempt(): Promise<Blob | null> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    try {
      const resp = await fetch(data.signedUrl);
      return resp.ok ? await resp.blob() : null;
    } catch {
      return null;
    }
  }

  return (await attempt()) ?? (await attempt());
}

// De-duplicates a filename that collides with one already placed in the
// zip (e.g. two attachments both called "report.pdf") by suffixing a
// counter -- silently overwriting one file with another inside a zip a
// clinic hands to an external practitioner would be a real, easy-to-miss
// correctness bug, not a cosmetic one.
function uniqueName(taken: Set<string>, filename: string): string {
  if (!taken.has(filename)) {
    taken.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf(".");
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? "" : filename.slice(dot);
  let i = 2;
  let candidate = `${base} (${i})${ext}`;
  while (taken.has(candidate)) {
    i += 1;
    candidate = `${base} (${i})${ext}`;
  }
  taken.add(candidate);
  return candidate;
}

export interface ZipDownloadResult {
  includedCount: number;
  failedFilenames: string[];
}

/** Fetches every attachment's real bytes and triggers a browser download
 *  of one zip. Returns which ones failed rather than throwing, so a
 *  single bad file doesn't lose the rest of a clinic's own export. */
export async function downloadAttachmentsZip(
  attachments: ExportAttachmentRef[],
  zipFilename: string
): Promise<ZipDownloadResult> {
  const zip = new JSZip();
  const taken = new Set<string>();
  const failedFilenames: string[] = [];

  for (const attachment of attachments) {
    const blob = await fetchAttachmentBlob(attachment.storagePath);
    if (!blob) {
      failedFilenames.push(attachment.originalFilename);
      continue;
    }
    zip.file(uniqueName(taken, attachment.originalFilename), blob);
  }

  const includedCount = attachments.length - failedFilenames.length;
  if (includedCount > 0) {
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = zipFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { includedCount, failedFilenames };
}
