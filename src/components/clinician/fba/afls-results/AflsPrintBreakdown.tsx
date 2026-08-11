import { scoreForItem, type DomainTally } from "@/lib/fba/aflsResults";
import { ScoreBadge } from "./ScoreBadge";
import type { AflsItemScore, InstrumentItem } from "@/lib/fba/types";

// LAYER 2, print: "accordions forced open" translates to a table -- there
// is no collapsed state to force open, every item is simply always
// visible. Two-column CSS grid, four domains per column, each domain its
// own bordered table. `print-avoid-break` sits on each TABLE, not the
// grid, so domains may break across a page boundary but never split a
// table mid-row.
function DomainTable({
  tally,
  items,
  scores,
}: {
  tally: DomainTally;
  items: InstrumentItem[];
  scores: AflsItemScore[];
}) {
  return (
    <table className="print-avoid-break w-full border-collapse text-sm">
      <thead>
        <tr>
          <th
            colSpan={2}
            className="border border-black/30 bg-brand-off-white/60 px-2 py-1.5 text-left font-heading text-sm font-bold text-brand-prussian-blue"
          >
            {tally.domain}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td className="border border-black/15 px-2 py-1 align-top text-xs text-brand-neutral-black">
              {item.text}
            </td>
            <td className="border border-black/15 px-2 py-1 text-right align-top">
              <ScoreBadge value={scoreForItem(scores, item.id)} showLabel />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AflsPrintBreakdown({
  tallies,
  itemsByDomain,
  scoresData,
}: {
  tallies: DomainTally[];
  itemsByDomain: Record<string, InstrumentItem[]>;
  scoresData: Record<string, AflsItemScore[]>;
}) {
  const mid = Math.ceil(tallies.length / 2);
  const columns = [tallies.slice(0, mid), tallies.slice(mid)];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      {columns.map((column, colIndex) => (
        <div key={colIndex} className="flex flex-col gap-4">
          {column.map((tally) => (
            <DomainTable
              key={tally.domain}
              tally={tally}
              items={itemsByDomain[tally.domain] ?? []}
              scores={scoresData[tally.domain] ?? []}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
