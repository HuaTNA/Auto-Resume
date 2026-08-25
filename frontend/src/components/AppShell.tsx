"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import Sidebar, { MobileNav } from "./Sidebar";
import CommandPalette from "./CommandPalette";

const PUBLIC_PATHS = ["/login", "/register"];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!isLoading && !user && !isPublic) router.push("/login");
  }, [isLoading, user, isPublic, router]);

  if (isPublic) return <>{children}</>;

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F1F5F2]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-[6px] bg-[#26332F] text-[#F8FAF8] shadow-[0_2px_10px_rgba(38,51,47,0.07)]"><span className="text-xl tracking-[0.1em]">桦</span></div>
          <div className="ornament-divider"><span /></div>
          <p className="latin text-[10px] uppercase tracking-[0.32em] text-[#52645C]">Opening workspace</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#F1F5F2]">
      <Sidebar />
      <main className="workspace-canvas min-w-0 flex-1 overflow-y-auto pb-24 lg:pb-0">{children}</main>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}
