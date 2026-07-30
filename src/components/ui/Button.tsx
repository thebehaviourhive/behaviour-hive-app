import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-brand-prussian-blue text-white hover:bg-[#003a54]",
  secondary:
    "border-2 border-brand-prussian-blue text-brand-prussian-blue bg-white hover:bg-brand-pastel-blue/20",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`w-full rounded-2xl px-5 py-3.5 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
