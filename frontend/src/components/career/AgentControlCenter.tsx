"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { createSubmission, decideApproval, listAgentApplications, requestApplicationApproval, saveApplicationAnswer } from "@/lib/agent-api";
import type { AgentApplication, AgentDeviceSettings, AgentState } from "@/lib/agent-types";
import { useLanguage } from "@/lib/language-context";

type View = "applications" | "inbox" | "settings";
const SETTINGS_KEY = "hua-agent-device-settings-v1";
const DEFAULT_SETTINGS: AgentDeviceSettings = { pauseAll: false, prepareAutomatically: true, notifyOnAnswers: true, notifyOnApproval: true };

const STATE_LABELS: Record<AgentState, { zh: string; en: string }> = {
  discovered: { zh: "已发现", en: "Discovered" }, preparing: { zh: "准备中", en: "Preparing" },
  awaiting_answers: { zh: "待回答", en: "Needs answers" }, awaiting_approval: { zh: "待审批", en: "Needs approval" },
  approved: { zh: "已批准", en: "Approved" }, submitting: { zh: "提交中", en: "Submitting" },
  submitted: { zh: "已提交", en: "Submitted" }, needs_attention: { zh: "需处理", en: "Needs attention" },
  rejected: { zh: "已拒绝", en: "Rejected" }, failed: { zh: "失败", en: "Failed" }, withdrawn: { zh: "已撤回", en: "Withdrawn" },
};

