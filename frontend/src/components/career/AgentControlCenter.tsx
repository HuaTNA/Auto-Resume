"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { createSubmission, decideApproval, getAgentApplication, listAgentApplications, prepareApplicationMaterials, requestApplicationApproval, saveApplicationAnswer, startApplication } from "@/lib/agent-api";
import type { AgentListView, AgentSummary } from "@/lib/agent-api";
import type { AgentApplication, AgentDeviceSettings, AgentState } from "@/lib/agent-types";
import { useLanguage } from "@/lib/language-context";

type View = AgentListView | "settings";
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}
function answerKey(application: AgentApplication, question: string) { return `${application.id}:${question}`; }

export default function AgentControlCenter() {
  const { language, text } = useLanguage();
  const [view, setView] = useState<View>("applications");
  const [applications, setApplications] = useState<AgentSummary[]>([]);
  const [counts, setCounts] = useState({ applications: 0, new_jobs: 0, inbox: 0 });
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pausedRef = useRef(false);
  const firstLoad = useRef(true);
  const initialViewResolved = useRef(false);
  const revision = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveReusable, setSaveReusable] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const reload = useCallback(() => { if (!busyRef.current) { setError(""); setRefresh((value) => value + 1); } }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
      const next = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(next) as Array<keyof AgentDeviceSettings>) if (typeof saved[key] === "boolean") next[key] = saved[key];
      pausedRef.current = next.pauseAll;
      setSettings(next);
    } catch { /* Keep defaults when storage is unavailable. */ }
  }, []);

  useEffect(() => {
    if (view === "settings" || busyRef.current) return;
    let cancelled = false;
    const stamp = revision.current;
    async function load() {
      try {
        if (firstLoad.current) {
          const linked = new URLSearchParams(window.location.search).get("agent");
          if (linked) {
            try {
              const item = await getAgentApplication(linked);
              if (cancelled) return;
              firstLoad.current = false;
              setSelectedId(item.id);
              const linkedView = item.state === "discovered" ? "new_jobs" : "applications";
              if (linkedView !== view) { setView(linkedView); return; }
            } catch (reason) { if (!cancelled) setDetailError(String(reason)); }
          }
          if (cancelled) return;
          firstLoad.current = false;
        }
        const result = await listAgentApplications(view as AgentListView, offset);
        if (cancelled || stamp !== revision.current) return;
        setApplications(result.applications); setCounts(result.counts); setTotal(result.total);
        if (offset >= result.total && offset > 0) { setOffset(Math.max(0, offset - 25)); return; }
        setSelectedId((current) => current ?? result.applications[0]?.id ?? null);
        if (!initialViewResolved.current) {
          initialViewResolved.current = true;
          if (result.total === 0 && view === "applications" && result.counts.new_jobs > 0) setView("new_jobs");
        }
      } catch (reason) { if (!cancelled && stamp === revision.current) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [view, offset, refresh]);

  useEffect(() => {
    if (busyRef.current) return;
    if (!selectedId || view === "settings") { setSelected(null); return; }
    let cancelled = false;
    const stamp = revision.current;
    setDetailLoading(true); setDetailError("");
    void getAgentApplication(selectedId).then((item) => {
      if (!cancelled && stamp === revision.current) setSelected(item);
    }).catch((reason) => {
      if (!cancelled && stamp === revision.current) { setSelected(null); setDetailError(reason instanceof Error ? reason.message : String(reason)); }
    }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, view, refresh]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && (selected?.state === "preparing" || selected?.state === "submitting" || applications.some((item) => ["preparing", "submitting"].includes(item.state)))) reload();
    }, 10_000);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [applications, selected?.state, reload]);

  function replace(updated: AgentApplication) {
    setSelected(updated);
    if ((view === "new_jobs" && updated.state !== "discovered") || (view === "inbox" && !["awaiting_answers", "awaiting_approval", "needs_attention"].includes(updated.state))) {
      setView("applications"); setOffset(0); setSelectedId(updated.id);
    }
    setApplications((items) => items.map((item) => item.id === updated.id || item.id === updated.application_id ? updated : item));
  }
  async function mutate(action: () => Promise<void>) {
    if (busyRef.current || pausedRef.current) return;
    busyRef.current = true; revision.current += 1; setBusy(true); setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; setBusy(false); setRefresh((value) => value + 1); }
  }
  async function saveAnswer(application: AgentApplication, questionKey: string, question: string) {
    const key = answerKey(application, questionKey);
    const answer = (drafts[key] ?? application.answers.find((item) => item.question_key === questionKey)?.answer ?? "").trim();
    if (!answer) return;
    await mutate(async () => {
      replace(await saveApplicationAnswer(application, questionKey, question, answer, Boolean(saveReusable[key])));
      setDrafts((current) => { const next = { ...current }; if (next[key]?.trim() === answer) delete next[key]; return next; });
    });
  }
  async function requestApproval(application: AgentApplication) { await mutate(async () => { replace(await requestApplicationApproval(application)); }); }
  async function decide(application: AgentApplication, decision: "approved" | "rejected") {
    await mutate(async () => {
      const decided = await decideApproval(application, decision); replace(decided);
      if (decision === "approved" && !pausedRef.current) replace(await createSubmission(decided));
    });
  }
  async function queueSubmission(application: AgentApplication) { await mutate(async () => { replace(await createSubmission(application)); }); }
  async function prepare(application: AgentApplication) {
    await mutate(async () => {
      let active = application;
      if (active.state === "discovered") { active = await startApplication(active); replace(active); }
      if (pausedRef.current) return;
      active = await prepareApplicationMaterials(active); replace(active);
      setView("applications"); setOffset(0); setSelectedId(active.id);
    });
  }
  function updateSetting(key: keyof AgentDeviceSettings, value: boolean) {
    const next = { ...settings, [key]: value }; pausedRef.current = next.pauseAll; setSettings(next);
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); }
    catch { setError(text("设置已生效，但浏览器无法保存；刷新后会恢复默认值。", "Setting applied, but browser storage is unavailable; it will reset on reload.")); }
  }
  function changeView(nextView: View) { if (nextView === view) return; setView(nextView); setOffset(0); setSelectedId(null); setSelected(null); setApplications([]); setLoading(true); }
  const views: Array<{ id: View; label: string; count?: number }> = [
    { id: "applications", label: text("申请", "Applications"), count: counts.applications },
    { id: "new_jobs", label: text("新岗位", "New jobs"), count: counts.new_jobs },
    { id: "inbox", label: text("待办", "Inbox"), count: counts.inbox },
    { id: "settings", label: text("Agent 设置", "Agent settings") },
  ];
  return <div data-testid="agent-control-center" className="space-y-4">
    <div className="flex gap-1 overflow-x-auto rounded-[10px] border border-[rgba(38,51,47,0.10)] bg-[#E8EFEB] p-1" role="tablist">
      {views.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} disabled={busy} onClick={() => changeView(item.id)} className={`min-h-11 shrink-0 rounded-[6px] px-4 text-xs ${view === item.id ? "bg-[#F8FAF8] text-[#26332F] shadow-[0_2px_8px_rgba(38,51,47,0.05)]" : "text-[#52645C]"}`}>{item.label}{item.count !== undefined ? ` · ${item.count}` : ""}</button>)}
    </div>
    {settings.pauseAll && <p role="status" className="text-xs text-[#52645C]">{text("本设备已暂停发起操作。已发送的请求和服务端任务仍可能继续。", "Actions from this device are paused. Sent requests and server jobs may still continue.")}</p>}
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-[10px] bg-[#E1EAE5] p-3 text-xs"><span>{error}</span><button disabled={busy} onClick={reload} className="secondary-button min-h-9">{text("刷新状态", "Refresh status")}</button></div>}
    {view === "settings" ? <AgentSettings settings={settings} update={updateSetting} /> : <>
      <button onClick={reload} disabled={busy} className="secondary-button min-h-9">{text("刷新", "Refresh")}</button>
      {loading && <div className="h-52 animate-pulse rounded-[16px] bg-[rgba(38,51,47,0.05)]" />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.3fr)]">
        <section aria-label={view === "new_jobs" ? text("新岗位列表", "New job list") : text("申请列表", "Application list")} className="space-y-2">
          {applications.map((application) => <button key={application.id} disabled={busy} data-testid={`application-${application.id}`} onClick={() => { if (selectedId !== application.id) { setSelected(null); setSelectedId(application.id); } }} className={`w-full rounded-[12px] border p-4 text-left ${selectedId === application.id ? "border-[#26332F] bg-[#F8FAF8]" : "border-[rgba(38,51,47,0.10)] bg-[rgba(248,250,248,0.58)]"}`}>
            <span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-sm">{application.job.title}</span><span className="mt-1 block truncate text-xs text-[#52645C]">{application.job.company} · {application.job.location}</span></span><span className="shrink-0 rounded-[6px] bg-[#E1EAE5] px-2 py-1 text-[10px]">{STATE_LABELS[application.state][language]}</span></span>
            <span className="mt-3 flex gap-3 text-[10px] text-[#52645C]"><span>{text("匹配", "Match")} {application.match_score}</span><span>{application.job.provider}</span></span>
          </button>)}
          {!loading && applications.length === 0 && <p className="p-8 text-center text-sm text-[#52645C]">{view === "new_jobs" ? text("Agent 新发现的岗位会保存在这里。", "New roles found by the Agent will be saved here.") : text("暂无记录", "No records")}</p>}
          {total > 25 && <div className="flex items-center justify-between gap-2"><button disabled={busy || offset === 0} onClick={() => { setOffset(offset - 25); setSelectedId(null); setSelected(null); }} className="secondary-button">{text("上一页", "Previous")}</button><span className="text-xs">{offset + 1}–{Math.min(offset + 25, total)} / {total}</span><button disabled={busy || offset + 25 >= total} onClick={() => { setOffset(offset + 25); setSelectedId(null); setSelected(null); }} className="secondary-button">{text("下一页", "Next")}</button></div>}
        </section>
        <div>{detailError && <div role="alert" className="space-y-3 p-4 text-xs"><p>{detailError}</p><button onClick={reload} className="secondary-button">{text("重试详情", "Retry details")}</button></div>}
          {detailLoading && !selected && <p role="status" className="p-4 text-xs">{text("正在加载详情…", "Loading details…")}</p>}
          {selected && <ApplicationDetail application={selected} drafts={drafts} setDrafts={setDrafts} saveReusable={saveReusable} setSaveReusable={setSaveReusable} busy={busy} blocked={settings.pauseAll || detailLoading} saveAnswer={saveAnswer} requestApproval={requestApproval} decide={decide} queueSubmission={queueSubmission} prepare={prepare} />}
        </div>
      </div>
    </>}
  </div>;
}

