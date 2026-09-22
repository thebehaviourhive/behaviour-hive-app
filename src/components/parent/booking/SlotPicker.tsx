"use client";

import { useMemo, useState } from "react";

// Booking-flow redesign, section 5, step 3 -- "the core redesign."
// Replaces the old wall of 70+ chronological buttons with: a day strip
// (next fortnight, paginated within the booking window), a day's times
// grouped Morning/Afternoon once selected, and a single-tap "Earliest
// available" shortcut above the strip. The booking LOGIC underneath is
// unchanged (section 9) -- this component only reorganises an already-
// fetched, already-chronologically-sorted AvailableSlot[] for display;
// it makes no API calls of its own.

export interface AvailableSlot {
  startISO: string;
  endISO: string;
}

interface SlotPickerProps {
  slots: AvailableSlot[];
  bookingWindowDays: number;
  onSelectSlot: (slot: AvailableSlot) => void;
}

const DAY_STRIP_PAGE_SIZE = 14;

function dateKeyOf(date: Date): string {
  return date.toDateString();
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return dateKeyOf(a) === dateKeyOf(b);
}

export function SlotPicker({ slots, bookingWindowDays, onSelectSlot }: SlotPickerProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, AvailableSlot[]>();
    for (const slot of slots) {
      const key = dateKeyOf(new Date(slot.startISO));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [slots]);

  const earliestSlot = slots[0] ?? null;

  const [page, setPage] = useState(0);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(
    earliestSlot ? dateKeyOf(new Date(earliestSlot.startISO)) : null
  );

  const maxPage = Math.max(0, Math.ceil(bookingWindowDays / DAY_STRIP_PAGE_SIZE) - 1);
  const daysThisPage = Math.min(DAY_STRIP_PAGE_SIZE, bookingWindowDays - page * DAY_STRIP_PAGE_SIZE);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < daysThisPage; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + page * DAY_STRIP_PAGE_SIZE + i);
      out.push(d);
    }
    return out;
  }, [today, page, daysThisPage]);

  if (slots.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-5 text-center">
        <p className="font-sans text-body font-semibold text-brand-neutral-black">
          No availability in the next {bookingWindowDays} days.
        </p>
        <p className="mt-1 font-sans text-body text-brand-neutral-black/60">
          Please contact your clinic directly to arrange a time.
        </p>
      </div>
    );
  }

  const selectedDaySlots = selectedDayKey ? slotsByDay.get(selectedDayKey) ?? [] : [];
  const morning = selectedDaySlots.filter((s) => new Date(s.startISO).getHours() < 12);
  const afternoon = selectedDaySlots.filter((s) => new Date(s.startISO).getHours() >= 12);

  return (
    <div className="flex flex-col gap-4">
      {earliestSlot && (
        <button
          type="button"
          onClick={() => onSelectSlot(earliestSlot)}
          className="flex min-h-11 items-center justify-between rounded-2xl bg-brand-pastel-blue/30 px-4 py-3.5 text-left"
        >
          <div>
            <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
              Earliest available
            </p>
            <p className="mt-0.5 font-sans text-body font-semibold text-brand-neutral-black">
              {new Date(earliestSlot.startISO).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
              {" · "}
              {formatSlotTime(earliestSlot.startISO)}
            </p>
          </div>
          <span aria-hidden className="text-xl text-brand-prussian-blue">
            →
          </span>
        </button>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous fortnight"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-brand-prussian-blue disabled:opacity-20"
          >
            ‹
          </button>
          <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
            {days[0]?.toLocaleDateString([], { day: "numeric", month: "short" })}
            {" – "}
            {days[days.length - 1]?.toLocaleDateString([], { day: "numeric", month: "short" })}
          </p>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage}
            aria-label="Next fortnight"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-brand-prussian-blue disabled:opacity-20"
          >
            ›
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((day) => {
            const key = dateKeyOf(day);
            const hasSlots = (slotsByDay.get(key)?.length ?? 0) > 0;
            const isSelected = key === selectedDayKey;
            const isToday = isSameDay(day, today);
            return (
              <button
                key={key}
                type="button"
                onClick={() => hasSlots && setSelectedDayKey(key)}
                disabled={!hasSlots}
                aria-pressed={isSelected}
                className={`flex min-h-11 min-w-[52px] flex-shrink-0 flex-col items-center justify-center rounded-xl px-2 py-2 transition-colors ${
                  isSelected
                    ? "bg-brand-prussian-blue text-white"
                    : hasSlots
                      ? "border border-brand-prussian-blue/30 bg-white text-brand-neutral-black"
                      : "border border-black/5 bg-black/[0.02] text-brand-neutral-black/25"
                }`}
              >
                <span className="font-accent text-[10px] font-bold uppercase tracking-wide">
                  {day.toLocaleDateString([], { weekday: "short" })}
                  {isToday ? " · Today" : ""}
                </span>
                <span className="mt-0.5 font-sans text-base font-bold">{day.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDayKey && (
        <div className="flex flex-col gap-4">
          {morning.length === 0 && afternoon.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/50">
              No times on this day.
            </p>
          ) : (
            <>
              {morning.length > 0 && (
                <div>
                  <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Morning
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {morning.map((slot) => (
                      <button
                        key={slot.startISO}
                        type="button"
                        onClick={() => onSelectSlot(slot)}
                        className="min-h-11 rounded-xl border border-brand-prussian-blue px-4 py-2 font-sans text-body font-semibold text-brand-prussian-blue"
                      >
                        {formatSlotTime(slot.startISO)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {afternoon.length > 0 && (
                <div>
                  <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Afternoon
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {afternoon.map((slot) => (
                      <button
                        key={slot.startISO}
                        type="button"
                        onClick={() => onSelectSlot(slot)}
                        className="min-h-11 rounded-xl border border-brand-prussian-blue px-4 py-2 font-sans text-body font-semibold text-brand-prussian-blue"
                      >
                        {formatSlotTime(slot.startISO)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
