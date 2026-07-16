"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/language-context";
import { CAREER_ROUTES, PRIMARY_MODULES, routeIsActive, SYSTEM_ROUTES, type ModuleRoute } from "@/lib/module-registry";
import { BirchIcon } from "./icons/BirchIcons";

function label(item: ModuleRoute, language: "zh" | "en") {
  return item.label[language];
}

function Brand() {
  const { language } = useLanguage();
  return (
    <Link href="/" className="group flex items-center gap-3" aria-label={language === "zh" ? "桦 · 返回主页" : "Hua · Back home"}>
      <span className="flex size-9 items-center justify-center rounded-[6px] bg-[#EBE2CC] transition-transform group-hover:-translate-y-0.5">
        <BirchIcon name="tree" size={22} />
      </span>
      <span>
        <span className="latin block text-[20px] leading-none tracking-[0.12em] text-[#1E1A14]">HUA</span>
        <span className="latin mt-1 block text-[7px] uppercase tracking-[0.25em] text-[#9A8468]">Personal AI Workspace</span>
      </span>
    </Link>
  );
}

function NavLink({ item, compact = false, onClick }: { item: ModuleRoute; compact?: boolean; onClick?: () => void }) {
  const pathname = usePathname();
  const { language } = useLanguage();
  const careerPath = pathname.startsWith("/career") || ["/search", "/generate", "/profile"].some((route) => pathname.startsWith(route));
  const active = routeIsActive(pathname, item.href) || (item.id === "career" && careerPath);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`group relative flex min-h-9 items-center gap-2.5 border-l-2 px-4 py-1.5 text-[13px] tracking-[0.01em] transition-colors ${
        active
          ? "border-[#1E1A14] bg-[rgba(30,26,20,0.07)] text-[#1E1A14]"
          : "border-transparent text-[#7A6A50] hover:bg-[rgba(30,26,20,0.04)] hover:text-[#1E1A14]"
      } ${compact ? "pl-8 text-[12px]" : ""}`}
    >
      <span className={`flex shrink-0 items-center justify-center ${compact ? "size-6 rounded-[6px] bg-[#EBE2CC]" : "size-5"}`}>
        <BirchIcon name={item.icon} size={compact ? 14 : 16} />
      </span>
      <span className="truncate">{label(item, language)}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="latin px-5 pb-1 pt-3 text-[8px] uppercase tracking-[0.34em] text-[#9A8468]">{children}</p>;
}

export default function Sidebar() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { text } = useLanguage();
  const [careerOpen, setCareerOpen] = useState(true);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const home = PRIMARY_MODULES[0];
  const career = PRIMARY_MODULES[1];
  const workModules = PRIMARY_MODULES.slice(2, 6);
  const operations = PRIMARY_MODULES.slice(6);

  return (
    <aside className="workspace-sidebar hidden h-screen w-[220px] shrink-0 flex-col overflow-y-auto border-r border-[rgba(30,26,20,0.10)] bg-[#EDE7D3] lg:flex">
      <div className="border-b border-[rgba(30,26,20,0.10)] px-5 pb-4 pt-5"><Brand /></div>

      <div className="px-3 py-2.5">
        <button
          onClick={() => window.dispatchEvent(new Event("hua-command-palette"))}
          className="flex min-h-9 w-full items-center gap-2 rounded-[6px] bg-[rgba(30,26,20,0.06)] px-2.5 text-left text-[11px] text-[#7A6A50] hover:bg-[#F5EFE0] hover:text-[#1E1A14]"
        >
          <BirchIcon name="growth-ring" size={15} />
          <span className="flex-1">{text("搜索或跳转…", "Search or go to…")}</span>
          <kbd className="rounded-[4px] border border-[rgba(30,26,20,0.10)] px-1.5 py-0.5 text-[8px]">⌘K</kbd>
        </button>
      </div>

      <nav aria-label={text("全局导航", "Global navigation")}>
        <SectionLabel>Workspace</SectionLabel>
        <NavLink item={home} />
        <div>
          <div className="relative flex items-center">
            <div className="min-w-0 flex-1"><NavLink item={career} onClick={() => setCareerOpen(true)} /></div>
            <button
              onClick={() => setCareerOpen((open) => !open)}
              aria-expanded={careerOpen}
              aria-label={text("展开职业模块", "Toggle Career module")}
              className="absolute right-3 flex size-7 items-center justify-center text-[#9A8468] hover:text-[#1E1A14]"
            >
              <span aria-hidden="true">{careerOpen ? "⌃" : "⌄"}</span>
            </button>
          </div>
          {careerOpen && <div className="ml-3 border-l border-[rgba(30,26,20,0.10)]">{CAREER_ROUTES.map((item) => <NavLink key={item.id} item={item} compact />)}</div>}
        </div>
        {workModules.map((item) => <NavLink key={item.id} item={item} />)}

        <SectionLabel>Operations</SectionLabel>
        {operations.map((item) => <NavLink key={item.id} item={item} />)}

        <SectionLabel>Intelligence</SectionLabel>
        {SYSTEM_ROUTES.map((item) => <NavLink key={item.id} item={item} />)}
      </nav>

      {user && <div className="mt-auto border-t border-[rgba(30,26,20,0.10)] px-4 pt-4 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="latin flex size-8 shrink-0 items-center justify-center rounded-[16px] bg-[#1E1A14] text-[12px] text-[#F5EFE0]">{user.email.charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[9px] text-[#1E1A14]">{user.email}</p>
            <p className="latin mt-0.5 text-[7px] uppercase tracking-[0.2em] text-[#9A8468]">{text("个人工作区", "Private workspace")}</p>
          </div>
          <button onClick={handleLogout} aria-label={text("退出登录", "Sign out")} className="flex size-7 items-center justify-center text-[#7A6A50] hover:text-[#1E1A14]"><BirchIcon name="winter" size={15} /></button>
        </div>
      </div>}
    </aside>
  );
}

const MOBILE_ITEMS = [PRIMARY_MODULES[0], PRIMARY_MODULES[2], PRIMARY_MODULES[3], PRIMARY_MODULES[1], SYSTEM_ROUTES[0]];

export function MobileNav() {
  const pathname = usePathname();
  const { language } = useLanguage();
  return (
    <nav aria-label={language === "zh" ? "移动导航" : "Mobile navigation"} className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[#EDE7D3] p-1.5 shadow-[0_2px_8px_rgba(30,26,20,0.05)] lg:hidden">
      {MOBILE_ITEMS.map((item) => {
        const active = routeIsActive(pathname, item.href) || (item.id === "career" && ["/search", "/generate", "/profile"].some((route) => pathname.startsWith(route)));
        return <Link key={item.id} href={item.href} aria-label={label(item, language)} className={`flex min-w-12 flex-col items-center gap-0.5 rounded-[6px] px-2 py-1 text-[8px] ${active ? "bg-[#EBE2CC] text-[#1E1A14]" : "text-[#7A6A50]"}`}><BirchIcon name={item.icon} size={17} /><span>{label(item, language)}</span></Link>;
      })}
    </nav>
  );
}
