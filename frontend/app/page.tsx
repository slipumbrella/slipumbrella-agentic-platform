import { HeroSection } from "@/sections/landing/hero-section";
import { FeaturesSection } from "@/sections/landing/features-section";
import { HowItWorksSection } from "@/sections/landing/how-it-works-section";
import { AgenticExplainerSection } from "@/sections/landing/agentic-explainer-section";
import { Footer } from "@/sections/landing/footer";

export default function Page() {
  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <HeroSection />
      <AgenticExplainerSection />
      <HowItWorksSection />
      <FeaturesSection />
      <Footer />
    </div>
  );
}
