import { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full border-b border-navy bg-transparent px-0 py-2 font-sans text-sm text-navy outline-none transition-colors duration-500 placeholder:font-serif placeholder:italic placeholder:text-ocean focus-visible:border-orange ${className}`}
    />
  );
}
