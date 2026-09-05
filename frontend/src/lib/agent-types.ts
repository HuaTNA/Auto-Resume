export type AgentState =
  | "discovered" | "preparing" | "awaiting_answers" | "awaiting_approval"
  | "approved" | "submitting" | "submitted" | "needs_attention"
  | "rejected" | "failed" | "withdrawn";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "superseded";
export type ReceiptStatus = "queued" | "accepted" | "succeeded" | "failed";

export interface AgentAnswer {
  question_key: string;
  question: string;
  answer: string;
  required: boolean;
  reusable?: boolean;
}

export interface AgentApproval {
  id: string;
  status: ApprovalStatus;
  content_digest: string;
  note?: string;
  created_at: string;
  decided_at?: string;
}

export interface SubmissionReceipt {
  id: string;
  status: ReceiptStatus;
  provider: "greenhouse" | "lever" | "generic" | string;
  external_application_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentTimelineEvent {
  id: string;
  kind: "state" | "material" | "answer" | "approval" | "submission" | "safety";
  title: string;
  detail?: string;
  created_at: string;
}

export interface MaterialPipelineSummary {
  schema_version: "1.0";
  status: "completed" | "degraded" | "failed";
  optimization: { rounds: number; max_rounds: number; stop_reason: string };
  usage: { model_calls: number; max_model_calls: number; estimated_input_tokens: number; max_input_tokens: number; reserved_output_tokens: number; max_output_tokens: number };
  warnings: string[];
  errors: Array<{ stage: string; type: string; message: string; round?: number | null }>;
}

export interface AgentApplication {
  id: string;
  application_id?: string;
  version: number;
  state: AgentState;
  match_score: number;
  ats_score?: number | null;
  ats_rounds: number;
  resume_version?: number | null;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    provider: "greenhouse" | "lever" | "generic" | string;
    source_url?: string;
  };
  answers: AgentAnswer[];
  latest_approval?: AgentApproval;
  latest_receipt?: SubmissionReceipt;
  timeline: AgentTimelineEvent[];
  last_error?: { code: string; message: string; blocker_kind?: string };
  material_pipeline?: MaterialPipelineSummary;
  updated_at: string;
}

export interface AgentDeviceSettings {
  pauseAll: boolean;
  prepareAutomatically: boolean;
  notifyOnAnswers: boolean;
  notifyOnApproval: boolean;
}
