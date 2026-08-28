import { redactForDiscord } from "./redaction.js";
import type { AgentResource, ApprovalDecisionResponse, RecommendationBatch, RecommendationChoice, RecommendationItem, TransitionResponse } from "./types.js";

const CHOICES = ["A", "B", "C"] as const;
function clean(value: string): string { return String(redactForDiscord(value)).replace(/@everyone|@here/gi, "[mention removed]").slice(0, 600); }
function safeUrl(value?: string): string | undefined { try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined; } catch { return undefined; } }

export function choiceItem(batch: RecommendationBatch, choice: RecommendationChoice): RecommendationItem {
  const selected = batch.items[CHOICES.indexOf(choice)];
  if (!selected) throw new Error(`Digest ${batch.id} 没有选项 ${choice}`);
  return selected;
}

export function renderBatch(batch: RecommendationBatch): string {
  const lines = CHOICES.map((choice, index) => {
    const entry = batch.items[index]; if (!entry) return `**${choice}**｜暂无`;
    const url = safeUrl(entry.job.sourceUrl);
    return [`**${choice}**｜${clean(entry.job.title)} · ${clean(entry.job.company)}`, entry.job.location ? `地点：${clean(entry.job.location)}` : undefined,
      `状态：${clean(entry.agentState)}`, url ? `<${url}>` : undefined].filter(Boolean).join("\n");
  });
  return [`Digest \`${batch.id}\` · ${clean(batch.status)}`, ...lines, `回复：\`选择 ${batch.id} A\`（或 B/C）`].join("\n\n").slice(0, 1950);
}

export function renderSelection(choice: RecommendationChoice, response: TransitionResponse): string {
  const score = response.agent.atsScore == null ? "待生成" : `${response.agent.atsScore}/100`;
  const version = response.agent.resumeVersion == null ? "—" : `V${response.agent.resumeVersion}`;
  const approval = response.agent.latestApproval ? `；待审批 \`${response.agent.latestApproval.id}\`（批准命令使用 agent version ${response.agent.version}）` : "";
  return `已选择 ${choice}；agent \`${response.agent.id}\` 状态：${clean(response.agent.state)}，ATS：${score}，简历：${version}，version：${response.agent.version}${approval}`;
}
export function renderApproval(response: ApprovalDecisionResponse): string {
  return `Approval \`${response.approval.id}\`：${clean(response.approval.status)}；agent 状态：${clean(response.agent.state)}；version：${response.approval.version}`;
}
export function renderApprovalStatus(approvalId: string, agent: AgentResource): string {
  const approval = agent.latestApproval;
  if (!approval || approval.id !== approvalId) throw new Error("该 agent 的 latest_approval 与指定 approval ID 不一致");
  return `Approval \`${approval.id}\`：${clean(approval.status)}；version：${approval.version}\nAgent \`${agent.id}\`：${clean(agent.state)}（v${agent.version}）\n更新时间：${clean(approval.updatedAt)}`;
}