function safeDate(value: string, language: "zh" | "en") {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export default function AgentControlCenter() {
  const { language, text } = useLanguage();
  const [view, setView] = useState<View>("applications");
  const [applications, setApplications] = useState<AgentApplication[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveReusable, setSaveReusable] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await listAgentApplications();
      setApplications(result);
      setSelectedId((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("无法读取 Agent 申请", "Could not load Agent applications"));
    } finally { setLoading(false); }
  }, [text]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SETTINGS_KEY);
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
    } catch { /* Keep safe defaults when device storage is unavailable. */ }
  }, []);

  const selected = applications.find((item) => item.id === selectedId) ?? null;
  const inbox = useMemo(() => applications.filter((item) => ["awaiting_answers", "awaiting_approval", "needs_attention"].includes(item.state)), [applications]);

  function replace(updated: AgentApplication) {
    setApplications((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function saveAnswer(application: AgentApplication, questionKey: string, question: string) {
    const answer = drafts[questionKey]?.trim();
    if (!answer) return;
    setBusy(true); setError("");
    try { replace(await saveApplicationAnswer(application, questionKey, question, answer, Boolean(saveReusable[questionKey]))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text("保存失败", "Save failed")); }
    finally { setBusy(false); }
  }

  async function requestApproval(application: AgentApplication) {
    setBusy(true); setError("");
    try { replace(await requestApplicationApproval(application)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text("请求审批失败", "Could not request approval")); }
    finally { setBusy(false); }
  }

  async function decide(application: AgentApplication, decision: "approved" | "rejected") {
    setBusy(true); setError("");
    try {
      const decided = await decideApproval(application, decision);
      replace(decided);
      if (decision === "approved") replace(await createSubmission(decided));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : text("审批失败", "Approval failed")); }
    finally { setBusy(false); }
  }

  async function queueSubmission(application: AgentApplication) {
    setBusy(true); setError("");
    try { replace(await createSubmission(application)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text("创建排队回执失败", "Could not create queued receipt")); }
    finally { setBusy(false); }
  }

  function updateSetting(key: keyof AgentDeviceSettings, value: boolean) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  const views: Array<{ id: View; label: string; count?: number }> = [
    { id: "applications", label: text("申请", "Applications") },
    { id: "inbox", label: text("待办", "Inbox"), count: inbox.length },
    { id: "settings", label: text("Agent 设置", "Agent settings") },
  ];

  return <div data-testid="agent-control-center" className="space-y-4">
    <div className="flex gap-1 overflow-x-auto rounded-[10px] border border-[rgba(38,51,47,0.10)] bg-[#E8EFEB] p-1" role="tablist">
      {views.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} className={`min-h-11 shrink-0 rounded-[6px] px-4 text-xs ${view === item.id ? "bg-[#F8FAF8] text-[#26332F] shadow-[0_2px_8px_rgba(38,51,47,0.05)]" : "text-[#52645C]"}`}>{item.label}{item.count ? ` · ${item.count}` : ""}</button>)}
    </div>

    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-[10px] border border-[rgba(38,51,47,0.18)] bg-[#E1EAE5] p-3 text-xs"><span>{error}</span><button onClick={load} className="secondary-button min-h-9">{text("重试", "Retry")}</button></div>}
    {loading && <div className="h-52 animate-pulse rounded-[16px] bg-[rgba(38,51,47,0.05)]" />}

    {!loading && view === "settings" && <AgentSettings settings={settings} update={updateSetting} />}
    {!loading && view !== "settings" && <div className="grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.3fr)]">
      <section aria-label={text("申请列表", "Application list")} className="space-y-2">
        {(view === "inbox" ? inbox : applications).map((application) => <button key={application.id} data-testid={`application-${application.id}`} onClick={() => setSelectedId(application.id)} className={`w-full rounded-[12px] border p-4 text-left ${selectedId === application.id ? "border-[#26332F] bg-[#F8FAF8] shadow-[0_7px_22px_rgba(38,51,47,0.05)]" : "border-[rgba(38,51,47,0.10)] bg-[rgba(248,250,248,0.58)]"}`}>
          <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-sm tracking-[0.04em]">{application.job.title}</span><span className="mt-1 block truncate text-xs text-[#52645C]">{application.job.company} · {application.job.location}</span></span><span className="shrink-0 rounded-[6px] bg-[#E1EAE5] px-2 py-1 text-[10px]">{STATE_LABELS[application.state][language]}</span></span>
          <span className="mt-3 flex gap-3 text-[10px] text-[#52645C]"><span>{text("匹配", "Match")} {application.match_score}</span>{application.ats_score !== undefined && <span>ATS {application.ats_score}</span>}<span>{application.job.provider}</span></span>
        </button>)}
        {(view === "inbox" ? inbox : applications).length === 0 && <div className="rounded-[12px] border border-[rgba(38,51,47,0.10)] p-8 text-center text-sm text-[#52645C]">{text("暂无待办", "Nothing needs attention")}</div>}
      </section>
      {selected && <ApplicationDetail application={selected} drafts={drafts} setDrafts={setDrafts} saveReusable={saveReusable} setSaveReusable={setSaveReusable} busy={busy} saveAnswer={saveAnswer} requestApproval={requestApproval} decide={decide} queueSubmission={queueSubmission} />}
    </div>}
  </div>;
}

function ApplicationDetail({ application, drafts, setDrafts, saveReusable, setSaveReusable, busy, saveAnswer, requestApproval, decide, queueSubmission }: {
  application: AgentApplication; drafts: Record<string, string>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saveReusable: Record<string, boolean>; setSaveReusable: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; busy: boolean;
  saveAnswer: (application: AgentApplication, key: string, question: string) => Promise<void>; requestApproval: (application: AgentApplication) => Promise<void>; decide: (application: AgentApplication, decision: "approved" | "rejected") => Promise<void>;
  queueSubmission: (application: AgentApplication) => Promise<void>;
}) {
  const { language, text } = useLanguage();
  const unanswered = application.answers.filter((item) => item.required && !item.answer.trim());
  const finalDomain = application.job.source_url ? safeDomain(application.job.source_url) : "";
  const approvalSnapshotComplete = Boolean(application.resume_version && application.ats_score !== undefined && finalDomain);
  return <article data-testid="application-detail" className="rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8] p-4 shadow-[0_2px_8px_rgba(38,51,47,0.05)] sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow text-[#64736C]">{application.job.provider} · UTC</p><h2 className="mt-1 text-lg tracking-[0.06em]">{application.job.title}</h2><p className="mt-1 text-xs text-[#52645C]">{application.job.company} · {application.job.location}</p></div><span data-testid="application-state" className="rounded-[6px] bg-[#26332F] px-3 py-2 text-xs text-[#F8FAF8]">{STATE_LABELS[application.state][language]}</span></div>
    <div className="mt-4 grid grid-cols-3 gap-2"><Metric label={text("岗位匹配", "Job match")} value={`${application.match_score}`} /><Metric label={text("简历 ATS", "Resume ATS")} value={application.ats_score === undefined ? "—" : `${application.ats_score}`} /><Metric label={text("优化轮次", "ATS rounds")} value={`${application.ats_rounds}/2`} /></div>
    {application.material_pipeline && <section data-testid="material-pipeline-summary" className="mt-3 rounded-[10px] border border-[rgba(38,51,47,0.10)] p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span>{text("材料管线", "Material pipeline")} · {application.material_pipeline.status}</span><span className="text-[#52645C]">{application.material_pipeline.optimization.stop_reason}</span></div><p className="mt-2 text-[10px] text-[#52645C]">{text("模型调用", "Model calls")} {application.material_pipeline.usage.model_calls}/{application.material_pipeline.usage.max_model_calls} · {text("输入预算", "Input budget")} {application.material_pipeline.usage.estimated_input_tokens}/{application.material_pipeline.usage.max_input_tokens}</p>{application.material_pipeline.warnings.map((warning) => <p key={warning} className="mt-2 rounded-[6px] bg-[#E1EAE5] p-2 text-[11px] text-[#52645C]">{warning}</p>)}{application.material_pipeline.errors.map((error) => <p key={`${error.stage}:${error.message}`} className="mt-2 rounded-[6px] bg-[#E1EAE5] p-2 text-[11px] text-[#52645C]">{error.stage} · {error.message}</p>)}</section>}

    {application.state === "awaiting_answers" && <section className="mt-5 rounded-[12px] bg-[#E1EAE5] p-4"><p className="text-xs tracking-[0.08em]">{text("需要你的回答", "Your answer is needed")}</p>{application.answers.map((answer) => <div key={answer.question_key} className="mt-3"><label htmlFor={`answer-${answer.question_key}`} className="block text-xs leading-5 text-[#52645C]">{answer.question}</label><textarea id={`answer-${answer.question_key}`} data-testid="answer-input" value={drafts[answer.question_key] ?? answer.answer} onChange={(event) => setDrafts((current) => ({ ...current, [answer.question_key]: event.target.value }))} className="mt-2 min-h-24 w-full p-3 text-sm" /><label className="mt-2 flex min-h-10 items-center gap-2 text-xs text-[#52645C]"><input type="checkbox" checked={Boolean(saveReusable[answer.question_key])} onChange={(event) => setSaveReusable((current) => ({ ...current, [answer.question_key]: event.target.checked }))} />{text("同时保存到可复用答案库", "Also save to reusable answer library")}</label><button data-testid="save-answer" disabled={busy || !(drafts[answer.question_key] ?? answer.answer).trim()} onClick={() => saveAnswer(application, answer.question_key, answer.question)} className="primary-button mt-2 w-full disabled:opacity-50">{text("保存回答", "Save answer")}</button></div>)}</section>}

    {["preparing", "awaiting_answers", "needs_attention"].includes(application.state) && unanswered.length === 0 && application.ats_score !== undefined && <button data-testid="request-approval" disabled={busy} onClick={() => requestApproval(application)} className="primary-button mt-4 w-full">{text("提交内容供我审批", "Send content for my approval")}</button>}
    {application.state === "awaiting_approval" && application.latest_approval?.status === "pending" && <section className="mt-5 rounded-[12px] border border-[rgba(38,51,47,0.18)] p-4"><h3 className="text-sm tracking-[0.06em]">{text("最终提交确认", "Final submission confirmation")}</h3><p className="mt-2 text-xs leading-5 text-[#52645C]">{text("确认后将批准当前固定快照，并由 Auto-Resume 创建排队回执。修改后必须重新审批。", "Confirmation approves this exact snapshot and asks Auto-Resume to create a queued receipt. Any edit requires new approval.")}</p><dl data-testid="approval-snapshot" className="mt-4 grid gap-2 rounded-[8px] bg-[#E8EFEB] p-3 text-xs"><SnapshotRow label={text("公司和职位", "Company & role")} value={`${application.job.company} · ${application.job.title}`} /><SnapshotRow label={text("简历版本", "Resume version")} value={application.resume_version ? `v${application.resume_version}` : text("缺失", "Missing")} /><SnapshotRow label={text("ATS 分", "ATS score")} value={application.ats_score === undefined ? text("缺失", "Missing") : `${application.ats_score}`} /><SnapshotRow label={text("最终申请域名", "Final application domain")} value={finalDomain || text("缺失", "Missing")} /></dl><div className="mt-3"><p className="text-xs text-[#52645C]">{text("将要提交的回答", "Answers to be submitted")}</p>{application.answers.length ? <ul className="mt-2 space-y-2">{application.answers.map((answer) => <li key={answer.question_key} className="rounded-[8px] border border-[rgba(38,51,47,0.10)] p-3 text-xs"><span className="block text-[#52645C]">{answer.question}</span><span className="mt-1 block">{answer.answer || text("缺失", "Missing")}</span></li>)}</ul> : <p className="mt-2 text-xs">{text("此申请没有额外回答。", "No additional answers for this application.")}</p>}</div>{!approvalSnapshotComplete && <p role="alert" className="mt-3 text-xs text-[#52645C]">{text("确认已锁定：必须先提供简历版本、ATS 分和最终域名。", "Confirmation is locked until resume version, ATS score, and final domain are present.")}</p>}<div className="mt-4 grid grid-cols-2 gap-2"><button data-testid="reject-application" disabled={busy} onClick={() => decide(application, "rejected")} className="secondary-button">{text("拒绝", "Reject")}</button><button data-testid="approve-application" disabled={busy || !approvalSnapshotComplete} onClick={() => decide(application, "approved")} className="primary-button disabled:opacity-50">{busy ? text("正在记录…", "Recording…") : text("确认并排队提交", "Confirm & queue submission")}</button></div></section>}
    {application.last_error && <section data-testid="execution-blocker" className="mt-5 rounded-[12px] border border-[rgba(38,51,47,0.18)] bg-[#E1EAE5] p-4"><h3 className="text-sm tracking-[0.06em]">{text("执行已安全暂停", "Execution safely paused")}</h3><p className="mt-2 text-xs leading-5 text-[#52645C]">{application.last_error.message}</p><p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[#52645C]">{application.last_error.blocker_kind || application.last_error.code}</p></section>}
    {application.state === "approved" && <div data-testid="approval-confirmed" className="mt-5 rounded-[12px] bg-[#E1EAE5] p-4 text-xs leading-5"><p>{text("审批已记录，但排队回执尚未创建。重试会复用相同幂等键。", "Approval is recorded, but no queued receipt exists yet. Retry reuses the same idempotency key.")}</p><button disabled={busy} onClick={() => queueSubmission(application)} className="secondary-button mt-3 w-full disabled:opacity-50">{text("重试创建回执", "Retry queued receipt")}</button></div>}

    {application.latest_receipt && <section data-testid="submission-receipt" className="mt-5 rounded-[12px] border border-[rgba(38,51,47,0.12)] p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm tracking-[0.06em]">{text("提交回执", "Submission receipt")}</h3><span className="rounded-[6px] bg-[#E1EAE5] px-2 py-1 text-[10px] uppercase">{application.latest_receipt.status}</span></div><dl className="mt-3 grid gap-2 text-xs text-[#52645C]"><div className="flex justify-between gap-3"><dt>{text("渠道", "Provider")}</dt><dd>{application.latest_receipt.provider}</dd></div><div className="flex justify-between gap-3"><dt>{text("外部编号", "External ID")}</dt><dd>{application.latest_receipt.external_application_id ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt>{text("更新时间", "Updated")}</dt><dd>{safeDate(application.latest_receipt.updated_at, language)}</dd></div></dl></section>}

    <section className="mt-6"><h3 className="text-sm tracking-[0.06em]">{text("状态时间线", "Status timeline")}</h3><ol className="mt-3 space-y-0">{application.timeline.map((event, index) => <li key={event.id} className="grid grid-cols-[1rem_1fr] gap-3"><span className="relative flex justify-center"><span className="mt-2 size-1 rounded-full bg-[#839A90]" />{index < application.timeline.length - 1 && <span className="absolute bottom-0 top-3 w-px bg-[#E1EAE5]" />}</span><span className="pb-4"><span className="block text-xs">{event.title}</span>{event.detail && <span className="mt-1 block text-[11px] leading-5 text-[#52645C]">{event.detail}</span>}<time className="mt-1 block text-[10px] text-[#64736C]">{safeDate(event.created_at, language)}</time></span></li>)}</ol></section>
  </article>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-[8px] bg-[#E8EFEB] p-3 text-center"><span className="block text-lg">{value}</span><span className="mt-1 block text-[10px] text-[#52645C]">{label}</span></div>; }

function SnapshotRow({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3"><dt className="text-[#52645C]">{label}</dt><dd className="break-words text-right">{value}</dd></div>; }

function safeDomain(value: string) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.hostname : ""; } catch { return ""; } }

function AgentSettings({ settings, update }: { settings: AgentDeviceSettings; update: (key: keyof AgentDeviceSettings, value: boolean) => void }) {
  const { text } = useLanguage();
  const rows: Array<{ key: keyof AgentDeviceSettings; title: string; detail: string }> = [
    { key: "pauseAll", title: text("暂停此设备上的 Agent 操作", "Pause Agent actions on this device"), detail: text("仅为设备偏好；服务端总开关需要后续合同支持。", "Device preference only; a server-wide pause requires a future contract addition.") },
    { key: "prepareAutomatically", title: text("自动准备到提交前", "Prepare automatically until submit"), detail: text("默认开启；最终提交仍必须人工确认。", "On by default; final submission still requires human approval.") },
    { key: "notifyOnAnswers", title: text("需要回答时提醒", "Notify when answers are needed"), detail: text("不会把招聘页面文本当作系统指令。", "Recruiting-page text is never treated as system instruction.") },
    { key: "notifyOnApproval", title: text("需要审批时提醒", "Notify when approval is needed"), detail: text("CAPTCHA 与 2FA 会暂停执行，绝不绕过。", "CAPTCHA and 2FA pause execution and are never bypassed.") },
  ];
  return <section className="rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8] p-4 sm:p-6"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-[#E1EAE5]"><BirchIcon name="root" size={20} /></span><div><h2 className="text-base tracking-[0.06em]">{text("Agent 设备设置", "Agent device settings")}</h2><p className="mt-1 text-xs leading-5 text-[#52645C]">{text("这些偏好只保存在当前浏览器，不会改变 Auto-Resume 的事实状态。", "These preferences stay in this browser and never alter Auto-Resume's source-of-truth state.")}</p></div></div><div className="mt-5 divide-y divide-[rgba(38,51,47,0.10)]">{rows.map((row) => <label key={row.key} className="flex min-h-20 items-center justify-between gap-4 py-3"><span><span className="block text-sm">{row.title}</span><span className="mt-1 block text-xs leading-5 text-[#52645C]">{row.detail}</span></span><input data-testid={`setting-${row.key}`} type="checkbox" checked={settings[row.key]} onChange={(event) => update(row.key, event.target.checked)} className="size-5 shrink-0" /></label>)}</div></section>;
}
