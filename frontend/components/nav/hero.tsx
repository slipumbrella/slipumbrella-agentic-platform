"use client";

import Link from "next/link";
import { AuroraText } from "@/components/ui/aurora-text";

export function HeroNav() {
  return (
    <div className="hidden md:flex">
      <Link href="/" className="flex items-center space-x-2 group">
        {/* Glowing icon dot */}
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-linear-to-r from-purple-500 to-blue-500" />
        </span>
        <AuroraText className="font-bold text-lg tracking-tighter">
          slipumbrella
        </AuroraText>
      </Link>
    </div>
  );
}