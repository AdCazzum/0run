import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { PageChrome } from "@/components/ui/page-chrome";

// NOTE: brief asks for weights 400 + 300 ("Light"), but Google Fonts does
// not ship a 300 weight for Playfair Display (static or variable axis
// min is 400) — next/font/google's generated types reject "300" here.
// Using 400 only; see task-12-report.md concerns.
const playfairDisplay = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "0run",
  description: "The AI running coach you own — private by design, verifiable by default.",
};

// The post-login shell behaves like a native app: paint the browser chrome
// cream and extend under the home indicator so the fixed tab bar can pad
// itself with env(safe-area-inset-bottom).
export const viewport: Viewport = {
  themeColor: "#EFEFD0",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body
        className={`${playfairDisplay.variable} ${inter.variable} min-h-full flex flex-col font-sans bg-cream text-navy`}
      >
        <PageChrome />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
