import type { BirchIconName } from "@/components/icons/BirchIcons";
import type { WorkspaceModuleId } from "@/lib/workspace-types";

export interface ModuleRoute {
  id: string;
  module: WorkspaceModuleId;
  href: string;
  icon: BirchIconName;
  label: { zh: string; en: string };
  description?: { zh: string; en: string };
  keywords?: string[];
}

export const PRIMARY_MODULES: ModuleRoute[] = [
  { id: "home", module: "home", href: "/", icon: "tree", label: { zh: "主页", en: "Home" }, description: { zh: "工作台总览与今日焦点", en: "Workspace overview and today" } },
  { id: "career", module: "career", href: "/career", icon: "branch", label: { zh: "职业", en: "Career" }, description: { zh: "职位、申请与职业材料", en: "Jobs, applications, and career materials" } },
  { id: "projects", module: "projects", href: "/projects", icon: "grove", label: { zh: "项目", en: "Projects" }, description: { zh: "项目、里程碑与下一步", en: "Projects, milestones, and next actions" } },
  { id: "tasks", module: "tasks", href: "/tasks", icon: "catkin", label: { zh: "任务", en: "Tasks" }, description: { zh: "跨模块任务与优先级", en: "Cross-workspace tasks and priorities" } },
  { id: "knowledge", module: "knowledge", href: "/knowledge", icon: "growth-ring", label: { zh: "知识", en: "Knowledge" }, description: { zh: "笔记、研究与链接", en: "Notes, research, and saved links" } },
  { id: "documents", module: "documents", href: "/documents", icon: "bark", label: { zh: "文档", en: "Documents" }, description: { zh: "生成内容与文件版本", en: "Generated content and file versions" } },
  { id: "automations", module: "automations", href: "/automations", icon: "catkin", label: { zh: "自动化", en: "Automations" }, description: { zh: "计划任务与运行日志", en: "Schedules and execution logs" } },
  { id: "integrations", module: "integrations", href: "/integrations", icon: "root", label: { zh: "集成", en: "Integrations" }, description: { zh: "外部工具与权限", en: "Connected tools and permissions" } },
];

export const CAREER_ROUTES: ModuleRoute[] = [
  { id: "career-overview", module: "career", href: "/career", icon: "grove", label: { zh: "概览", en: "Overview" } },
  { id: "career-jobs", module: "career", href: "/search", icon: "leaf", label: { zh: "职位", en: "Jobs" }, keywords: ["search", "job match"] },
  { id: "career-applications", module: "career", href: "/career/applications", icon: "bud", label: { zh: "申请", en: "Applications" } },
  { id: "career-resume", module: "career", href: "/generate", icon: "bark", label: { zh: "简历工作室", en: "Resume Studio" }, keywords: ["ATS", "cover letter", "resume"] },
  { id: "career-interview", module: "career", href: "/career/interview", icon: "bud", label: { zh: "面试准备", en: "Interview Prep" } },
  { id: "career-profile", module: "career", href: "/profile", icon: "growth-ring", label: { zh: "职业档案", en: "Career Profile" } },
];

export const SYSTEM_ROUTES: ModuleRoute[] = [
  { id: "copilot", module: "copilot", href: "/copilot", icon: "bud", label: { zh: "AI 助手", en: "AI Copilot" }, description: { zh: "跨工作区理解与行动", en: "Reason and act across the workspace" } },
  { id: "settings", module: "settings", href: "/settings", icon: "winter", label: { zh: "设置", en: "Settings" }, description: { zh: "工作区偏好与数据", en: "Workspace preferences and data" } },
];

export const ALL_ROUTES = [...PRIMARY_MODULES, ...CAREER_ROUTES, ...SYSTEM_ROUTES];

export function routeIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/career") return pathname === "/career";
  return pathname === href || pathname.startsWith(`${href}/`);
}
