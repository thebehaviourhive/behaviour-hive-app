import { BottomSheet } from "@/components/ui/BottomSheet";
import type { CheckinAccount, MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";

const SLEEP_LABEL: Record<string, string> = {
  slept_through: "Slept through / Well rested",
  woke_briefly: "Woke up briefly",
  very_restless: "Very restless / Up multiple times",
  barely_slept: "Barely slept",
};

const REGULATION_LABEL: Record<string, string> = {
  settled: "Settled and Calm",
  unsettled: "A bit unsettled / Anxious",
  dysregulated: "Highly dysregulated / Upset",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// PRD 3, Stage 5 -- two guardians describing two different mornings is
// information, not a data problem. Every account renders in full, in
// submission order, each headed by its own name -- nothing here narrates
// separated families or where the child slept; the name and the content
// are enough, and the teacher already knows their pupils.
function CheckinAccountBlock({ account }: { account: CheckinAccount }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-heading text-sm font-bold text-brand-prussian-blue">
          {account.submittedByName ?? "A guardian"}
        </p>
        <p className="font-sans text-xs text-brand-neutral-black/50">
          {formatTime(account.submittedAt)}
        </p>
      </div>

      <DetailRow
        label="Regulation"
        value={account.regulationState ? REGULATION_LABEL[account.regulationState] : "Not reported"}
      />
      <DetailRow
        label="Sleep"
        value={account.sleepQuality ? SLEEP_LABEL[account.sleepQuality] : "Not reported"}
      />

      <div>
        <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Stressors
        </p>
        {account.morningStressors.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {account.morningStressors.map((stressor) => (
              <span
                key={stressor}
                className="rounded-full bg-brand-pastel-blue/20 px-3 py-1 text-sm font-semibold text-brand-prussian-blue"
              >
                {stressor}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 font-sans text-sm text-brand-neutral-black/70">Not reported</p>
        )}
      </div>

      {account.headsUp && (
        <div className="relative rounded-xl bg-brand-safe-ivory/40 py-2.5 pl-9 pr-3">
          <span aria-hidden className="absolute left-2.5 top-2.5 text-sm leading-none">
            💬
          </span>
          <p className="font-sans text-sm italic text-brand-neutral-black/80">{account.headsUp}</p>
        </div>
      )}
    </div>
  );
}

export function MorningCheckinDetailSheet({
  pupil,
  onClose,
}: {
  pupil: MorningPupilStatus | null;
  onClose: () => void;
}) {
  return (
    <BottomSheet isOpen={pupil !== null} onClose={onClose}>
      {pupil && (
        <>
          <h2 className="font-heading text-xl font-bold text-brand-prussian-blue">
            {pupil.displayName}&apos;s Morning Check-in
          </h2>
          {pupil.checkins.length > 1 && (
            <p className="mt-1 font-sans text-xs font-semibold text-brand-neutral-black/50">
              {pupil.checkins.length} accounts today
            </p>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {pupil.checkins.map((account, i) => (
              <CheckinAccountBlock key={`${account.submittedByName ?? "unknown"}-${i}`} account={account} />
            ))}
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
        {label}
      </p>
      <p className="font-sans text-sm font-semibold text-brand-neutral-black">{value}</p>
    </div>
  );
}
