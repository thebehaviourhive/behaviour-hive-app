"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { useHomeProfileRequest, type HomeProfileRecord } from "@/hooks/useHomeProfileRequest";

// PRD 3, Stage 3 -- the home column's own dedicated surface, deliberately
// not folded into Section A-D (see the recon: those sections have no
// "this field is home-only" tagging at all, and this content needs to
// stay clearly attributed to a specific request/recipient, which
// Section A-D's tables have no concept of). Full-screen like
// QuestionnaireFlow, for the same "distraction-free" reason -- but a
// plain textarea form, not a Likert-item renderer, because this content
// is narrative, not a scored instrument.
export default function HomeProfilePage() {
  const router = useRouter();
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId;
  const { isReady, notFound, childName, institutionName, status, record, save } =
    useHomeProfileRequest(requestId);

  const [draft, setDraft] = useState<HomeProfileRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = draft ?? record;

  function setField(field: keyof HomeProfileRecord, value: string) {
    setDraft({ ...current, [field]: value });
  }

  async function handleSubmit(event: FormEvent, nextStatus: "in_progress" | "completed") {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    const saveError = await save(current, nextStatus);
    setIsSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    router.push("/parent-dashboard");
  }

  if (!isReady) {
    return null;
  }

  if (notFound) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10 text-center">
        <p className="text-sm text-brand-neutral-black/60">
          We couldn&apos;t find this request. It may have been sent to a different account.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            {childName ?? "Your child"}&apos;s Home Profile
          </h1>
          <p className="text-sm text-brand-neutral-black/60">
            {institutionName
              ? `${institutionName} has asked you to share what things are like at home.`
              : "Your child's school has asked you to share what things are like at home."}{" "}
            Answer in your own time — save and come back whenever you like.
          </p>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <form
            onSubmit={(e) => handleSubmit(e, "completed")}
            className="flex flex-col gap-4"
          >
            <Textarea
              label="What works at home"
              placeholder="What helps your child feel settled and supported at home?"
              value={current.what_works_at_home}
              onChange={(e) => setField("what_works_at_home", e.target.value)}
            />
            <Textarea
              label="Sleep"
              placeholder="What's sleep like for your child? Any patterns or challenges?"
              value={current.sleep}
              onChange={(e) => setField("sleep", e.target.value)}
            />
            <Textarea
              label="Food"
              placeholder="Any preferences, sensitivities, or routines around food?"
              value={current.food}
              onChange={(e) => setField("food", e.target.value)}
            />
            <Textarea
              label="Sensory needs at home"
              placeholder="What sensory things matter at home — sounds, textures, light, touch?"
              value={current.sensory_needs_home}
              onChange={(e) => setField("sensory_needs_home", e.target.value)}
            />
            <Textarea
              label="Before this school"
              placeholder="Anything about your child's history before starting here that would help?"
              value={current.history_before_this_school}
              onChange={(e) => setField("history_before_this_school", e.target.value)}
            />
            <Textarea
              label="What previous settings got wrong"
              placeholder="Anything a previous school, creche, or setting didn't get right?"
              value={current.previous_settings_feedback}
              onChange={(e) => setField("previous_settings_feedback", e.target.value)}
            />

            {error && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSaving} className="mt-2">
              {isSaving ? "Saving…" : status === "completed" ? "Save changes" : "Mark as complete"}
            </Button>
          </form>

          {status !== "completed" && (
            <button
              type="button"
              onClick={(e) => handleSubmit(e, "in_progress")}
              disabled={isSaving}
              className="mt-4 w-full text-center text-sm font-semibold text-black/50 disabled:opacity-50"
            >
              Save and finish later
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
