"use client";

import { useLanguage } from "@/lib/language-context";

export default function LanguageSwitch({ inverse = false }: { inverse?: boolean }) {
  const { language, setLanguage } = useLanguage();
  const border = "border-[rgba(38,51,47,0.12)]";
  const muted = inverse ? "text-[#839A90]" : "text-[#52645C]";
  const active = inverse ? "bg-[#F8FAF8] text-[#26332F]" : "bg-[#26332F] text-[#F8FAF8]";

  return (
    <div className={`flex rounded-[6px] border ${border} p-0.5`} role="group" aria-label="Language / 语言">
      <button onClick={() => setLanguage("zh")} aria-pressed={language === "zh"} className={`min-h-7 rounded-[6px] px-2 text-[9px] tracking-[0.1em] transition-colors duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] ${language === "zh" ? active : muted}`}>中文</button>
      <button onClick={() => setLanguage("en")} aria-pressed={language === "en"} className={`latin min-h-7 rounded-[6px] px-2 text-[9px] uppercase tracking-[0.18em] transition-colors duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] ${language === "en" ? active : muted}`}>EN</button>
    </div>
  );
}
