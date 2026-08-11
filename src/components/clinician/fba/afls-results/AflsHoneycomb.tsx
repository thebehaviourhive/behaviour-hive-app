"use client";

import { useMemo, useState } from "react";
import { AFLS_BADGES, formatMicroSummary, tallyDomain, type AflsBadgeValue, type DomainTally } from "@/lib/fba/aflsResults";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { AflsItemScore, InstrumentItem } from "@/lib/fba/types";

// LAYER 1, the honeycomb figure -- one shared component parameterised by
// scores + an `interactive` flag so digital and print could both use it
// (see AflsResultsView for why only print actually does, per the 375px
// gate). Flat-top hexagons, tessellated per-domain into 4-wide blocks,
// blocks tiled 2-per-row into one continuous figure.
//
// Geometry (flat-top hexagon, circumradius `s`):
//   width = 2s, height = sqrt(3)*s
//   column spacing = 1.5s (adjacent columns overlap by 1/4 width)
//   row spacing = height, with odd columns offset down by height/2

const HEX_SIZE = 24; // circumradius, design units
const HEX_W = HEX_SIZE * 2;
const HEX_H = Math.sqrt(3) * HEX_SIZE;
const COL_SPACING = HEX_SIZE * 1.5;
const COLS_PER_BLOCK = 4;
const BLOCK_GAP_X = 56;
const BLOCK_GAP_Y = 40;
const LABEL_HEIGHT = 34;
const SUMMARY_HEIGHT = 22;
const BLOCKS_PER_ROW = 2;
const CANVAS_PADDING = 16;

function hexPoints(cx: number, cy: number, s: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + s * Math.cos(angle)).toFixed(2)},${(cy + s * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(" ");
}

interface HexCell {
  itemId: string;
  itemText: string;
  score: AflsBadgeValue;
  cx: number;
  cy: number;
}

interface DomainBlock {
  domain: string;
  tally: DomainTally;
  cells: HexCell[];
  width: number;
  height: number;
}

function buildDomainBlock(domain: string, items: InstrumentItem[], scores: AflsItemScore[]): DomainBlock {
  const scoreByItemId = new Map(scores.map((s) => [s.itemId, s.score]));
  const cols = Math.min(items.length, COLS_PER_BLOCK) || 1;
  const cells: HexCell[] = items.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = HEX_W / 2 + col * COL_SPACING;
    const cy = HEX_H / 2 + row * HEX_H + (col % 2 === 1 ? HEX_H / 2 : 0);
    return {
      itemId: item.id,
      itemText: item.text,
      score: scoreByItemId.get(item.id) ?? "unscored",
      cx,
      cy,
    };
  });
  const width = (cols - 1) * COL_SPACING + HEX_W;
  const maxCy = cells.length ? Math.max(...cells.map((c) => c.cy)) : HEX_H / 2;
  const height = maxCy + HEX_H / 2;
  return { domain, tally: tallyDomain(domain, items, scores), cells, width, height };
}

