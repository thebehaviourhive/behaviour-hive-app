import type { ReactNode } from "react";

// Shared rendering for the child's behavioural profile -- extracted
// from src/app/teacher/passport/[passportId]/page.tsx (previously
// defined locally there, and separately hand-rolled a second time in
// principal/directory/ChildDetail.tsx's own "passport" tab) so a
// teacher's and a principal's view of the same fields can never drift
// apart the way those two independent copies already had. Each block
// takes only the primitive fields it needs, not a shared "master
// profile" object -- the teacher page and ChildDetail each fetch this
// data through different paths (a direct multi-table query vs
// get_child_passport_profile_for_principal()) and normalize it into
// their own local state shapes; these blocks don't need to care which.

export interface TodayContext {
  sleepQuality: string | null;
  regulationState: string | null;
  stressors: string[] | null;
  headsUp: string | null;
}

const SLEEP_LABELS: Record<string, string> = {
  slept_through: "Slept through / Well rested",
  woke_briefly: "Woke up briefly",
  very_restless: "Very restless / Up multiple times",
  barely_slept: "Barely slept",
};

const REGULATION_LABELS: Record<string, string> = {
  settled: "Settled and Calm",
  unsettled: "A bit unsettled / Anxious",
  dysregulated: "Highly dysregulated / Upset",
};

export function appendOther(items: string[], other: string | null): string[] {
  if (!other) return items;
  return [...items, other];
}

// Folds an "Other" option's own free-text value into the tag list, the
// same way every call site on both pages already needs it done before
// handing tags to PillRow.
export function withOtherTag(items: string[], other: string | null): string[] {
  return items.includes("Other") && other ? [...items.filter((i) => i !== "Other"), other] : items;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-heading text-base font-semibold text-brand-neutral-black">
      {children}
    </h2>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm text-black/70">
      <span className="font-semibold text-black/50">{label}: </span>
      {value}
    </p>
  );
}

export function PillRow({ items, tone = "cool" }: { items: string[]; tone?: "cool" | "warm" }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            tone === "warm"
              ? "bg-brand-safe-ivory/60 text-brand-neutral-black"
              : "bg-brand-pastel-blue/20 text-brand-prussian-blue"
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function CardList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <EmptyCard text={emptyText} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item}
          className="rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm font-medium text-brand-neutral-black shadow-sm"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function TextCard({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-brand-neutral-black">
        {text || "Not specified"}
      </p>
    </div>
  );
}

export function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
      {text}
    </div>
  );
}

export function HeadsUpQuote({ text }: { text: string }) {
  return (
    <div className="relative mt-1 rounded-xl bg-brand-safe-ivory/50 py-2.5 pl-9 pr-3">
      <span aria-hidden className="absolute left-2.5 top-2.5 text-sm leading-none">
        💬
      </span>
      <p className="text-xs italic text-brand-neutral-black/80">{text}</p>
    </div>
  );
}

export function TodayContextBlock({ context }: { context: TodayContext | null }) {
  return (
    <>
      <SectionHeading>Today&apos;s Context</SectionHeading>
      {context ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <InfoRow
            label="Sleep"
            value={context.sleepQuality ? SLEEP_LABELS[context.sleepQuality] : "Not specified"}
          />
          <InfoRow
            label="Regulation"
            value={context.regulationState ? REGULATION_LABELS[context.regulationState] : "Not specified"}
          />
          {context.stressors && context.stressors.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-black/40">Stressors</p>
              <PillRow items={context.stressors} />
            </div>
          )}
          {context.headsUp && <HeadsUpQuote text={context.headsUp} />}
        </div>
      ) : (
        <EmptyCard text="No morning check-in received today." />
      )}
    </>
  );
}

export function ProfileBlock({ diagnosisTags }: { diagnosisTags: string[] }) {
  return (
    <>
      <SectionHeading>Profile</SectionHeading>
      {diagnosisTags.length > 0 ? (
        <PillRow items={diagnosisTags} tone="warm" />
      ) : (
        <EmptyCard text="No diagnosis information provided." />
      )}
    </>
  );
}

export function KeyCommunicationBlock({ communicationTags }: { communicationTags: string[] }) {
  return (
    <>
      <SectionHeading>Key Communication</SectionHeading>
      {communicationTags.length > 0 ? (
        <PillRow items={communicationTags} tone="warm" />
      ) : (
        <EmptyCard text="No communication methods provided." />
      )}
    </>
  );
}

