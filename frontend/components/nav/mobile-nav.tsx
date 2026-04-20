"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Home, LayoutDashboard, LogOut, Menu, MessageCircle, Settings, Sparkles } from "lucide-react";

import { selectUser } from "@/lib/features/auth/authSlice";
import { useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const baseItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/agent-builder", label: "Agent Builder", icon: Sparkles },
  { href: "/my-agents", label: "My Agents", icon: Archive },
  { href: "/chats", label: "Chats", icon: MessageCircle },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

export function MobileNav() {
  const pathname = usePathname();
  const user = useAppSelector(selectUser);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const navItems = user?.role === "admin"
    ? [...baseItems, { href: "/admin", label: "Admin", icon: Settings }]
    : baseItems;

  return (
    <div className="flex items-center md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 rounded-full text-gray-700 transition-colors hover:bg-gray-100"
            aria-label="Open navigation menu"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>

        <SheetContent side="left" className="flex w-80 flex-col border-r border-gray-200 bg-white p-0 shadow-xl">
          <div className="border-b border-gray-200 px-6 pb-6 pt-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-purple-200 bg-purple-50">
                <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-white">
                  <Image
                    src="/favicon.svg"
                    alt="Logo"
                    width={24}
                    height={24}
                    className="object-contain"
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold leading-none tracking-tight text-gray-900">
                  Slipumbrella
                </span>
                <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">Platform</span>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden px-4 py-6">
            <div className="flex flex-col gap-1.5">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-sm font-bold transition-colors",
                      isActive
                        ? "border-purple-100 bg-purple-50 text-purple-700"
                        : "border-transparent text-gray-600 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900",
                    )}
                  >
                    <div
                      className={cn(
                        "rounded-xl p-2 transition-colors",
                        isActive ? "bg-white text-purple-700" : "bg-gray-100 text-gray-500 group-hover:bg-white group-hover:text-purple-600",
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <span className="tracking-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {user ? (
            <div className="mt-auto border-t border-gray-200 px-4 py-4">
              <div className="rounded-2xl border border-gray-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-purple-100 bg-white">
                    <div className="flex h-full w-full items-center justify-center rounded-full font-bold text-purple-700">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 truncate text-sm font-black leading-none text-gray-900">
                      {user.username}
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
                      {user.role} Account
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    aria-label="Sign out"
                    onClick={() => { /* Logout logic */ }}
                  >
                    <LogOut className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <span className="ml-2 text-base font-bold tracking-tighter text-gray-900">
        Slipumbrella
      </span>
    </div>
  );
}
