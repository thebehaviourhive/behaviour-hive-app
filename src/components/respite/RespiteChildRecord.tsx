"use client";

import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { MessageList } from "@/components/messages/MessageList";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { useRespiteChildRecord } from "@/hooks/useRespiteChildRecord";
import { useRespiteCheckins } from "@/hooks/useRespiteCheckins";
import { useAbcLogs } from "@/hooks/useAbcLogs";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { StaysSection } from "@/components/respite/StaysSection";
import { CentrePageContent } from "@/components/respite/CentrePageContent";
import type { MessageRole } from "@/types/messages";

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function StepSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BulletList({ items, other }: { items: string[] | null; other?: string | null }) {
  const all = [...(items ?? []), ...(other ? [other] : [])];
  if (all.length === 0) return <p className="text-sm text-black/40">Nothing recorded.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-brand-neutral-black">
      {all.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

// THE FIRST FIVE MINUTES -- PRD 11 section 6, item 4. Read standing up,
// on a phone, with a child in the room. Order: who this child is (30
// seconds of orientation) -- triggers (avoid this first) -- calm cards
// (if it's already going wrong, do this) -- communication -- calming --
// current strategies -- medical & intimate care -- what's changed since
// last time. The FBA's own full narrative is deliberately excluded --
// not "read standing up" material, reachable elsewhere on the activated
// record instead. The crisis plan is NOT item N in this list -- it's a
// pinned control, outside the scroll, one tap from anywhere on this
// screen, closing PRD 7's own recorded "how does a cover worker find it
// on a phone in three seconds" question.
export function RespiteChildRecord({
  passportId,
  institutionId,
  currentUserId,
  viewerRole,
}: {
  passportId: string;
  institutionId: string;
  currentUserId: string;
  viewerRole: "centre_manager" | "care_staff";
}) {
  const { data, isLoading, loadError } = useRespiteChildRecord(passportId, institutionId);
  const { checkins, recordCheckin, hasMorningToday, hasEndOfDayToday, error: checkinError } = useRespiteCheckins(
    data.activeStayId
  );
  const thread = useMessageThread(passportId);
  const { categories } = useMessageCategories(viewerRole as MessageRole, "child");
  const { logs: abcLogs, isLoading: isAbcLoading, refresh: refreshAbcLogs } = useAbcLogs(passportId);

  const [isCrisisPlanOpen, setIsCrisisPlanOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);

  const handoverCategory = categories.find((c) => c.label === "Handover") ?? null;
  const handoverMessages = useMemo(
    () => thread.messages.filter((m) => m.categoryLabel === "Handover"),
    [thread.messages]
  );

  if (isLoading) return null;
  if (loadError) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  const age = calculateAge(data.dateOfBirth);
  const primaryCommunication = data.sectionC?.communication_methods?.[0] ?? null;

  return (
    <div className="pb-24">
      {/* Pinned, outside the scroll -- one tap from anywhere on this
          screen. The backdrop itself stays full-bleed (-mx-4 cancels
          the page's own px-4) -- a blurred bar spanning the full width
          is the intended look -- but the button inside it respects the
          SAME container as everything below, per Respite UI Stage 1,
          item 3: "including the child record's sticky bar." */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 bg-brand-off-white/95 px-4 py-3 backdrop-blur">
        <CentrePageContent>
          <button
            type="button"
            onClick={() => setIsCrisisPlanOpen(true)}
            disabled={!data.crisisPlan}
            className="w-full rounded-full bg-brand-golden-brown px-4 py-3 text-center font-semibold text-white shadow-sm disabled:bg-black/10 disabled:text-black/40"
          >
            {data.crisisPlan ? "Crisis Plan" : "No crisis plan on file"}
          </button>
        </CentrePageContent>
      </div>

      <CentrePageContent>
      {/* Who is this child -- thirty seconds of orientation, before any
          safety content. */}
      <div className="mb-4">
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          {data.childName ?? "This child"}
        </h1>
        <p className="text-sm text-black/60">
          {age !== null ? `${age} years old` : "Age not recorded"}
          {primaryCommunication ? ` -- communicates via ${primaryCommunication}` : ""}
        </p>
      </div>

      {viewerRole === "centre_manager" && data.episodeId && <StaysSection episodeId={data.episodeId} />}

      {/* Respite UI Stage 1, item 2 -- gated on activeStayId (a
          genuinely open respite_activations row), never on a stay's own
          calendar dates. Writing a check-in against a stay the child
          wasn't actually present for is a false entry in a care record
          that a post-stay report later carries -- see
          useRespiteChildRecord.ts's own header for the full reasoning.
          When there's no open activation, this same space shows the
          next scheduled stay instead of the section simply vanishing. */}
      <StepSection title="Check-ins">
        {data.activeStayId ? (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => recordCheckin("morning")}
                disabled={hasMorningToday}
                className="flex-1 rounded-full bg-brand-prussian-blue px-3 py-2 text-sm font-semibold text-white disabled:bg-black/10 disabled:text-black/40"
              >
                {hasMorningToday ? "Morning done" : "Record morning"}
              </button>
              <button
                type="button"
                onClick={() => recordCheckin("end_of_day")}
                disabled={hasEndOfDayToday}
                className="flex-1 rounded-full bg-brand-prussian-blue px-3 py-2 text-sm font-semibold text-white disabled:bg-black/10 disabled:text-black/40"
              >
                {hasEndOfDayToday ? "End of day done" : "Record end of day"}
              </button>
            </div>
            {checkinError && <p className="mt-2 text-sm text-red-600">{checkinError}</p>}
            {checkins.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-black/50">
                {checkins.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    {c.checkInType === "morning" ? "Morning" : "End of day"} --{" "}
                    {new Date(`${c.checkInDate}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : data.nextStay ? (
          <p className="text-sm text-black/50">
            No stay is active right now. The next stay starts{" "}
            {new Date(data.nextStay.startsAt).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            .
          </p>
        ) : (
          <p className="text-sm text-black/50">No stay is active right now, and none is scheduled.</p>
        )}
      </StepSection>

      <StepSection title="Triggers">
        <BulletList items={data.sectionB?.hard_triggers ?? null} other={data.sectionB?.hard_triggers_other} />
      </StepSection>

      <StepSection title="Calm Cards">
        {data.calmCards.length === 0 ? (
          <p className="text-sm text-black/40">No published calm cards.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {[...data.calmCards]
              .sort((a) => (a.door_type === "prevention" ? -1 : 1))
              .map((card) => (
                <div key={card.id} className="rounded-lg bg-brand-off-white/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/50">
                    {card.door_type === "prevention" ? "Prevention" : "De-escalation"}
                  </p>
                  <p className="font-semibold text-brand-neutral-black">{card.title}</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                    {card.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
          </div>
        )}
      </StepSection>

      <StepSection title="Communication">
        <BulletList items={data.sectionC?.communication_methods ?? null} />
        {data.sectionC?.phrases_to_avoid && data.sectionC.phrases_to_avoid.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-black/50">Phrases to avoid</p>
            <BulletList items={data.sectionC.phrases_to_avoid} />
          </div>
        )}
      </StepSection>

      <StepSection title="Calming">
        <p className="text-sm text-brand-neutral-black">{data.sectionD?.during_distress || "Nothing recorded."}</p>
        {data.sectionD?.after_distress && (
          <p className="mt-2 text-sm text-brand-neutral-black">{data.sectionD.after_distress}</p>
        )}
      </StepSection>

      <StepSection title="Current Strategies">
        {data.bspStrategies.length === 0 ? (
          <p className="text-sm text-black/40">No active plan strategies.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {data.bspStrategies.map((s) => (
              <div key={s.id}>
                <p className="font-semibold text-brand-neutral-black">{s.title}</p>
                <p className="text-sm text-black/70">{s.why}</p>
                <p className="text-sm text-black/70">{s.how}</p>
                {s.caveat && <p className="mt-1 text-sm italic text-black/50">{s.caveat}</p>}
              </div>
            ))}
          </div>
        )}
      </StepSection>

      <StepSection title="Medical & Intimate Care">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-semibold text-brand-neutral-black">Allergies</dt>
            <dd className="text-black/70">{data.sectionE?.allergies || "None recorded."}</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-neutral-black">Medical conditions</dt>
            <dd className="text-black/70">{data.sectionE?.medical_conditions || "None recorded."}</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-neutral-black">Medications</dt>
            <dd className="text-black/70">{data.sectionE?.medications || "None recorded."}</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-neutral-black">Emergency protocol</dt>
            <dd className="text-black/70">{data.sectionE?.emergency_protocol || "None recorded."}</dd>
          </div>
          <div>
            <dt className="font-semibold text-brand-neutral-black">Intimate care</dt>
            <dd className="text-black/70">{data.sectionE?.intimate_care_needs || "None recorded."}</dd>
          </div>
        </dl>
      </StepSection>

      <StepSection title="Since Last Time">
        {data.priorStayEndsAt ? (
          data.sectionsChangedSinceLastStay ? (
            <p className="text-sm text-brand-golden-brown">Some information has been updated since their last stay here.</p>
          ) : (
            <p className="text-sm text-black/60">Nothing has changed since their last stay here.</p>
          )
        ) : (
          <p className="text-sm text-black/40">No prior stay at this centre to compare against.</p>
        )}
      </StepSection>

      <StepSection title="ABC Logs">
        {viewerRole === "care_staff" && (
          <button
            type="button"
            onClick={() => setIsAbcLoggerOpen(true)}
            disabled={!data.currentStayIsLive}
            className="mb-3 w-full rounded-full bg-brand-golden-brown px-4 py-2 text-sm font-semibold text-white disabled:bg-black/10 disabled:text-black/40"
          >
            {data.currentStayIsLive ? "+ Log ABC Entry" : "No stay currently in progress"}
          </button>
        )}
        {isAbcLoading ? (
          <p className="text-sm text-black/40">Loading…</p>
        ) : abcLogs.length === 0 ? (
          <p className="text-sm text-black/40">No ABC entries recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {abcLogs.slice(0, 10).map((log) => (
              <li key={log.id} className="rounded-lg bg-brand-off-white/60 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/50">
                  {new Date(log.incidentDate).toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  -- {log.loggedByName ?? log.loggedByRole}
                </p>
                <p className="mt-1 text-brand-neutral-black">
                  {[...(log.behaviours ?? []), ...(log.behaviourOther ? [log.behaviourOther] : [])].join(", ") ||
                    "No behaviours recorded."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </StepSection>

      {isAbcLoggerOpen && (
        <ABCLogger
          passportId={passportId}
          childName={data.childName ?? "this child"}
          role="care_staff"
          stayId={data.currentStayId ?? undefined}
          onComplete={() => {
            setIsAbcLoggerOpen(false);
            refreshAbcLogs();
          }}
          onDismiss={() => setIsAbcLoggerOpen(false)}
        />
      )}

      <StepSection title="Handover">
        <button
          type="button"
          onClick={() => setIsComposeOpen(true)}
          className="mb-3 w-full rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-semibold text-white"
        >
          Write a handover
        </button>
        <MessageList
          messages={handoverMessages}
          currentUserId={currentUserId}
          nameById={thread.nameById}
          isLoading={thread.isLoading}
          onChanged={thread.refresh}
          childName={data.childName ?? "this child"}
          viewerRole={viewerRole}
          emptyOpenMessage="No open handovers."
          emptyArchivedMessage="No past handovers."
        />
      </StepSection>

      {handoverCategory && (
        <ComposeMessageSheet
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          passportId={passportId}
          childName={data.childName ?? undefined}
          candidates={thread.candidates}
          categories={categories}
          institutionPhone={null}
          initialCategoryId={handoverCategory.id}
          onSent={() => {
            setIsComposeOpen(false);
            thread.refresh();
          }}
        />
      )}

      <BottomSheet isOpen={isCrisisPlanOpen} onClose={() => setIsCrisisPlanOpen(false)}>
        {data.crisisPlan && (
          <div className="p-4">
            <h2 className="mb-2 font-heading text-xl font-semibold text-brand-neutral-black">
              {data.crisisPlan.name}
            </h2>
            <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">
              {data.crisisPlan.body || "No details recorded."}
            </p>
          </div>
        )}
      </BottomSheet>
      </CentrePageContent>
    </div>
  );
}
