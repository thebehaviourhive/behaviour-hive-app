import { BottomSheet } from "@/components/ui/BottomSheet";
import type { MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";

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
            {pupil.firstName}&apos;s Morning Check-in
          </h2>
          <p className="mt-1 font-sans text-xs text-brand-neutral-black/50">
            {pupil.checkedInAt
              ? new Date(pupil.checkedInAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })
              : ""}
          </p>

          <div className="mt-5 flex flex-col gap-4">
            <DetailRow
              label="Regulation"
              value={
                pupil.regulationState ? REGULATION_LABEL[pupil.regulationState] : "Not reported"
              }
            />
            <DetailRow
              label="Sleep"
              value={pupil.sleepQuality ? SLEEP_LABEL[pupil.sleepQuality] : "Not reported"}
            />

            <div>
              <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                Stressors
              </p>
              {pupil.morningStressors.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {pupil.morningStressors.map((stressor) => (
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

            {pupil.headsUp && (
              <div className="relative rounded-xl bg-brand-safe-ivory/40 py-2.5 pl-9 pr-3">
                <span aria-hidden className="absolute left-2.5 top-2.5 text-sm leading-none">
                  💬
                </span>
                <p className="font-sans text-sm italic text-brand-neutral-black/80">
                  {pupil.headsUp}
                </p>
              </div>
            )}
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
