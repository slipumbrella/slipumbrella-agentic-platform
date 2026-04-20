import { Brain, Database, ShieldCheck } from "lucide-react";

const features = [
  {
    title: "Guided setup",
    description:
      "Start with the job you want done, then move through team setup, knowledge, and launch in a clear order.",
    icon: Brain,
    iconClass: "bg-purple-50 text-purple-700",
  },
  {
    title: "Business knowledge",
    description:
      "Upload PDFs, links, and documents so your team works from your own material instead of generic answers.",
    icon: Database,
    iconClass: "bg-blue-50 text-blue-700",
  },
  {
    title: "Quality before launch",
    description:
      "Check the knowledge quality signal before creating a team, so non-coders can catch weak setups early.",
    icon: ShieldCheck,
    iconClass: "bg-indigo-50 text-indigo-700",
  },
];

export function FeaturesSection() {
  return (
    <section className="bg-white py-16 lg:py-24" aria-labelledby="features-heading">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl">
          {/* Section header — two-column editorial layout */}
          <div className="mb-16 grid items-end gap-10 lg:grid-cols-[320px_1fr]">
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-purple-700">
                What you get
              </p>
              <h2
                id="features-heading"
                className="font-heading text-3xl font-black tracking-tight text-gray-950 lg:text-4xl"
              >
                Built to make agentic setup easier
              </h2>
            </div>
            <p className="text-lg leading-relaxed text-gray-500 lg:max-w-lg">
              Keep the power of specialized AI teams, with a setup flow that stays
              readable and guided.
            </p>
          </div>

          {/* Feature rows with dividers — no identical card grid */}
          <div className="border-t border-gray-200">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="grid items-start gap-6 border-b border-gray-200 py-10 lg:grid-cols-[72px_200px_1fr] lg:gap-12"
                >
                  <span
                    className="font-heading text-5xl font-black leading-none text-gray-200 tabular-nums"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${feature.iconClass}`}
                      aria-hidden="true"
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-950">
                      {feature.title}
                    </h3>
                  </div>

                  <p className="text-base leading-7 text-gray-600">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
