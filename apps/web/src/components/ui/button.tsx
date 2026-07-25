import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "link" };

const EASE = "[transition-timing-function:cubic-bezier(0.25,0.46,0.45,0.94)]";

// Branded focus-visible ring: navy, offset from the element edge on a cream
// gap so it stays visible regardless of the button's own background color.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

export function Button({ variant = "primary", className = "", children, ...props }: Props) {
  if (variant === "primary")
    return (
      <button
        {...props}
        className={`group relative h-12 overflow-hidden bg-navy px-8 font-sans text-xs font-medium uppercase tracking-[0.2em] text-cream shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition-shadow duration-500 hover:shadow-[0_8px_24px_rgba(0,0,0,0.25)] disabled:opacity-50 ${FOCUS_RING} ${className}`}
      >
        <span data-slide aria-hidden className={`absolute inset-0 -translate-x-full bg-orange transition-transform duration-500 ${EASE} group-hover:translate-x-0`} />
        <span className="relative z-10">{children}</span>
      </button>
    );
  if (variant === "secondary")
    return (
      <button
        {...props}
        className={`h-12 border border-navy bg-transparent px-8 font-sans text-xs font-medium uppercase tracking-[0.2em] text-navy transition-colors duration-500 hover:bg-navy hover:text-cream disabled:opacity-50 ${FOCUS_RING} ${className}`}
      >
        {children}
      </button>
    );
  return (
    <button {...props} className={`font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline disabled:opacity-50 ${FOCUS_RING} ${className}`}>
      {children}
    </button>
  );
}
