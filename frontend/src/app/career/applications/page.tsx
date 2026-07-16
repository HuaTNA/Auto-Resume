"use client";

import Link from "next/link";
import Header from "@/components/Header";
import ApplicationRecords from "@/components/career/ApplicationRecords";
import { Section, WorkspacePage } from "@/components/workspace/WorkspaceUI";
import { useLanguage } from "@/lib/language-context";

export default function ApplicationsPage() {
  const { text } = useLanguage();
  return <><Header eyebrow={{ zh: "职业工作区", en: "CAREER WORKSPACE" }} title={{ zh: "申请", en: "Applications" }} subtitle={{ zh: "查看状态、ATS 分数、简历版本与求职信。", en: "Review status, ATS scores, resume versions, and cover letters." }} action={<Link href="/generate" className="primary-button"><span aria-hidden="true">＋</span>{text("新建申请", "New application")}</Link>} /><WorkspacePage><Section title={text("所有申请", "All applications")} eyebrow={text("生成与投递记录", "Generated and submitted work")}><ApplicationRecords /></Section></WorkspacePage></>;
}
