import WorkspaceModulePage from "@/components/WorkspaceModulePage";

export default function IntegrationsPage() {
  return (
    <WorkspaceModulePage
      eyebrow="Connected workspace"
      title="Integrations"
      subtitle="Bring external tools into Personal OS without surrendering the source of truth."
      icon="hub"
      statement="Connect the tools you use while keeping your workspace in control."
      features={[
        { icon: "description", title: "Notion", description: "Publish selected jobs and application status outward through one-way synchronization.", status: "Planned" },
        { icon: "alternate_email", title: "Email and calendar", description: "Turn messages, follow-ups, interviews, and reminders into workspace context.", status: "Planned" },
        { icon: "extension", title: "Browser capture", description: "Save visible information from the web without exposing private API or database keys.", status: "Planned" },
      ]}
      nextSteps={[
        "Create a secure per-user connection model",
        "Ship one-way Notion sync as the first integration",
        "Add email and calendar context with explicit permissions",
        "Expose a narrow authenticated API for browser capture",
      ]}
    />
  );
}
