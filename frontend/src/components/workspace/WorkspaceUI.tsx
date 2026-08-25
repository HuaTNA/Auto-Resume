"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { BirchIcon, type BirchIconName } from "@/components/icons/BirchIcons";

export function WorkspacePage({ children }: { children: ReactNode }) {
  return <div className="workspace-page mx-auto w-full max-w-[1080px] space-y-6 px-5 py-6 sm:px-8 lg:px-12 lg:pb-10 lg:pt-7">{children}</div>;
}

export function Section({ title, eyebrow, action, children, className = "" }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={className}><div className="section-heading mb-3.5 flex items-end justify-between gap-4"><div>{eyebrow && <p className="latin text-xs uppercase tracking-[0.22em] text-[#52645C]">{eyebrow}</p>}<h2 className="mt-1 text-[1.12rem] font-medium tracking-[0.06em]">{title}</h2></div>{action}</div>{children}</section>;
}

export function EmptyState({ icon = "winter", title, description, action }: { icon?: BirchIconName; title: string; description: string; action?: { label: string; onClick?: () => void; href?: string } }) {
  const button = action?.href
    ? <Link href={action.href} className="secondary-button mt-4"><span aria-hidden="true">＋</span>{action.label}</Link>
    : action ? <button onClick={action.onClick} className="secondary-button mt-4"><span aria-hidden="true">＋</span>{action.label}</button> : null;
  return <div className="rounded-[12px] border border-[rgba(38,51,47,0.10)] bg-[rgba(248,250,248,0.58)] px-5 py-7 text-center"><span className="mx-auto flex size-10 items-center justify-center rounded-[6px] bg-[#E1EAE5]"><BirchIcon name={icon} size={23} /></span><h3 className="mt-3 text-sm font-medium tracking-[0.06em]">{title}</h3><p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-[#52645C]">{description}</p>{button}</div>;
}

export function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "success" | "warning"; children: ReactNode }) {
  const styles = { neutral: "bg-[#E1EAE5] text-[#52645C]", brand: "bg-[#26332F] text-[#F8FAF8]", success: "bg-[#839A90] text-[#26332F]", warning: "border border-[rgba(38,51,47,0.12)] bg-transparent text-[#26332F]" };
  return <span className={`inline-flex min-h-6 items-center rounded-[6px] px-2 text-xs font-medium uppercase tracking-[0.12em] ${styles[tone]}`}>{children}</span>;
}

export function CreatePanel({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  return <section className="rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8] p-5 shadow-[0_2px_10px_rgba(38,51,47,0.07)] sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-medium tracking-[0.1em]">{title}</h2>{description && <p className="mt-1 text-xs text-[#52645C]">{description}</p>}</div><button onClick={onClose} aria-label="Close" className="rounded-[6px] px-2 py-1 text-sm text-[#52645C] hover:bg-[#FCFDFB]">×</button></div><div className="mt-5">{children}</div></section>;
}
