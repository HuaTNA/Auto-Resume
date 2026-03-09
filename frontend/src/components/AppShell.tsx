"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import Sidebar from "./Sidebar";

const PUBLIC_PATHS = ["/login", "/register"];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!isLoading && !user && !isPublic) {
      router.push("/login");
    }
  }, [isLoading, user, isPublic, router]);

  // Public pages (login / register) — render without sidebar
  if (isPublic) {
    return <>{children}</>;
  }

  // Waiting for auth check — show spinner to prevent flash
  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f6f6f8]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#4051b5]" />
      </div>
    );
  }

  // Authenticated — render full app layout
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
