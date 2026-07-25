import { Hero } from "@/components/landing/hero";
import { Manifesto } from "@/components/landing/manifesto";
import { HowItWorks } from "@/components/landing/how-it-works";
import { StackSection } from "@/components/landing/stack-section";
import { SiteFooter } from "@/components/landing/site-footer";

export default function Home() {
  return (
    <main>
      <Hero />
      <Manifesto />
      <HowItWorks />
      <StackSection />
      <SiteFooter />
    </main>
  );
}
