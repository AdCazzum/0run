export function Card({ featured = false, className = "", children }: { featured?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`border-t bg-transparent p-6 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-700 hover:bg-peach/20 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] md:p-10 ${
        featured ? "border-t-4 border-t-orange" : "border-t-navy"
      } ${className}`}
    >
      {children}
    </div>
  );
}
