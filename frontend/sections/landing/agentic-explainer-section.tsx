"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  GitCommitVertical,
  Zap,
  MessageSquareQuote,
  UserRoundCheck,
  Bot,
  Network,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const orchestrationTypes = [
  {
    icon: GitCommitVertical,
    title: "Sequential",
    tag: "Pipeline",
    description:
      "The classic assembly line. Each expert completes their stage then passes the workflow to the next participant.",
    benefit: "Maximum Precision",
    iconClass: "border-blue-200 bg-blue-50 text-blue-700",
    benefitClass: "text-blue-700",
    dotClass: "bg-blue-500",
  },
  {
    icon: Zap,
    title: "Concurrent",
    tag: "Parallel",
    description:
      "Speed is the priority. Specialists tackle independent parts of your request at the exact same time.",
    benefit: "Ultra-Fast Delivery",
    iconClass: "border-amber-200 bg-amber-50 text-amber-700",
    benefitClass: "text-amber-700",
    dotClass: "bg-amber-500",
  },
  {
    icon: MessageSquareQuote,
    title: "Group Chat",
    tag: "Mesh",
    description:
      "Collaborative problem-solving. Agents brainstorm and peer-review results in a shared execution context.",
    benefit: "Superior Creativity",
    iconClass: "border-purple-200 bg-purple-50 text-purple-700",
    benefitClass: "text-purple-700",
    dotClass: "bg-purple-500",
  },
  {
    icon: UserRoundCheck,
    title: "Handoff",
    tag: "Expert Delegation",
    description:
      "Intelligent referral. A primary coordinator delegates deep-domain tasks to specific experts during the flow.",
    benefit: "Scalable Expertise",
    iconClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    benefitClass: "text-emerald-700",
    dotClass: "bg-emerald-500",
  },
];

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export function AgenticExplainerSection() {
  return (
    <section
      className="bg-gray-50 py-16 lg:py-24"
      aria-labelledby="agentic-explainer-heading"
    >
      <div className="container mx-auto px-4 sm:px-6">
        {/* Intro: split layout */}
        <div className="mb-12 lg:mb-16 grid max-w-6xl grid-cols-1 items-center gap-8 lg:gap-16 mx-auto lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-600" aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-700">
                The next evolution
              </span>
            </div>

            <h2
              id="agentic-explainer-heading"
              className="font-heading text-3xl font-black tracking-tight text-gray-950 lg:text-4xl"
            >
              What is an{" "}
              <span className="text-purple-700">Agentic AI Team?</span>
            </h2>

            <p className="max-w-xl text-lg leading-relaxed text-gray-600">
              Standard chatbots wait for one request at a time. Agentic teams{" "}
              <strong className="font-bold text-gray-900">work together for you</strong>{" "}
              by coordinating specialized AI experts that can reason, plan, and
              execute as one setup.
            </p>

            <ul className="space-y-4 pt-2" aria-label="Key capabilities">
              {[
                "Autonomous specialized agents with unique skills",
                "Continuous self-correction and peer review",
                "Expert delegation based on the task",
                "Faster execution across connected specialists",
              ].map((item, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                  className="flex items-center gap-3"
                >
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-green-200 bg-green-50 text-green-700"
                    aria-hidden="true"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">
                    {item}
                  </span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          {/* Central Orchestrator visualization — white card on white bg, defined by border */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="rounded-[2rem] border border-gray-200 bg-gray-50 p-2 shadow-sm">
              <div className="rounded-[1.75rem] border border-gray-100 bg-white p-5 sm:p-8">
                <div className="mb-8 flex items-center gap-4 border-b border-gray-100 pb-6">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600 text-white shadow-lg shadow-purple-500/20"
                    aria-hidden="true"
                  >
                    <Bot size={24} />
                  </div>
                  <div>
                    <h4 className="font-heading text-lg font-black leading-none text-gray-900">
                      Central Orchestrator
                    </h4>
                    <p className="mt-1 text-xs font-bold uppercase tracking-widest text-purple-600">
                      Multi-Agent Brain
                    </p>
                  </div>
                </div>
                <div
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                  role="list"
                  aria-label="Expert agents"
                >
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      role="listitem"
                      className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-center transition-colors hover:border-purple-200"
                    >
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500"
                        aria-hidden="true"
                      >
                        <Network size={18} />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Expert {i}
                        </p>
                        <div
                          className="mx-auto mt-1 h-1.5 w-10 rounded-full bg-gray-100"
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Orchestration modes header */}
        <div className="mx-auto mb-12 max-w-7xl">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-purple-700">
            The core philosophies
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h3 className="font-heading text-3xl font-black tracking-tight text-gray-950 lg:text-4xl">
              Intelligent orchestration modes
            </h3>
            <p className="max-w-sm text-base leading-relaxed text-gray-500 sm:text-right">
              Four ways to connect your specialists — choose the setup that fits
              the job.
            </p>
          </div>
        </div>

        {/* Orchestration cards — clean white, no gradients */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {orchestrationTypes.map((type, index) => {
            const Icon = type.icon;
            return (
              <motion.div
                key={type.title}
                custom={index}
                variants={itemVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md"
              >
                <div
                  className={cn(
                    "mb-5 flex h-12 w-12 items-center justify-center rounded-xl border-2",
                    type.iconClass
                  )}
                  aria-hidden="true"
                >
                  <Icon size={22} />
                </div>

                <div className="mb-auto space-y-3">
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-gray-400">
                      {type.tag}
                    </span>
                    <h4 className="mt-1 font-heading text-xl font-black tracking-tight text-gray-950">
                      {type.title}
                    </h4>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-600">
                    {type.description}
                  </p>
                </div>

                <div className="mt-8 flex items-center gap-2 border-t border-gray-100 pt-5">
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", type.dotClass)}
                    aria-hidden="true"
                  />
                  <span className={cn("text-xs font-bold", type.benefitClass)}>
                    {type.benefit}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