function ApplicationDetail({ application, drafts, setDrafts, saveReusable, setSaveReusable, busy, blocked, saveAnswer, requestApproval, decide, queueSubmission, prepare }: {
  application: AgentApplication; drafts: Record<string, string>; setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saveReusable: Record<string, boolean>; setSaveReusable: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; busy: boolean; blocked: boolean;
  saveAnswer: (application: AgentApplication, key: string, question: string) => Promise<void>; requestApproval: (application: AgentApplication) => Promise<void>; decide: (application: AgentApplication, decision: "approved" | "rejected") => Promise<void>;
  queueSubmission: (application: AgentApplication) => Promise<void>; prepare: (application: AgentApplication) => Promise<void>;
}) {
  const { language, text } = useLanguage();
  const unanswered = application.answers.filter((item) => item.required && !item.answer.trim());
  const finalDomain = application.job.source_url ? safeDomain(application.job.source_url) : "";
  const approvalSnapshotComplete = Boolean(application.resume_version && application.ats_score != null && finalDomain);
  return <article data-testid="application-detail" className="rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8] p-4 shadow-[0_2px_8px_rgba(38,51,47,0.05)] sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow text-[#64736C]">{application.job.provider} · UTC</p><h2 className="mt-1 text-lg tracking-[0.06em]">{application.job.title}</h2><p className="mt-1 text-xs text-[#52645C]">{application.job.company} · {application.job.location}</p></div><span data-testid="application-state" className="rounded-[6px] bg-[#26332F] px-3 py-2 text-xs text-[#F8FAF8]">{STATE_LABELS[application.state][language]}</span></div>
    <div className="mt-4 grid grid-cols-3 gap-2"><Metric label={text("岗位匹配", "Job match")} value={`${application.match_score}`} /><Metric label={text("简历 ATS", "Resume ATS")} value={application.ats_score == null ? "—" : `${application.ats_score}`} /><Metric label={text("优化轮次", "ATS rounds")} value={`${application.ats_rounds}/2`} /></div>
    {application.material_pipeline && <section data-testid="material-pipeline-summary" className="mt-3 rounded-[10px] border border-[rgba(38,51,47,0.10)] p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span>{text("材料管线", "Material pipeline")} · {application.material_pipeline.status}</span><span className="text-[#52645C]">{application.material_pipeline.optimization.stop_reason}</span></div><p className="mt-2 text-[10px] text-[#52645C]">{text("模型调用", "Model calls")} {application.material_pipeline.usage.model_calls}/{application.material_pipeline.usage.max_model_calls} · {text("输入预算", "Input budget")} {application.material_pipeline.usage.estimated_input_tokens}/{application.material_pipeline.usage.max_input_tokens}</p>{application.material_pipeline.warnings.map((warning) => <p key={warning} className="mt-2 rounded-[6px] bg-[#E1EAE5] p-2 text-[11px] text-[#52645C]">{warning}</p>)}{application.material_pipeline.errors.map((error) => <p key={`${error.stage}:${error.message}`} className="mt-2 rounded-[6px] bg-[#E1EAE5] p-2 text-[11px] text-[#52645C]">{error.stage} · {error.message}</p>)}</section>}

    {(application.state === "discovered" || (["preparing", "needs_attention"].includes(application.state) && !application.resume_version)) && <section className="mt-4 space-y-2"><p className="text-xs text-[#52645C]">{text("将使用 AI 配额生成并优化简历；最终提交需要你审批。", "Uses AI quota to generate and optimize your resume; final submission needs your approval.")}</p><button data-testid="prepare-materials" disabled={busy || blocked} onClick={() => prepare(application)} className="primary-button w-full disabled:opacity-50">{busy ? text("处理中…", "Working…") : text("准备申请材料", "Prepare application materials")}</button></section>}

    {application.state === "awaiting_answers" && <section className="mt-5 rounded-[12px] bg-[#E1EAE5] p-4"><p className="text-xs tracking-[0.08em]">{text("需要你的回答", "Your answer is needed")}</p>{application.answers.map((answer) => <div key={answer.question_key} className="mt-3"><label htmlFor={`answer-${answer.question_key}`} className="block text-xs leading-5 text-[#52645C]">{answer.question}</label><textarea id={`answer-${answer.question_key}`} data-testid="answer-input" value={drafts[answerKey(application, answer.question_key)] ?? answer.answer} onChange={(event) => setDrafts((current) => ({ ...current, [answerKey(application, answer.question_key)]: event.target.value }))} className="mt-2 min-h-24 w-full p-3 text-sm" /><label className="mt-2 flex min-h-10 items-center gap-2 text-xs text-[#52645C]"><input type="checkbox" checked={Boolean(saveReusable[answerKey(application, answer.question_key)])} onChange={(event) => setSaveReusable((current) => ({ ...current, [answerKey(application, answer.question_key)]: event.target.checked }))} />{text("同时保存到可复用答案库", "Also save to reusable answer library")}</label><button data-testid="save-answer" disabled={busy || blocked || !(drafts[answerKey(application, answer.question_key)] ?? answer.answer).trim()} onClick={() => saveAnswer(application, answer.question_key, answer.question)} className="primary-button mt-2 w-full disabled:opacity-50">{text("保存回答", "Save answer")}</button></div>)}</section>}

    {["preparing", "awaiting_answers", "needs_attention"].includes(application.state) && unanswered.length === 0 && application.ats_score != null && <button data-testid="request-approval" disabled={busy || blocked} onClick={() => requestApproval(application)} className="primary-button mt-4 w-full">{text("提交内容供我审批", "Send content for my approval")}</button>}
    {application.state === "awaiting_approval" && application.latest_approval?.status === "pending" && <section className="mt-5 rounded-[12px] border border-[rgba(38,51,47,0.18)] p-4"><h3 className="text-sm tracking-[0.06em]">{text("最终提交确认", "Final submission confirmation")}</h3><p className="mt-2 text-xs leading-5 text-[#52645C]">{text("确认后将批准当前固定快照，并由 Auto-Resume 创建排队回执。修改后必须重新审批。", "Confirmation approves this exact snapshot and asks Auto-Resume to create a queued receipt. Any edit requires new approval.")}</p><dl data-testid="approval-snapshot" className="mt-4 grid gap-2 rounded-[8px] bg-[#E8EFEB] p-3 text-xs"><SnapshotRow label={text("公司和职位", "Company & role")} value={`${application.job.company} · ${application.job.title}`} /><SnapshotRow label={text("简历版本", "Resume version")} value={application.resume_version ? `v${application.resume_version}` : text("缺失", "Missing")} /><SnapshotRow label={text("ATS 分", "ATS score")} value={application.ats_score == null ? text("缺失", "Missing") : `${application.ats_score}`} /><SnapshotRow label={text("最终申请域名", "Final application domain")} value={finalDomain || text("缺失", "Missing")} /></dl><div className="mt-3"><p className="text-xs text-[#52645C]">{text("将要提交的回答", "Answers to be submitted")}</p>{application.answers.length ? <ul className="mt-2 space-y-2">{application.answers.map((answer) => <li key={answer.question_key} className="rounded-[8px] border border-[rgba(38,51,47,0.10)] p-3 text-xs"><span className="block text-[#52645C]">{answer.question}</span><span className="mt-1 block">{answer.answer || text("缺失", "Missing")}</span></li>)}</ul> : <p className="mt-2 text-xs">{text("此申请没有额外回答。", "No additional answers for this application.")}</p>}</div>{!approvalSnapshotComplete && <p role="alert" className="mt-3 text-xs text-[#52645C]">{text("确认已锁定：必须先提供简历版本、ATS 分和最终域名。", "Confirmation is locked until resume version, ATS score, and final domain are present.")}</p>}<div className="mt-4 grid grid-cols-2 gap-2"><button data-testid="reject-application" disabled={busy || blocked} onClick={() => decide(application, "rejected")} className="secondary-button">{text("拒绝", "Reject")}</button><button data-testid="approve-application" disabled={busy || blocked || !approvalSnapshotComplete} onClick={() => decide(application, "approved")} className="primary-button disabled:opacity-50">{busy ? text("正在记录…", "Recording…") : text("确认并排队提交", "Confirm & queue submission")}</button></div></section>}
    {application.last_error && <section data-testid="execution-blocker" className="mt-5 rounded-[12px] border border-[rgba(38,51,47,0.18)] bg-[#E1EAE5] p-4"><h3 className="text-sm tracking-[0.06em]">{text("执行已安全暂停", "Execution safely paused")}</h3><p className="mt-2 text-xs leading-5 text-[#52645C]">{application.last_error.message}</p><p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[#52645C]">{application.last_error.blocker_kind || application.last_error.code}</p></section>}
    {application.state === "approved" && <div data-testid="approval-confirmed" className="mt-5 rounded-[12px] bg-[#E1EAE5] p-4 text-xs leading-5"><p>{text("审批已记录，但排队回执尚未创建。重试会复用相同幂等键。", "Approval is recorded, but no queued receipt exists yet. Retry reuses the same idempotency key.")}</p><button disabled={busy || blocked} onClick={() => queueSubmission(application)} className="secondary-button mt-3 w-full disabled:opacity-50">{text("重试创建回执", "Retry queued receipt")}</button></div>}

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
    { key: "pauseAll", title: text("暂停此设备上的 Agent 操作", "Pause Agent actions on this device"), detail: text("阻止本浏览器发起新的保存、生成、审批和排队操作；不会取消服务端任务。", "Blocks new saves, generation, approvals and queue requests from this browser; does not cancel server jobs.") },
    { key: "prepareAutomatically", title: text("自动准备到提交前", "Prepare automatically until submit"), detail: text("默认开启；最终提交仍必须人工确认。", "On by default; final submission still requires human approval.") },
    { key: "notifyOnAnswers", title: text("需要回答时提醒", "Notify when answers are needed"), detail: text("不会把招聘页面文本当作系统指令。", "Recruiting-page text is never treated as system instruction.") },
    { key: "notifyOnApproval", title: text("需要审批时提醒", "Notify when approval is needed"), detail: text("CAPTCHA 与 2FA 会暂停执行，绝不绕过。", "CAPTCHA and 2FA pause execution and are never bypassed.") },
  ];
  return <section className="rounded-[16px] border border-[rgba(38,51,47,0.12)] bg-[#F8FAF8] p-4 sm:p-6"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-[#E1EAE5]"><BirchIcon name="root" size={20} /></span><div><h2 className="text-base tracking-[0.06em]">{text("Agent 设备设置", "Agent device settings")}</h2><p className="mt-1 text-xs leading-5 text-[#52645C]">{text("这些偏好只保存在当前浏览器，不会改变 Auto-Resume 的事实状态。", "These preferences stay in this browser and never alter Auto-Resume's source-of-truth state.")}</p></div></div><div className="mt-5 divide-y divide-[rgba(38,51,47,0.10)]">{rows.map((row) => <label key={row.key} className="flex min-h-20 items-center justify-between gap-4 py-3"><span><span className="block text-sm">{row.title}{row.key !== "pauseAll" ? text("（暂未接入）", " (not connected yet)") : ""}</span><span className="mt-1 block text-xs leading-5 text-[#52645C]">{row.detail}</span></span><input data-testid={`setting-${row.key}`} type="checkbox" disabled={row.key !== "pauseAll"} checked={settings[row.key]} onChange={(event) => update(row.key, event.target.checked)} className="size-5 shrink-0" /></label>)}</div></section>;
}
