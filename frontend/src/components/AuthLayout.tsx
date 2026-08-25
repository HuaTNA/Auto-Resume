"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { useLanguage } from "@/lib/language-context";

export default function AuthLayout({ children, mode }: { children: ReactNode; mode: "login" | "register" }) {
  const { text } = useLanguage();
  return (
    <div className="auth-canvas grid min-h-screen bg-[#F1F5F2] lg:grid-cols-[minmax(320px,0.9fr)_minmax(460px,1.1fr)]">
      <section className="relative hidden overflow-hidden border-r border-[rgba(38,51,47,0.10)] bg-[#E8EFEB] p-12 lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="latin flex size-10 items-center justify-center rounded-[6px] bg-[#26332F] text-xl text-[#F8FAF8]">桦</span>
          <span className="latin text-[10px] uppercase tracking-[0.36em] text-[#52645C]">Hua Workspace</span>
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="eyebrow text-[#64736C]">Personal system</p>
          <h1 className="mt-4 text-[2.25rem] font-normal leading-[1.35] tracking-[0.08em] text-[#26332F]">
            {text("把项目、职业与知识，安放在同一个工作空间。", "A quieter place for projects, career, and knowledge.")}
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-[#52645C]">
            {text("少一些切换，多一些清晰的下一步。", "Less switching. More clarity about what comes next.")}
          </p>
        </div>
        <p className="latin text-[9px] uppercase tracking-[0.32em] text-[#64736C]">Think · Organize · Move</p>
      </section>

      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
      <main className="auth-panel w-full max-w-[390px] rounded-[16px] border border-[rgba(38,51,47,0.10)] bg-[#F8FAF8] px-8 py-9 sm:px-11 sm:py-11">
        <div className="mb-8 text-center">
          <Link href="/" className="latin block text-[2.6rem] font-light leading-none tracking-[0.1em] text-[#26332F]">桦</Link>
          <p className="latin mt-2 text-[9px] uppercase tracking-[0.45em] text-[#64736C]">Personal AI Workspace</p>
        </div>

        <div className="mb-7 flex items-center gap-2.5" aria-hidden="true">
          <span className="h-px flex-1 bg-[rgba(131,154,144,0.40)]" />
          <span className="size-1 rounded-full bg-[rgba(131,154,144,0.55)]" />
          <span className="h-px flex-1 bg-[rgba(131,154,144,0.40)]" />
        </div>

        {children}

        <p className="latin mt-5 text-center text-[11px] italic tracking-[0.05em] text-[#64736C]">
          {mode === "login" ? text("初次来到？", "New here?") : text("已有账户？", "Already here?")} {" "}
          <Link href={mode === "login" ? "/register" : "/login"} className="text-[#26332F] underline decoration-[#839A90] underline-offset-4">
            {mode === "login" ? text("创建账户", "Create account") : text("返回登录", "Sign in")}
          </Link>
        </p>
      </main>
      </div>
    </div>
  );
}
