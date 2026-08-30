export type RecommendationChoice = "A" | "B" | "C";
export type ApprovalDecision = "approved" | "rejected";

export interface DiscordContext {
  discordUserId: string;
  discordChannelId: string;
  discordMessageId: string;
}

export type ParsedCommand =
  | { kind: "workspace" }
  | { kind: "search"; query: string; location: string }
  | { kind: "search_status"; operationId: string }
  | { kind: "agent_status"; agentId: string }
  | { kind: "bind"; approvalId: string }
  | { kind: "latest_digest" }
  | { kind: "digest"; digestId: string }
  | { kind: "select"; digestId: string; choice: RecommendationChoice }
  | { kind: "decision"; approvalId: string; agentId: string; expectedVersion: number; decision: ApprovalDecision; note?: string }
  | { kind: "digest_status"; digestId: string }
  | { kind: "approval_status"; approvalId: string; agentId: string };

export interface RecommendationItem {
  id: string;
  position: number;
  job: { id: string; title: string; company: string; location?: string; source?: string; sourceUrl?: string };
  applicationId: string;
  agentId: string;
  agentState: string;
}

export interface RecommendationBatch {
  id: string;
  label: string;
  status: "ready" | "failed" | "expired" | string;
  items: RecommendationItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  status: "pending" | "approved" | "rejected" | "superseded" | string;
  contentDigest: string;
  version: number;
  requestedNote?: string;
  decisionNote?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentResource {
  id: string;
  applicationId: string;
  state: string;
  version: number;
  atsScore?: number;
  atsRounds?: number;
  resumeVersion?: number;
  latestApproval?: Approval;
  latestReceipt?: { id: string; status: string };
  updatedAt: string;
}

export interface TransitionResponse { agent: AgentResource }
export interface ApprovalDecisionResponse { approval: Approval; agent: AgentResource }
export interface BridgeResult { ok: true; targetType: "digest" | "approval" | "workspace" | "search" | "agent"; targetId: string; message: string }
