import { AutoResumeApiClient } from "./client.js";
import { authorizeDiscordContext, type DiscordAllowlist } from "./identity.js";
import { commandIdempotencyKey } from "./idempotency.js";
import { choiceItem, renderApproval, renderApprovalStatus, renderBatch, renderSelection } from "./messages.js";
import type { BridgeResult, DiscordContext, ParsedCommand } from "./types.js";

export class DiscordBridge {
  constructor(private readonly client: AutoResumeApiClient, private readonly allowlist: DiscordAllowlist,
              private readonly webUrl = "https://auto-resume-two.vercel.app") {}
  async execute(command: ParsedCommand, context: DiscordContext): Promise<BridgeResult> {
    authorizeDiscordContext(context, this.allowlist);
    const scope = { ...context, idempotencyKey: commandIdempotencyKey(command, context) };
    const website = new URL("/career/applications", this.webUrl).toString();
    if (command.kind === "answer") {
      const current = await this.client.saveAnswer(command.agentId, command.questionKey, command.question, command.answer, scope);
      return { ok: true, targetType: "agent", targetId: current.id, message: `回答已保存到网站；状态：${current.state}（v${current.version}）。修改材料/回答后必须重新审批。\n<${website}?agent=${current.id}>` };
    }
    if (command.kind === "request_approval") {
      const result = await this.client.requestApproval(command.agentId, command.expectedVersion, scope);
      return { ok: true, targetType: "agent", targetId: result.agent.id, message: `已请求网站审核：${result.agent.state}（v${result.agent.version}），approval：${result.agent.latestApproval?.id ?? "无"}\n<${website}?agent=${result.agent.id}>` };
    }
    if (command.kind === "submit") {
      const current = await this.client.getAgent(command.agentId, scope);
      if (current.state !== "approved" || current.latestApproval?.status !== "approved" || current.latestApproval.id !== command.approvalId || current.version !== command.expectedVersion) throw new Error("申请或审批已变化；请重新读取并让用户确认，不能自动投递。");
      const submitted = await this.client.submit(current.id, current.provider ?? "openclaw", command.approvalId, command.expectedVersion, scope);
      return { ok: true, targetType: "agent", targetId: submitted.id, message: `申请已排队，尚未确认投递成功。回执：${submitted.latestReceipt?.id ?? "待查询"}；状态：${submitted.latestReceipt?.status ?? submitted.state}。执行器会回写结果；安全演练模式不会点击真实提交。\n<${website}?agent=${submitted.id}>` };
    }
    if (command.kind === "workspace") {
      const workspace = await this.client.getWorkspace(scope);
      const executor = workspace.executor as { connected?: boolean; dry_run?: boolean } | undefined;
      return { ok: true, targetType: "workspace", targetId: "current", message: [
        "已读取 Auto-Resume 网站账户（不是独立网页搜索）。",
        `网站已保存岗位数：${workspace.saved_job_count ?? 0}`,
        `已配置搜岗条件：${JSON.stringify(workspace.searches ?? [])}`,
        `申请状态：${JSON.stringify(workspace.applications ?? [])}`,
        `最近搜岗操作（超时后先查这里，勿重复启动）：${JSON.stringify(workspace.recent_searches ?? [])}`,
        workspace.latest_batch ? "已有推荐批次，请调用 auto_resume_get_latest_digest 获取 A/B/C。" : "网站还没有推荐批次。请根据用户搜岗条件调用 auto_resume_search_jobs；不要把 web_search 结果说成网站已保存的推荐。",
        executor?.connected ? (executor.dry_run ? "执行器在线，处于安全演练模式：不会点击真实投递。" : "执行器在线，仅处理明确批准并排队的申请。") : "执行器当前离线：排队任务不会立即执行。",
        "批准材料不等于已投递；只有网站 succeeded 回执才代表已验证的投递。",
        `<${website}>`,
      ].join("\n") };
    }
    if (command.kind === "search" || command.kind === "search_status") {
      const result = command.kind === "search"
        ? await this.client.search(command.query, command.location, scope)
        : await this.client.getSearch(command.operationId, scope);
      const operationId = String(result.operation_id);
      const batch = result.batch as { id?: string } | null;
      const run = result.run as { counts?: unknown; result?: { source_warnings?: unknown; ranking_warning?: unknown } } | null;
      const summary = [`网站搜岗：${String(result.status)}；操作 ID：${operationId}`,
        `统计：${JSON.stringify(run?.counts ?? {})}`,
        `来源提示：${JSON.stringify(run?.result?.source_warnings ?? [])}`,
        run?.result?.ranking_warning ? `排序提示：${String(run.result.ranking_warning)}` : "",
      ];
      if (batch?.id) summary.push(renderBatch(await this.client.getBatch(batch.id, scope)));
      else summary.push("本次没有生成可推荐批次；不要虚构岗位或 ATS 分数。失败或运行中请查询此操作状态，不要重复创建搜岗。");
      summary.push(`<${new URL("/automations", this.webUrl).toString()}>`);
      return { ok: true, targetType: "search", targetId: operationId, message: summary.filter(Boolean).join("\n\n") };
    }
    if (command.kind === "agent_status") {
      const current = await this.client.getAgent(command.agentId, scope);
      return { ok: true, targetType: "agent", targetId: current.id, message:
        `网站申请 ${current.id}\n状态：${current.state}（v${current.version}）\nATS：${current.atsScore == null ? "尚未生成" : `${current.atsScore}/100`}\n审批：${current.latestApproval?.id ?? "无"}（${current.latestApproval?.status ?? "未请求"}）\n回执：${current.latestReceipt?.status ?? "无（尚未投递）"}\n需处理：${current.lastError?.message ?? "无"}\n<${website}?agent=${current.id}>` };
    }
    if (command.kind === "bind") return { ok: true, targetType: "approval", targetId: command.approvalId, message: `Discord 身份和当前 User/Guild/Channel 已获授权；关联 approval \`${command.approvalId}\`` };
    if (command.kind === "latest_digest") {
      const batch = await this.client.getLatestBatch(scope);
      return { ok: true, targetType: "digest", targetId: batch.id, message: `${renderBatch(batch)}\n<${website}>` };
    }
    if (command.kind === "digest" || command.kind === "digest_status") {
      const batch = await this.client.getBatch(command.digestId, scope);
      return { ok: true, targetType: "digest", targetId: command.digestId, message: renderBatch(batch) };
    }
    if (command.kind === "select") {
      const batch = await this.client.getBatch(command.digestId, scope); const selected = choiceItem(batch, command.choice);
      let current = await this.client.getAgent(selected.agentId, scope);
      if (current.state === "discovered") {
        current = (await this.client.startAgent(selected.agentId, current.version, scope)).agent;
      }
      let response = current.state === "preparing" && current.atsScore == null
        ? await this.client.prepareMaterials(selected.agentId, scope)
        : { agent: current };
      if (response.agent.state === "preparing" && response.agent.atsScore != null) {
        response = await this.client.requestApproval(selected.agentId, response.agent.version, scope);
      }
      return { ok: true, targetType: "digest", targetId: command.digestId, message: `${renderSelection(command.choice, response)}\n打开网站核对材料和回答问题：<${website}?agent=${response.agent.id}>\n材料批准不代表已经投递。` };
    }
    if (command.kind === "decision") {
      const current = await this.client.getAgent(command.agentId, scope);
      const latest = current.latestApproval;
      if (!latest || latest.id !== command.approvalId) throw new Error("该 agent 的 latest_approval 与指定 approval ID 不一致");
      if (latest.status === command.decision) {
        return { ok: true, targetType: "approval", targetId: command.approvalId, message: renderApprovalStatus(command.approvalId, current) };
      }
      if (latest.status !== "pending" || current.version !== command.expectedVersion) throw new Error("agent/approval 已变化；请重新查询状态后再决定");
      const response = await this.client.decideApproval(command.approvalId, command.decision, command.expectedVersion, command.note, scope);
      return { ok: true, targetType: "approval", targetId: command.approvalId, message: renderApproval(response) };
    }
    const current = await this.client.getAgent(command.agentId, scope);
    return { ok: true, targetType: "approval", targetId: command.approvalId, message: renderApprovalStatus(command.approvalId, current) };
  }
}
