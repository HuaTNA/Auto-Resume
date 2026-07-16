"use client";

import { useLanguage } from "@/lib/language-context";

export default function LanguageSwitch({ inverse = false }: { inverse?: boolean }) {
  const { language, setLanguage } = useLanguage();
  const border = "border-[rgba(30,26,20,0.12)]";
  const muted = inverse ? "text-[#B8A98A]" : "text-[#7A6A50]";
  const active = inverse ? "bg-[#F5EFE0] text-[#1E1A14]" : "bg-[#1E1A14] text-[#F5EFE0]";

  return (
    <div className={`flex rounded-[6px] border ${border} p-0.5`} role="group" aria-label="Language / 语言">
      <button onClick={() => setLanguage("zh")} aria-pressed={language === "zh"} className={`min-h-7 rounded-[6px] px-2 text-[9px] tracking-[0.1em] transition-colors duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] ${language === "zh" ? active : muted}`}>中文</button>
      <button onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`latin min-h-7 rounded-[6px] px-2 text-[9px] uppercase tracking-[0.18em] transition-colors duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] ${language === "en" ? active : muted}`}>EN</button>
    </div>
  );
}
