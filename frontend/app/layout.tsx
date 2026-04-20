import ForceResetGuard from "@/components/auth/force-reset-guard";
import { Navbar } from "@/components/nav/navbar";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import StoreProvider from "./StoreProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Slipumbrella - Agent Platform",
  description: "Next-gen AI agent orchestration for builders.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
      <body className="antialiased overflow-x-hidden" suppressHydrationWarning>
        <StoreProvider>
          <ForceResetGuard />
          <Navbar />
          <main>{children}</main>
          <Toaster />
        </StoreProvider>
      </body>
    </html>
  );
}
