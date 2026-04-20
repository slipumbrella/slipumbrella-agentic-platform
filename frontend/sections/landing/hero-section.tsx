"use client";

import Link from "next/link";
import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CheckCircle2,
  BookOpen,
  PenLine,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { useAppSelector } from "@/lib/hooks";
import { selectUser } from "@/lib/features/auth/authSlice";
import { AuroraText } from "@/components/ui/aurora-text";

// ─── Content ────────────────────────────────────────────────────────────────

const proofPoints = [
  "No coding or prompt engineering required",
  "Upload your own documents and business knowledge",
  "Launch to LINE or use in-portal instantly",
];

// Scenario-based teams — each job maps to a realistic specialist team
const scenarios = [
  {
    job: '"Answer customer questions using our product handbook"',
    agents: [
      { name: "Handbook Reader", desc: "Finds the right section in your product docs", icon: BookOpen, color: "text-blue-700", bg: "bg-blue-50" },
      { name: "Answer Writer", desc: "Drafts a clear, helpful reply for the customer", icon: PenLine, color: "text-purple-700", bg: "bg-purple-50" },
      { name: "Response Checker", desc: "Verifies accuracy against the handbook", icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50" },
    ],
  },
  {
    job: '"Summarize weekly sales reports and flag anomalies"',
    agents: [
      { name: "Data Reader", desc: "Parses spreadsheets and CRM exports", icon: BookOpen, color: "text-blue-700", bg: "bg-blue-50" },
      { name: "Trend Analyst", desc: "Spots patterns and unusual changes", icon: PenLine, color: "text-purple-700", bg: "bg-purple-50" },
      { name: "Report Writer", desc: "Writes a concise weekly summary", icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50" },
    ],
  },
  {
    job: '"Screen job applicants against our hiring criteria"',
    agents: [
      { name: "Resume Parser", desc: "Extracts skills and experience from CVs", icon: BookOpen, color: "text-blue-700", bg: "bg-blue-50" },
      { name: "Criteria Matcher", desc: "Scores each candidate against your rubric", icon: PenLine, color: "text-purple-700", bg: "bg-purple-50" },
      { name: "Shortlist Builder", desc: "Ranks top applicants with reasoning", icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50" },
    ],
  },
  {
    job: '"Guide new employees through onboarding step by step"',
    agents: [
      { name: "Policy Reader", desc: "Knows your handbook and HR rules", icon: BookOpen, color: "text-blue-700", bg: "bg-blue-50" },
      { name: "Task Planner", desc: "Builds a day-by-day onboarding checklist", icon: PenLine, color: "text-purple-700", bg: "bg-purple-50" },
      { name: "Progress Tracker", desc: "Monitors completion and nudges next steps", icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50" },
    ],
  },
  {
    job: '"Troubleshoot IT tickets using our knowledge base"',
    agents: [
      { name: "KB Searcher", desc: "Matches the ticket to known solutions", icon: BookOpen, color: "text-blue-700", bg: "bg-blue-50" },
      { name: "Fix Drafter", desc: "Writes step-by-step resolution instructions", icon: PenLine, color: "text-purple-700", bg: "bg-purple-50" },
      { name: "Quality Checker", desc: "Ensures the fix is safe and complete", icon: ShieldCheck, color: "text-emerald-700", bg: "bg-emerald-50" },
    ],
  },
];

// ─── Animation variants ──────────────────────────────────────────────────────

const ease = [0.16, 1, 0.3, 1] as const;

export function HeroSection() {
  const user = useAppSelector(selectUser);
  const reduced = useReducedMotion();
  const [scenarioIndex, setScenarioIndex] = React.useState(0);

  const currentScenario = scenarios[scenarioIndex];

  React.useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      setScenarioIndex((prev) => (prev + 1) % scenarios.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [reduced]);

  const fadeUp = {
    hidden: { opacity: 0, y: reduced ? 0 : 18 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: reduced ? 0 : i * 0.09,
        duration: reduced ? 0 : 0.5,
        ease,
      },
    }),
  };

  const slideIn = {
    hidden: { opacity: 0, x: reduced ? 0 : 28 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { delay: reduced ? 0 : 0.22, duration: reduced ? 0 : 0.55, ease },
    },
  };

  return (
    <section className="relative overflow-x-clip bg-white px-4 py-24 mesh-hero lg:py-32" aria-labelledby="hero-heading">
      {/* Dynamic light orbs */}
      <div className="absolute inset-0 overflow-clip pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-200/30 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] translate-x-1/3 translate-y-1/3 rounded-full bg-blue-100/40 blur-[100px]" />
      </div>

      <div className="container relative mx-auto grid items-center gap-12 lg:gap-20 lg:grid-cols-[1fr_560px] xl:grid-cols-[1fr_620px]">

        {/* ── Left: Copy ── */}
        <div className="min-w-0 text-left">

          {/* Trust badge — credibility first */}
          <motion.div
            custom={0}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-600" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Mahidol University · Faculty of Engineering
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            custom={1}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            id="hero-heading"
            className="font-heading text-[28px] font-black leading-[1.1] tracking-[-0.04em] text-gray-950 xs:text-3xl sm:text-5xl lg:text-6xl xl:text-7xl"
          >
            Build your own
            <br />
            <AuroraText className="inline">agentic AI team</AuroraText>
          </motion.h1>

          {/* Sub-headline */}
          <motion.p
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-5 max-w-full sm:max-w-[480px] text-lg font-medium leading-relaxed text-gray-800 sm:text-xl"
          >
            Describe the job. Add your documents. Slipumbrella assembles a
            specialist AI team and guides every step of setup — no coding needed.
          </motion.p>

          {/* Proof points */}
          <motion.ul
            custom={3}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-7 space-y-3"
            aria-label="Key capabilities"
          >
            {proofPoints.map((point) => (
              <li key={point} className="flex items-center gap-2.5 text-sm font-medium text-gray-700">
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-purple-600"
                  aria-hidden="true"
                />
                {point}
              </li>
            ))}
          </motion.ul>

          {/* CTAs */}
          <motion.div
            custom={4}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mt-9 flex flex-col gap-3 sm:flex-row"
          >
            <Button
              asChild
              size="lg"
              className="group min-h-[44px] rounded-xl bg-purple-600 px-8 text-base font-semibold text-white transition-all duration-200 hover:-translate-y-px hover:bg-purple-700 hover:shadow-lg hover:shadow-purple-600/20 active:translate-y-0 active:shadow-none focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2"
            >
              <Link href="/agent-builder">
                Start building
                <ArrowRight
                  className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </Button>

            <Button
              asChild
              size="lg"
              variant="ghost"
              className="min-h-[44px] rounded-xl px-8 text-base font-semibold text-gray-700 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-purple-600 focus-visible:ring-offset-2"
            >
              <Link href={user ? "/my-agents" : "/login"}>
                {user ? "View my teams" : "Sign in"}
              </Link>
            </Button>
          </motion.div>
        </div>

        {/* ── Right: Product preview ── */}
        <motion.div
          variants={slideIn}
          initial="hidden"
          animate="visible"
          className="relative min-w-0 lg:ml-auto"
        >
          <div className="glass-strong rounded-3xl border-white/40 p-1.5 shadow-2xl lg:w-[560px] xl:w-[620px]">
            <div className="rounded-2xl bg-white/40 backdrop-blur-sm overflow-hidden">
              {/* The job the user described — cause */}
              <div className="border-b border-gray-100 px-5 py-4 lg:px-6 lg:py-5">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 lg:mb-3">
                  You described
                </p>
                <div className="flex items-start gap-2.5 lg:gap-3.5">
                  <div
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 lg:h-8 lg:w-8"
                    aria-hidden="true"
                  >
                    <MessageSquare className="h-3 w-3 text-purple-600 lg:h-4 lg:w-4" />
                  </div>
                  <div className="relative min-h-[52px] flex-1 lg:min-h-[68px]">
                    <AnimatePresence mode="popLayout">
                      <motion.p
                        key={scenarioIndex}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -16 }}
                        transition={{ duration: 0.35, ease }}
                        className="absolute inset-0 text-sm font-semibold leading-snug text-gray-900 line-clamp-2 lg:text-base"
                      >
                        {currentScenario.job}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* The team Slipumbrella created — effect */}
              <div className="px-5 pt-4 pb-5 lg:px-6 lg:pt-5 lg:pb-6">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 lg:mb-4">
                  What we will create
                </p>
                <div className="relative min-h-[210px] lg:min-h-[252px]">
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={scenarioIndex}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35, ease }}
                      className="absolute inset-0 space-y-2.5 lg:space-y-3"
                    >
                      {currentScenario.agents.map((agent, i) => {
                        const Icon = agent.icon;
                        return (
                          <motion.div
                            key={agent.name}
                            initial={{ opacity: 0, x: reduced ? 0 : 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: reduced ? 0 : 0.1 + i * 0.08, duration: reduced ? 0 : 0.35, ease }}
                            className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/60 p-3 shadow-sm lg:gap-4 lg:p-4"
                          >
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${agent.bg} ${agent.color} lg:h-10 lg:w-10`}
                              aria-hidden="true"
                            >
                              <Icon className="h-4 w-4 lg:h-[18px] lg:w-[18px]" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 lg:text-[15px]">
                                {agent.name}
                              </p>
                              <p className="truncate text-xs text-gray-500 lg:text-sm">{agent.desc}</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          {/* Subtle glow ring */}
          <div
            className="pointer-events-none absolute -inset-px rounded-3xl ring-1 ring-purple-100/50"
            aria-hidden="true"
          />
        </motion.div>

      </div>
    </section>
  );
}
