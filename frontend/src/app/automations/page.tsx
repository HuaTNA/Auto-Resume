import WorkspaceModulePage from "@/components/WorkspaceModulePage";

export default function AutomationsPage() {
  return (
    <WorkspaceModulePage
      eyebrow="Workspace operations"
      title="Automations"
      subtitle="Scheduled and repeatable work with visible control."
      icon="account_tree"
      statement="Automation belongs inside your workspace—not hidden on one laptop."
      action={{ href: "/integrations", label: "View integrations" }}
      features={[
        { icon: "work_history", title: "Career workflows", description: "The existing job search automation becomes the first managed workflow in this module.", status: "Active" },
        { icon: "schedule", title: "Schedules", description: "Run workflows on demand or on a clear schedule without depending on a local computer.", status: "Foundation" },
        { icon: "receipt_long", title: "Execution history", description: "Inspect retries, failures, processed items, duration, and AI cost for every run.", status: "Foundation" },
      ]}
      nextSteps={[
        "Move job search runs behind a shared automation contract",
        "Persist run status, counts, errors, and cost",
        "Deploy execution to Cloud Run Jobs and Scheduler",
        "Add safe retry and manual run controls",
      ]}
    />
  );
}
