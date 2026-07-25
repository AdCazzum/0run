"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "link";

const BASE =
  "inline-flex h-12 items-center font-sans text-xs font-medium uppercase tracking-[0.2em] transition-colors duration-500 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-navy";

const VARIANTS: Record<Variant, string> = {
  primary:
    "group relative overflow-hidden bg-navy px-10 text-cream shadow-[0_4px_16px_rgba(0,0,0,0.15)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.2)]",
  secondary:
    "border border-navy bg-transparent px-10 text-navy hover:bg-navy hover:text-cream",
  link: "px-0 text-navy underline decoration-navy/30 underline-offset-8 hover:decoration-orange",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props}>
      {variant === "primary" ? (
        <>
          <span
            aria-hidden
            className="absolute inset-0 -translate-x-full bg-orange transition-transform duration-500 [transition-timing-function:cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:translate-x-0"
          />
          <span className="relative z-10">{children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
