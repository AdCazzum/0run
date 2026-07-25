import { TextareaHTMLAttributes } from "react";

// Multiline sibling of ./input.tsx — same visual language (rounded border,
// transparent-ish fill, Playfair-italic placeholder, orange focus ring), just
// sized for a paragraph instead of a single line. Transitions run at 500ms
// (the design system's binding floor for interactions), a touch slower than
// Input's 300ms.
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full resize-none rounded-xl border border-navy/20 bg-white/50 px-4 py-3 font-sans text-sm text-navy shadow-sm outline-none transition-colors duration-500 placeholder:font-serif placeholder:italic placeholder:text-ocean/70 focus-visible:border-orange focus-visible:ring-2 focus-visible:ring-orange/25 ${className}`}
    />
  );
}
