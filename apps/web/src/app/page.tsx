import { Hero } from "@/components/landing/hero";
import { Manifesto } from "@/components/landing/manifesto";
import { HowItWorks } from "@/components/landing/how-it-works";
import { BenefitsSection } from "@/components/landing/benefits-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { PageChrome } from "@/components/ui/page-chrome";

// The editorial texture (noise + column hairlines) belongs to the public
// pages only — inside the app the background stays clean.
export default function Home() {
  return (
    <>
      <PageChrome />
      <SiteHeader />
      <main>
        <Hero />
        <Manifesto />
        <HowItWorks />
        <BenefitsSection />
      </main>
      <SiteFooter />
    </>
  );
}
