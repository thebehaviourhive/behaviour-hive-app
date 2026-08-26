import { BodyFigureSvg } from "./BodyFigureSvg";
import { BodyMapMarker } from "./BodyMapMarker";
import { regionWithSideLabel, type BodyView, type Side } from "./bodyMapRegions";

// Print rendering of a body map -- same data, same supplied SVG assets
// (print variant: outline figures, white fill, black stroke -- the
// opposite of the screen version's light-tint fill, so a solid dark
// figure doesn't flood to a black slab on a mediocre printer and
// swallow white markers), same BodyFigureSvg/BodyMapMarker components as
// the screen version. This is what ends up in the exported PDF. The
// name repeats on each individual figure here (screen shows it once,
// above the pair) because a printed or scanned page can end up
// separated from its own heading. No interactivity, no highlight state
// -- print is a static rendering of already-confirmed marks, not a tap
// target.

export interface PrintableMark {
  id: string;
  view: BodyView;
  x: number;
  y: number;
  regionValue: string;
  side: Side;
  injuryTypeName: string;
  skinBroken: boolean | null;
}

interface BodyMapPrintCardProps {
  partyName: string;
  marks: PrintableMark[];
}

export function BodyMapPrintCard({ partyName, marks }: BodyMapPrintCardProps) {
  function markerNumber(markId: string): number {
    return marks.findIndex((m) => m.id === markId) + 1;
  }

  function legendLine(m: PrintableMark): string {
    let line = `${m.injuryTypeName} — ${regionWithSideLabel(m.regionValue, m.side)}`;
    if (m.injuryTypeName === "Bite" && m.skinBroken !== null) {
      line += m.skinBroken ? ", skin broken" : ", skin not broken";
    }
    return line;
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
              <span>{legendLine(m)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
