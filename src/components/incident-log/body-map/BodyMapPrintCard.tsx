import { BodyFigureSvg } from "./BodyFigureSvg";
import { BodyMapMarker } from "./BodyMapMarker";
import { regionForMark, type BodyView } from "./bodyMapRegions";

// Print rendering of a body map -- same data, same normalised
// coordinates, same BodyFigureSvg/BodyMapMarker components as the
// screen version, just the "print" palette (outline figures, solid
// dark markers, black legend text -- inverted from screen on purpose,
// see BodyFigureSvg/BodyMapMarker's own comments). This is what ends up
// in the exported PDF. The name repeats on each individual figure here
// (screen shows it once, above the pair) because a printed or scanned
// page can end up separated from its own heading.

export interface PrintableMark {
  id: string;
  view: BodyView;
  x: number;
  y: number;
  injuryTypeName: string;
}

interface BodyMapPrintCardProps {
  partyName: string;
  marks: PrintableMark[];
}

export function BodyMapPrintCard({ partyName, marks }: BodyMapPrintCardProps) {
  function markerNumber(markId: string): number {
    return marks.findIndex((m) => m.id === markId) + 1;
  }

  return (
    <div className="w-[375px] rounded-2xl bg-white p-4">
      <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.13em] text-black">Body map</h2>
      <div className="mb-3 inline-block rounded-full border border-black px-2.5 py-1 text-xs font-bold text-black">
        {partyName}
      </div>

      <div className="flex gap-2.5">
        <div className="flex-1 rounded-xl border border-black p-1.5 pb-1 text-center">
          <p className="mb-0.5 text-[10px] font-bold text-black">{partyName} — front</p>
          <BodyFigureSvg view="front" variant="print">
            {marks
              .filter((m) => m.view === "front")
              .map((m) => (
                <BodyMapMarker key={m.id} xNorm={m.x} yNorm={m.y} number={markerNumber(m.id)} variant="print" />
              ))}
          </BodyFigureSvg>
          <p className="mt-0.5 text-[10px] font-bold tracking-[0.1em] text-black">FRONT</p>
        </div>
        <div className="flex-1 rounded-xl border border-black p-1.5 pb-1 text-center">
          <p className="mb-0.5 text-[10px] font-bold text-black">{partyName} — back</p>
          <BodyFigureSvg view="back" variant="print">
            {marks
              .filter((m) => m.view === "back")
              .map((m) => (
                <BodyMapMarker key={m.id} xNorm={m.x} yNorm={m.y} number={markerNumber(m.id)} variant="print" />
              ))}
          </BodyFigureSvg>
          <p className="mt-0.5 text-[10px] font-bold tracking-[0.1em] text-black">BACK</p>
        </div>
      </div>

      <p className="mt-2.5 text-center text-[10.5px] text-black opacity-85">Left and right are the child&apos;s own.</p>

      {marks.length > 0 && (
        <ul className="mt-2.5 list-none border-t border-black pt-2.5">
          {marks.map((m) => (
            <li key={m.id} className="mb-1.5 flex items-center gap-2 text-[12.5px] text-black">
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">
                {markerNumber(m.id)}
              </span>
              <span>
                <b className="font-extrabold text-black">{m.injuryTypeName}</b> — {m.view}, {regionForMark(m.view, m.x, m.y)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
