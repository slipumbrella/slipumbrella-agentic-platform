"use client";

import { motion } from "framer-motion";
import { Settings, Play, CheckCircle } from "lucide-react";

const steps = [
  {
    icon: Settings,
    title: "Prompt your team",
    description:
      "Describe your goal and Slipumbrella will guide the specialist mix and the next setup steps.",
    iconClass: "bg-blue-50 text-blue-700",
  },
  {
    icon: Play,
    title: "Train & orchestrate",
    description:
      "Upload knowledge, review your setup, and choose how your agentic team should work together.",
    iconClass: "bg-purple-50 text-purple-700",
  },
  {
    icon: CheckCircle,
    title: "Chat & integrate",
    description:
      "Launch your team in the portal or connect it to LINE for day-to-day use.",
    iconClass: "bg-indigo-50 text-indigo-700",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.14 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export function HowItWorksSection() {
  return (
    <section
      className="bg-gray-50 py-16 lg:py-24"
      aria-labelledby="how-it-works-heading"
    >
      <div className="container mx-auto px-4">
        {/* Left-aligned header — breaks the centered monotony */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mb-16 max-w-xl"
        >
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-purple-700">
            How it works
          </p>
          <h2
            id="how-it-works-heading"
            className="font-heading text-3xl font-black tracking-tight text-gray-950 lg:text-4xl"
          >
            A simple way to get started
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-500">
            Follow the same three steps on the page, then continue inside the
            builder with a lightweight guided tutorial.
          </p>
        </motion.div>

        {/* Steps — large numerals as visual anchors, no glass cards */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-0"
        >
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.title}
                variants={itemVariants}
                className={`px-0 md:px-10 ${
                  index > 0 ? "md:border-l md:border-gray-200" : ""
                } ${index === 0 ? "md:pl-0" : ""} ${
                  index === steps.length - 1 ? "md:pr-0" : ""
                }`}
              >
                <span
                  className="font-heading block text-[4rem] sm:text-[5.5rem] font-black leading-none text-gray-200 tabular-nums"
                  aria-hidden="true"
                >
                  0{index + 1}
                </span>

                <div
                  className={`mt-5 flex h-12 w-12 items-center justify-center rounded-xl ${step.iconClass}`}
                  aria-hidden="true"
                >
                  <Icon className="h-6 w-6" />
                </div>

                <h3 className="mt-5 text-xl font-bold text-gray-950">
                  {step.title}
                </h3>
                <p className="mt-3 leading-relaxed text-gray-600">
                  {step.description}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
