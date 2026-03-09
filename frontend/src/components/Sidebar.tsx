"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { href: "/", icon: "dashboard", label: "Dashboard" },
  { href: "/generate", icon: "add_circle", label: "Generate" },
  { href: "/search", icon: "work", label: "Job Search" },
  { href: "/templates", icon: "description", label: "Templates" },
  { href: "/profile", icon: "account_circle", label: "Profile" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <aside className="w-64 border-r border-slate-200 bg-white flex flex-col shrink-0">
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="bg-[#4051b5] size-10 rounded-lg flex items-center justify-center text-white">
            <span className="material-symbols-outlined">auto_awesome</span>
          </div>
          <div>
            <h1 className="text-slate-900 text-lg font-bold leading-none">AI Resume</h1>
            <p className="text-slate-500 text-xs mt-1">Generator Pro</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors ${
                active
                  ? "bg-[#4051b5]/10 text-[#4051b5]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-[#4051b5]"
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-3">
        {user && (
          <div className="flex items-center gap-2 px-1">
            <span className="material-symbols-outlined text-slate-400 text-[20px]">person</span>
            <span className="text-xs text-slate-600 truncate flex-1">{user.email}</span>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="text-slate-400 hover:text-red-500 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>
        )}
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Powered by
          </p>
          <p className="text-sm font-medium text-slate-700">Claude API</p>
          <p className="text-xs text-slate-500 mt-1">claude-sonnet-4-20250514</p>
        </div>
      </div>
    </aside>
  );
}
