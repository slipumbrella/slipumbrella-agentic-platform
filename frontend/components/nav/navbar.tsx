"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";

// Import your split components
import { HeroNav } from "@/components/nav/hero";
import { MobileNav } from "@/components/nav/mobile-nav";
import { MenuNav } from "@/components/nav/menu";

// Dynamic Imports for Auth/Team logic (Client-side only)
const UserNav = dynamic(() => import("@/components/nav/user-nav").then((mod) => mod.UserNav), {
  ssr: false,
  loading: () => (
    <Button variant="default" size="sm" className="bg-linear-to-r from-purple-600 to-blue-500">
      Sign In
    </Button>
  ),
});

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full">
      {/* ── Glowing orb — soft purple/blue tint (desktop only) ── */}
      <div className="hidden md:block absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[500px] h-[100px] rounded-full blur-3xl pointer-events-none bg-linear-to-r from-purple-300/40 via-blue-200/30 to-purple-300/40 animate-[orbPulse_4s_ease-in-out_infinite]" />

      {/* Main glass bar */}
      <div className="relative bg-white/60 backdrop-blur-2xl backdrop-saturate-150 border-glow-bottom">

        {/* Left gradient glow (desktop only) */}
        <div className="hidden md:block absolute left-0 top-0 bottom-0 w-44 bg-linear-to-r from-purple-500/20 via-purple-400/10 to-transparent pointer-events-none animate-[glowLeft_5s_ease-in-out_infinite]" />

        {/* Right gradient glow (desktop only) */}
        <div className="hidden md:block absolute right-0 top-0 bottom-0 w-44 bg-linear-to-l from-blue-500/20 via-blue-400/10 to-transparent pointer-events-none animate-[glowRight_5s_ease-in-out_infinite_1s]" />

        <div className="relative flex justify-between h-14 w-full items-center px-3 sm:px-5 md:px-10">
          {/* LEFT SIDE: Logo (desktop) + Hamburger (mobile) */}
          <div className="flex items-center">
            <HeroNav />
            <MobileNav />
          </div>

          {/* CENTER: Nav Links (desktop only) */}
          <MenuNav />

          {/* RIGHT SIDE: User Profile */}
          <div className="flex items-center gap-2">
            <UserNav />
          </div>
        </div>
      </div>

    </header>
  );
}