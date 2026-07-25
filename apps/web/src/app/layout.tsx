import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "0run — The AI running coach you own",
  description:
    "A running coach that is only yours. It remembers every run, learns how you train, and keeps your data private — always.",
};

const NOISE_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body className="bg-cream font-sans text-navy antialiased">
        {/* paper noise overlay */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]"
          style={{ backgroundImage: `url("${NOISE_SVG}")` }}
        />
        {/* visible vertical gridlines */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-0 mx-auto hidden max-w-[1600px] grid-cols-4 px-8 md:grid md:px-16"
        >
          <span className="w-px bg-navy/10" />
          <span className="w-px bg-navy/10" />
          <span className="w-px bg-navy/10" />
          <span className="w-px justify-self-end bg-navy/10" />
        </div>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
