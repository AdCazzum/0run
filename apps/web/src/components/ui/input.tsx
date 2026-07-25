import { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full rounded-xl border border-navy/20 bg-white/50 px-4 font-sans text-sm text-navy shadow-sm outline-none transition-colors duration-300 placeholder:font-serif placeholder:italic placeholder:text-ocean/70 focus-visible:border-orange focus-visible:ring-2 focus-visible:ring-orange/25 ${className}`}
    />
  );
}
