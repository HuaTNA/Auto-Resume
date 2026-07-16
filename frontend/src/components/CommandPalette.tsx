"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_ROUTES } from "@/lib/module-registry";
import { useLanguage } from "@/lib/language-context";
import { BirchIcon } from "@/components/icons/BirchIcons";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { language, text } = useLanguage();

  useEffect(() => {
    function show() { setOpen(true); }
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((value) => !value); }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("hua-command-palette", show);
    window.addEventListener("keydown", keyboard);
    return () => { window.removeEventListener("hua-command-palette", show); window.removeEventListener("keydown", keyboard); };
  }, []);

  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 20); }, [open]);

  function close() { setOpen(false); setQuery(""); }

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const unique = ALL_ROUTES.filter((route, index, all) => all.findIndex((item) => item.href === route.href) === index);
    if (!needle) return unique.slice(0, 10);
    return unique.filter((route) => [route.label.zh, route.label.en, route.description?.zh, route.description?.en, ...(route.keywords ?? [])].filter(Boolean).join(" ").toLowerCase().includes(needle)).slice(0, 10);
  }, [query]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-[rgba(30,26,20,0.45)] p-4 pt-[10vh]" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label={text("全局搜索", "Global search")} className="mx-auto max-w-[640px] overflow-hidden rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] shadow-[0_16px_48px_rgba(30,26,20,0.16),0_4px_16px_rgba(30,26,20,0.08)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[rgba(30,26,20,0.12)] px-4"><BirchIcon name="growth-ring" size={20} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && results[0]) { router.push(results[0].href); close(); } }} placeholder={text("搜索模块、功能或操作…", "Search modules, features, or actions…")} className="min-h-14 flex-1 border-0 bg-transparent text-sm outline-none" /><button onClick={close} aria-label={text("关闭", "Close")} className="flex size-8 items-center justify-center rounded-[6px] text-[#7A6A50] hover:bg-[#FDFAF3]">×</button></div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 ? <p className="px-4 py-10 text-center text-sm text-[#7A6A50]">{text("没有找到相关模块", "No matching workspace area")}</p> : results.map((route) => <button key={route.href} onClick={() => { router.push(route.href); close(); }} className="flex w-full items-center gap-3 rounded-[6px] px-3 py-3 text-left transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-1 hover:bg-[#FDFAF3]">
            <span className="flex size-9 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name={route.icon} size={21} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm">{route.label[language]}</span>{route.description && <span className="mt-0.5 block truncate text-[11px] text-[#7A6A50]">{route.description[language]}</span>}</span><span className="text-xs text-[#9A8468]">↵</span>
          </button>)}
        </div>
        <div className="latin border-t border-[rgba(30,26,20,0.12)] px-4 py-2 text-[9px] uppercase tracking-[0.24em] text-[#9A8468]">{text("输入搜索 · 回车打开 · Esc 关闭", "Type to search · Enter to open · Esc to close")}</div>
      </div>
    </div>
  );
}
