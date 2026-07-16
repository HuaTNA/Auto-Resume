"use client";

import { BilingualText, resolveText, useLanguage } from "@/lib/language-context";

interface HeaderProps { title: BilingualText; subtitle?: BilingualText; eyebrow?: BilingualText; action?: React.ReactNode }

export default function Header({ title, subtitle, eyebrow, action }: HeaderProps) {
  const { language } = useLanguage();
  return (
    <header className="workspace-header relative z-20 px-5 pb-5 pt-7 sm:px-8 lg:px-12 lg:pt-9">
      <div className="mx-auto flex w-full max-w-[1000px] items-end justify-between gap-5">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5 text-[#9A8468]">{resolveText(eyebrow, language)}</p>}
          <h1 className="latin truncate text-[1.75rem] font-normal leading-[1.15] tracking-[0.04em] text-[#1E1A14] sm:text-[2rem]">{resolveText(title, language)}</h1>
          {subtitle && <p className="mt-1 text-[12px] leading-5 text-[#7A6A50]">{resolveText(subtitle, language)}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-3">{action}</div>}
      </div>
    </header>
  );
}
