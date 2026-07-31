import type { TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function Textarea({ label, id, className = "", ...props }: TextareaProps) {
  const textareaId = id ?? label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={textareaId} className="text-sm font-semibold text-brand-neutral-black">
        {label}
      </label>
      <textarea
        id={textareaId}
        rows={3}
        className={`rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue ${className}`}
        {...props}
      />
    </div>
  );
}
