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
      <div className="flex min-h-screen items-center justify-center bg-[#E8E1D0]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-[6px] bg-[#1E1A14] text-[#F5EFE0] shadow-[0_2px_10px_rgba(30,26,20,0.07)]"><span className="text-xl tracking-[0.1em]">桦</span></div>
          <div className="ornament-divider"><span /></div>
          <p className="latin text-[10px] uppercase tracking-[0.32em] text-[#7A6A50]">Opening workspace</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#E8E1D0]">
      <Sidebar />
      <main className="workspace-canvas min-w-0 flex-1 overflow-y-auto pb-24 lg:pb-0">{children}</main>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}
