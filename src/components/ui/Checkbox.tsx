import type { ReactNode } from "react";

interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  required?: boolean;
}

export function Checkbox({ id, checked, onChange, label, required }: CheckboxProps) {
  return (
    <label htmlFor={id} className="flex cursor-pointer select-none items-start gap-3">
      <span className="relative mt-0.5 flex-shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          required={required}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden
          className={`flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors ${
            checked
              ? "border-brand-prussian-blue bg-brand-prussian-blue"
              : "border-black/20 bg-white"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-white" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>
      <span className="text-sm leading-snug text-brand-neutral-black">{label}</span>
    </label>
  );
}