export function BehaviourSignalsBlock({
  hardSignals,
  hardSignalsOther,
  hardTriggers,
  hardTriggersOther,
}: {
  hardSignals: string[];
  hardSignalsOther: string | null;
  hardTriggers: string[];
  hardTriggersOther: string | null;
}) {
  return (
    <>
      <SectionHeading>The Smoke Signals</SectionHeading>
      <p className="-mt-2 text-sm text-black/50">Early warning signs that things are getting hard.</p>
      <CardList
        items={appendOther(hardSignals, hardSignalsOther)}
        emptyText="No early warning signs recorded yet."
      />

      <SectionHeading>The Fuse</SectionHeading>
      <p className="-mt-2 text-sm text-black/50">Common triggers to watch for.</p>
      <CardList items={appendOther(hardTriggers, hardTriggersOther)} emptyText="No triggers recorded yet." />
    </>
  );
}

export function CommunicationBlock({
  communicationTags,
  showsHappy,
  showsAnxious,
  phrasesToAvoid,
}: {
  communicationTags: string[];
  showsHappy: string | null;
  showsAnxious: string | null;
  phrasesToAvoid: string | null;
}) {
  return (
    <>
      <SectionHeading>Communication Methods</SectionHeading>
      {communicationTags.length > 0 ? (
        <PillRow items={communicationTags} tone="warm" />
      ) : (
        <EmptyCard text="No communication methods provided." />
      )}

      <TextCard label="How they show they're happy" text={showsHappy} />
      <TextCard label="How they show they're anxious" text={showsAnxious} />
      <TextCard label="Phrases or approaches to avoid" text={phrasesToAvoid} />
    </>
  );
}

export function SupportsBlock({
  beforeBehaviour,
  beforeBehaviourOther,
  duringDistress,
  duringDistressOther,
  afterDistress,
  afterDistressOther,
  sensorySeeks,
  sensorySeeksOther,
  sensoryAvoids,
  sensoryAvoidsOther,
}: {
  beforeBehaviour: string[];
  beforeBehaviourOther: string | null;
  duringDistress: string[];
  duringDistressOther: string | null;
  afterDistress: string[];
  afterDistressOther: string | null;
  sensorySeeks: string[];
  sensorySeeksOther: string | null;
  sensoryAvoids: string[];
  sensoryAvoidsOther: string | null;
}) {
  return (
    <>
      <SectionHeading>What Helps Before</SectionHeading>
      <CardList items={appendOther(beforeBehaviour, beforeBehaviourOther)} emptyText="Nothing recorded yet." />

      <SectionHeading>What Helps During Distress</SectionHeading>
      <CardList items={appendOther(duringDistress, duringDistressOther)} emptyText="Nothing recorded yet." />

      <SectionHeading>What Helps After Distress</SectionHeading>
      <CardList items={appendOther(afterDistress, afterDistressOther)} emptyText="Nothing recorded yet." />

      <SectionHeading>Sensory Seeks</SectionHeading>
      <CardList items={appendOther(sensorySeeks, sensorySeeksOther)} emptyText="Nothing recorded yet." />

      <SectionHeading>Sensory Avoids</SectionHeading>
      <CardList items={appendOther(sensoryAvoids, sensoryAvoidsOther)} emptyText="Nothing recorded yet." />
    </>
  );
}

export function MedicalCareBlock({
  sectionEUpdatedAtLabel,
  allergies,
  medicalConditions,
  medications,
  emergencyProtocol,
  intimateCareNeeds,
}: {
  // Pre-formatted (formatRelativeDate already applied by the caller) --
  // this block has no opinion on date formatting, only on layout.
  sectionEUpdatedAtLabel: string | null;
  allergies: string | null;
  medicalConditions: string | null;
  medications: string | null;
  emergencyProtocol: string | null;
  intimateCareNeeds: string | null;
}) {
  return (
    <>
      {sectionEUpdatedAtLabel && (
        <p className="-mt-2 text-xs font-semibold text-black/40">{sectionEUpdatedAtLabel}</p>
      )}
      <TextCard label="Allergies" text={allergies} />
      <TextCard label="Medical conditions relevant to daily care" text={medicalConditions} />
      <TextCard label="Medications" text={medications} />
      <TextCard label="Emergency protocol" text={emergencyProtocol} />
      <TextCard label="Intimate care needs" text={intimateCareNeeds} />
    </>
  );
}
