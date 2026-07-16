"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { useLanguage } from "@/lib/language-context";

export default function AuthLayout({ children, mode }: { children: ReactNode; mode: "login" | "register" }) {
  const { text } = useLanguage();
  const [splashVisible, setSplashVisible] = useState(false);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [entered, setEntered] = useState(mode === "register");
  const [cardVisible, setCardVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashVisible(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!entered) return;
    const timer = window.setTimeout(() => setCardVisible(true), 60);
    return () => window.clearTimeout(timer);
  }, [entered]);

  function enterLogin() {
    setSplashLeaving(true);
    window.setTimeout(() => setEntered(true), 600);
  }

  if (!entered) {
    return (
      <button
        type="button"
        onClick={enterLogin}
        aria-label={text("进入桦工作区登录", "Continue to sign in")}
        className={`fixed inset-0 flex cursor-pointer items-center justify-center border-0 bg-[#E8E1D0] p-0 transition-opacity duration-[600ms] ease-out ${splashLeaving ? "opacity-0" : splashVisible ? "opacity-100" : "opacity-0"}`}
      >
        <span className="flex items-center gap-6 transition-transform duration-[1000ms] ease-out" style={{ transform: `scale(${splashLeaving ? 0.97 : splashVisible ? 1 : 0.96})` }}>
          <span className="h-px w-20 bg-[rgba(30,26,20,0.25)]" />
          <span className="latin text-[1.1rem] tracking-[0.2em] text-[#1E1A14]">桦</span>
          <span className="h-px w-20 bg-[rgba(30,26,20,0.25)]" />
        </span>
      </button>
    );
  }

  return (
    <div className="auth-canvas flex min-h-screen items-center justify-center bg-[#E8E1D0] px-5 py-10">
      <main className={`auth-panel w-full max-w-[380px] rounded-[16px] border border-[rgba(30,26,20,0.10)] bg-[#F5EFE0] px-8 py-10 shadow-[0_8px_48px_rgba(30,26,20,0.09)] transition-all duration-[800ms] ease-out sm:px-11 sm:py-12 ${cardVisible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
        <div className="mb-8 text-center">
          <Link href="/" className="latin block text-[2.6rem] font-light leading-none tracking-[0.1em] text-[#1E1A14]">桦</Link>
          <p className="latin mt-2 text-[9px] uppercase tracking-[0.45em] text-[#9A8468]">Personal AI Workspace</p>
        </div>

        <div className="mb-7 flex items-center gap-2.5" aria-hidden="true">
          <span className="h-px flex-1 bg-[rgba(184,169,138,0.40)]" />
          <span className="size-1 rounded-full bg-[rgba(184,169,138,0.55)]" />
          <span className="h-px flex-1 bg-[rgba(184,169,138,0.40)]" />
        </div>

        {children}

        <p className="latin mt-5 text-center text-[11px] italic tracking-[0.05em] text-[#9A8468]">
          {mode === "login" ? text("初次来到？", "New here?") : text("已有账户？", "Already here?")} {" "}
          <Link href={mode === "login" ? "/register" : "/login"} className="text-[#1E1A14] underline decoration-[#B8A98A] underline-offset-4">
            {mode === "login" ? text("创建账户", "Create account") : text("返回登录", "Sign in")}
          </Link>
        </p>
      </main>
    </div>
  );
}
