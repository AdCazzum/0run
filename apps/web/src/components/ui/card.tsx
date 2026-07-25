export function Card({ featured = false, className = "", children }: { featured?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-2xl border p-6 shadow-sm transition-all duration-500 hover:shadow-md md:p-8 ${
        featured ? "border-orange/70 bg-peach/30" : "border-navy/10 bg-white/45"
      } ${className}`}
    >
      {children}
    </div>
  );
}
