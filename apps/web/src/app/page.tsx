import { Hero } from "@/components/landing/hero";
import { Manifesto } from "@/components/landing/manifesto";
import { HowItWorks } from "@/components/landing/how-it-works";
import { BenefitsSection } from "@/components/landing/benefits-section";
import { SiteFooter } from "@/components/landing/site-footer";

export default function Home() {
  return (
    <main>
      <Hero />
      <Manifesto />
      <HowItWorks />
      <BenefitsSection />
      <SiteFooter />
    </main>
  );
}