export function AflsHoneycomb({
  itemsByDomain,
  scoresData,
  interactive = false,
  className = "",
}: {
  itemsByDomain: Record<string, InstrumentItem[]>;
  scoresData: Record<string, AflsItemScore[]>;
  // Off by default -- the honeycomb currently only ships as the print
  // figure (see AflsResultsView). Kept as a real, working flag so the
  // identical component can serve an interactive digital rendering if a
  // future pass finds a layout that clears the 375px gate.
  interactive?: boolean;
  className?: string;
}) {
  const [selected, setSelected] = useState<{ domain: string; item: HexCell } | null>(null);

  const domains = Object.keys(itemsByDomain);

  const blocks = useMemo(
    () => domains.map((domain) => buildDomainBlock(domain, itemsByDomain[domain] ?? [], scoresData[domain] ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemsByDomain, scoresData]
  );

  const { placedBlocks, canvasWidth, canvasHeight } = useMemo(() => {
    const colWidth = Math.max(...blocks.map((b) => b.width), 0) + BLOCK_GAP_X;
    let x = CANVAS_PADDING;
    let y = CANVAS_PADDING;
    let rowMaxHeight = 0;
    let colInRow = 0;
    let maxX = 0;
    const placed = blocks.map((block) => {
      const blockX = x;
      const blockY = y;
      rowMaxHeight = Math.max(rowMaxHeight, LABEL_HEIGHT + block.height + SUMMARY_HEIGHT);
      maxX = Math.max(maxX, blockX + block.width);
      colInRow += 1;
      x += colWidth;
      if (colInRow >= BLOCKS_PER_ROW) {
        colInRow = 0;
        x = CANVAS_PADDING;
        y += rowMaxHeight + BLOCK_GAP_Y;
        rowMaxHeight = 0;
      }
      return { block, x: blockX, y: blockY };
    });
    const totalHeight = y + (colInRow > 0 ? rowMaxHeight : 0) + CANVAS_PADDING;
    return {
      placedBlocks: placed,
      canvasWidth: Math.max(maxX + CANVAS_PADDING, 200),
      canvasHeight: Math.max(totalHeight, 200),
    };
  }, [blocks]);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        width="100%"
        role="img"
        aria-label="AFLS skills honeycomb: each domain's items shown as coloured, icon-labelled hexagons"
      >
        {placedBlocks.map(({ block, x, y }) => (
          <g key={block.domain} transform={`translate(${x}, ${y})`}>
            <text
              x={block.width / 2}
              y={LABEL_HEIGHT / 2 + 4}
              textAnchor="middle"
              className="font-heading fill-brand-prussian-blue"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              {block.domain}
            </text>

            <g transform={`translate(0, ${LABEL_HEIGHT})`}>
              {block.cells.map((cell) => {
                const cfg = AFLS_BADGES[cell.score];
                const isUnscored = cell.score === "unscored";
                return (
                  <g
                    key={cell.itemId}
                    onClick={interactive ? () => setSelected({ domain: block.domain, item: cell }) : undefined}
                    style={interactive ? { cursor: "pointer" } : undefined}
                    role={interactive ? "button" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={interactive ? `${cell.itemText}: ${cfg.label}` : undefined}
                  >
                    <polygon
                      points={hexPoints(cell.cx, cell.cy, HEX_SIZE - 1.5)}
                      // The honeycomb is the print FIGURE, not a repeated
                      // badge -- it keeps its fill colour in print (this
                      // is the one graphic worth the ink). Colour still
                      // isn't the only differentiator: the stroke and
                      // icon glyph carry the encoding if it's ever run
                      // through a true grayscale printer.
                      className={`${isUnscored ? "fill-white" : cfg.svgFillClass} stroke-white`}
                      strokeWidth={isUnscored ? 1.5 : 2}
                      strokeDasharray={isUnscored ? "4 3" : undefined}
                    />
                    <text
                      x={cell.cx}
                      y={cell.cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={cfg.svgTextClass}
                      style={{ fontSize: HEX_SIZE * 0.75, fontWeight: 700 }}
                    >
                      {cfg.icon}
                    </text>
                  </g>
                );
              })}
            </g>

            <text
              x={block.width / 2}
              y={LABEL_HEIGHT + block.height + SUMMARY_HEIGHT / 2 + 4}
              textAnchor="middle"
              className="font-sans fill-brand-neutral-black/60"
              style={{ fontSize: 11 }}
            >
              {block.tally.isFullyUnscored ? "Unscored" : formatMicroSummary(block.tally)}
            </text>
          </g>
        ))}
      </svg>

      {interactive && (
        <BottomSheet isOpen={!!selected} onClose={() => setSelected(null)}>
          {selected && (
            <div className="flex flex-col gap-3">
              <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
                {selected.domain}
              </p>
              <p className="text-base text-brand-neutral-black">{selected.item.itemText}</p>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${AFLS_BADGES[selected.item.score].bgClass} ${AFLS_BADGES[selected.item.score].textClass} ${AFLS_BADGES[selected.item.score].borderClass ?? ""}`}
                >
                  {AFLS_BADGES[selected.item.score].icon}
                </span>
                <span className="text-sm font-semibold text-brand-neutral-black">
                  {AFLS_BADGES[selected.item.score].label}
                </span>
              </div>
            </div>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
