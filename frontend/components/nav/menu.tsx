"use client";

import { useSyncExternalStore, useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/lib/hooks";
import { selectUser } from "@/lib/features/auth/authSlice";

const items = [
  { href: "/", label: "Home" },
  { href: "/agent-builder", label: "Agent Builder" },
  { href: "/my-agents", label: "My Agent" },
  { href: "/chats", label: "Chats" },
  { href: "/dashboard", label: "Dashboard" },
];

// Client-side only hook to detect hydration
const emptySubscribe = () => () => { };
function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

interface UnderlinePosition {
  readonly left: number;
  readonly width: number;
}

export function MenuNav() {
  const pathname = usePathname();
  const user = useAppSelector(selectUser);
  const isMounted = useIsMounted();
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [underline, setUnderline] = useState<UnderlinePosition>({ left: 0, width: 0 });
  const [isReady, setIsReady] = useState(false);

  // Add Admin item if user is admin
  const navItems = [...items];
  if (isMounted && user?.role === "admin") {
    navItems.push({ href: "/admin", label: "Admin" });
  }

  const updateUnderline = useCallback((): void => {
    const activeLink = linkRefs.current.get(pathname);
    const nav = navRef.current;
    if (!activeLink || !nav) return;

    const navRect = nav.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();

    setUnderline({
      left: linkRect.left - navRect.left + linkRect.width / 2 - 12,
      width: 24,
    });

    if (!isReady) setIsReady(true);
  }, [pathname, isReady]);

  // Update underline position when the active route or items change
  useEffect(() => {
    // Small delay to ensure DOM is painted
    const timer = setTimeout(updateUnderline, 50);
    window.addEventListener("resize", updateUnderline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updateUnderline);
    };
  }, [updateUnderline]);

  const setLinkRef = (href: string) => (el: HTMLAnchorElement | null): void => {
    if (el) {
      linkRefs.current.set(href, el);
    }
  };

  return (
    <div className="absolute left-1/2 -translate-x-1/2 hidden md:block">
      <nav ref={navRef} className="relative flex items-center gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              ref={setLinkRef(item.href)}
              href={item.href}
              className={cn(
                "relative px-4 py-1.5 text-sm font-medium tracking-wide",
                "outline-none select-none transition-colors duration-200",
                isActive
                  ? "text-purple-600"
                  : "text-gray-500 hover:text-purple-500 active:opacity-70",
              )}
            >
              {item.label}
            </Link>
          );
        })}

        {/* Animated sliding underline bar */}
        <span
          className="absolute bottom-0 h-[2px] rounded-full bg-linear-to-r from-purple-500 to-blue-400 pointer-events-none transition-all duration-300 ease-in-out animate-[glowBar_3s_ease-in-out_infinite]"
          style={{
            left: underline.left,
            width: underline.width,
            opacity: isReady ? 1 : 0,
          }}
        />
      </nav>
    </div>
  );
}
