"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type Language = "zh" | "en";
export type BilingualText = string | { zh: string; en: string };

const STORAGE_KEY = "hua-language";
const LANGUAGE_EVENT = "hua-language-change";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  text: (zh: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(LANGUAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LANGUAGE_EVENT, callback);
  };
}

function getSnapshot(): Language {
  return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(subscribe, getSnapshot, () => "zh" as Language);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.language = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(LANGUAGE_EVENT));
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    text: (zh, en) => language === "zh" ? zh : en,
  }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function resolveText(value: BilingualText | undefined, language: Language) {
  if (!value) return "";
  return typeof value === "string" ? value : value[language];
}
