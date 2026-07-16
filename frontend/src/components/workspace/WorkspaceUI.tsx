"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { BirchIcon, type BirchIconName } from "@/components/icons/BirchIcons";

export function WorkspacePage({ children }: { children: ReactNode }) {
  return <div className="workspace-page mx-auto w-full max-w-[1000px] space-y-7 px-5 py-7 sm:px-8 lg:px-12 lg:pb-10 lg:pt-8">{children}</div>;
}

export function Section({ title, eyebrow, action, children, className = "" }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={className}><div className="section-heading mb-3.5 flex items-end justify-between gap-4"><div>{eyebrow && <p className="latin text-[9px] uppercase tracking-[0.32em] text-[#9A8468]">{eyebrow}</p>}<h2 className="mt-1 text-[1.05rem] font-medium tracking-[0.08em]">{title}</h2></div>{action}</div>{children}</section>;
}

export function EmptyState({ icon = "winter", title, description, action }: { icon?: BirchIconName; title: string; description: string; action?: { label: string; onClick?: () => void; href?: string } }) {
  const button = action?.href
    ? <Link href={action.href} className="secondary-button mt-4"><span aria-hidden="true">＋</span>{action.label}</Link>
    : action ? <button onClick={action.onClick} className="secondary-button mt-4"><span aria-hidden="true">＋</span>{action.label}</button> : null;
  return <div className="rounded-[12px] border border-[rgba(30,26,20,0.10)] bg-[rgba(245,239,224,0.45)] px-5 py-7 text-center"><span className="mx-auto flex size-10 items-center justify-center rounded-[6px] bg-[#EBE2CC]"><BirchIcon name={icon} size={23} /></span><h3 className="mt-3 text-xs font-medium tracking-[0.1em]">{title}</h3><p className="mx-auto mt-1.5 max-w-md text-[11px] leading-5 text-[#7A6A50]">{description}</p>{button}</div>;
}

export function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "success" | "warning"; children: ReactNode }) {
  const styles = { neutral: "bg-[#EBE2CC] text-[#7A6A50]", brand: "bg-[#1E1A14] text-[#F5EFE0]", success: "bg-[#B8A98A] text-[#1E1A14]", warning: "border border-[rgba(30,26,20,0.12)] bg-transparent text-[#1E1A14]" };
  return <span className={`inline-flex min-h-5 items-center rounded-[6px] px-2 text-[8px] font-medium uppercase tracking-[0.2em] ${styles[tone]}`}>{children}</span>;
}

export function CreatePanel({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  return <section className="rounded-[16px] border border-[rgba(30,26,20,0.12)] bg-[#F5EFE0] p-5 shadow-[0_2px_10px_rgba(30,26,20,0.07)] sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-medium tracking-[0.1em]">{title}</h2>{description && <p className="mt-1 text-xs text-[#7A6A50]">{description}</p>}</div><button onClick={onClose} aria-label="Close" className="rounded-[6px] px-2 py-1 text-sm text-[#7A6A50] hover:bg-[#FDFAF3]">×</button></div><div className="mt-5">{children}</div></section>;
}
