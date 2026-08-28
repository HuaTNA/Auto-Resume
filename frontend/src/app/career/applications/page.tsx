"use client";

import Header from "@/components/Header";
import AgentControlCenter from "@/components/career/AgentControlCenter";
import { Section, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useLanguage } from "@/lib/language-context";

export default function ApplicationsPage() {
  const { text } = useLanguage();
  return <><Header eyebrow={{ zh: "职业 Agent", en: "CAREER AGENT" }} title={{ zh: "申请控制中心", en: "Application control center" }} subtitle={{ zh: "回答问题、审核内容，并跟踪提交回执。最终提交始终由你确认。", en: "Answer questions, approve content, and track receipts. Final submission always needs you." }} /><WorkspacePage><Section title={text("Agent 申请", "Agent applications")} eyebrow={text("Auto-Resume 是唯一事实来源", "Auto-Resume is the source of truth")}><AgentControlCenter /></Section></WorkspacePage></>;
}
