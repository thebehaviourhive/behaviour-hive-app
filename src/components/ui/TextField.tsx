import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, className = "", ...props }: TextFieldProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-brand-neutral-black">
        {label}
      </label>
      <input
        id={inputId}
        className={`rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue ${className}`}
        {...props}
      />
    </div>
  );
}
