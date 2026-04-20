"use client";

import { Mail } from "lucide-react";

const teamEmails = [
  "ryw.jakkraphat@gmail.com",
  "narawitkampan@gmail.com",
  "thanakrit.ultra@gmail.com",
  "kliv2554@gmail.com",
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 bg-white py-12">
      <div className="container mx-auto px-6">
        <div className="mb-12 flex flex-col items-center justify-between gap-8 md:flex-row md:items-start">
          {/* Brand */}
          <div className="space-y-4 text-center md:text-left">
            <div className="flex items-center justify-center gap-2 md:justify-start">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white"
                aria-hidden="true"
              >
                <span className="font-heading text-xs font-black">S</span>
              </div>
              <span className="font-heading text-xl font-black tracking-tight text-gray-900">
                Slipumbrella
              </span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-gray-500">
              Empowering specialists through autonomous agentic AI orchestration.
            </p>
          </div>

          {/* Team contacts */}
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
              Our Team
            </h4>
            <ul className="flex flex-col gap-2">
              {teamEmails.map((email) => (
                <li key={email}>
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center gap-2 break-all text-xs font-bold text-gray-600 transition-colors hover:text-purple-700 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
                  >
                    <Mail size={12} className="shrink-0" aria-hidden="true" />
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-8 text-center md:flex-row md:text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
            &copy; {currentYear} Slipumbrella. All rights reserved.
          </p>

          <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
            Faculty of Engineering,{" "}
            <span className="text-purple-700">Mahidol University</span>
          </p>

          <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-purple-700">
            Senior Year Capstone Project
          </span>
        </div>
      </div>
    </footer>
  );
}
