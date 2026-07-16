"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { useLanguage } from "@/lib/language-context";
import {
  getProfile,
  updatePersonal,
  updateSkills,
  addExperience,
  deleteExperience,
  addProject,
  deleteProject,
  importProfileFromFile,
} from "@/lib/api";

interface Bullet {
  id: string;
  text: string;
  tags: string[];
}

interface Experience {
  id: string;
  company: string;
  role: string;
  stack: string;
  date: string;
  location: string;
  bullets: Bullet[];
}

interface Project {
  id: string;
  name: string;
  role: string;
  stack: string;
  date: string;
  location: string;
  bullets: Bullet[];
}

interface Personal {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
}

interface Skills {
  [key: string]: string[];
}

export default function ProfilePage() {
  const [personal, setPersonal] = useState<Personal>({
    name: "", email: "", phone: "", location: "", linkedin: "", github: "",
  });
  const [skills, setSkills] = useState<Skills>({});
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [activeTab, setActiveTab] = useState<"personal" | "skills" | "experience" | "projects">("personal");
  const [importing, setImporting] = useState(false);
  const { text } = useLanguage();

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const data = await getProfile();
      const p = data.profile;
      setPersonal(p.personal || {});
      setSkills(p.skills || {});
      setExperiences(p.experiences || []);
      setProjects(p.projects || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  async function handleImportFile() {
    // Create a hidden file input to let the user pick a JSON file
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!confirm(`Import from "${file.name}"? This will overwrite your current profile.`)) return;
      setImporting(true);
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await importProfileFromFile(data);
        await loadProfile();
        alert(
          `Imported ${result.imported.experiences} experiences, ${result.imported.projects} projects, ${result.imported.total_bullets} bullets.`
        );
      } catch (e) {
        alert(e instanceof Error ? e.message : "Import failed");
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }

  async function handleSavePersonal() {
    setSaving("personal");
    try {
      await updatePersonal(personal);
      setSaving("saved-personal");
      setTimeout(() => setSaving(""), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
      setSaving("");
    }
  }

  async function handleSaveSkills() {
    setSaving("skills");
    try {
      await updateSkills(skills);
      setSaving("saved-skills");
      setTimeout(() => setSaving(""), 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
      setSaving("");
    }
  }

  async function handleAddExperience() {
    const newExp: Experience = {
      id: `exp_${Date.now()}`,
      company: "New Company",
      role: "Role Title",
      stack: "",
      date: "",
      location: "",
      bullets: [],
    };
    try {
      await addExperience(newExp);
      setExperiences([...experiences, newExp]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add");
    }
  }

  async function handleDeleteExperience(expId: string) {
    if (!confirm("Delete this experience?")) return;
    try {
      await deleteExperience(expId);
      setExperiences(experiences.filter((e) => e.id !== expId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function handleAddProject() {
    const newProj: Project = {
      id: `proj_${Date.now()}`,
      name: "New Project",
      role: "Developer",
      stack: "",
      date: "",
      location: "",
      bullets: [],
    };
    try {
      await addProject(newProj);
      setProjects([...projects, newProj]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add");
    }
  }

  async function handleDeleteProject(projId: string) {
    if (!confirm("Delete this project?")) return;
    try {
      await deleteProject(projId);
      setProjects(projects.filter((p) => p.id !== projId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  if (loading) {
    return (
      <>
        <Header eyebrow={{ zh: "职业档案 · 履历", en: "CAREER ARCHIVE · PROFILE" }} title={{ zh: "职业履历", en: "Career profile" }} />
        <div className="p-12 text-center text-[#9A8468]">Loading profile...</div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header eyebrow={{ zh: "职业档案 · 履历", en: "CAREER ARCHIVE · PROFILE" }} title={{ zh: "职业履历", en: "Career profile" }} />
        <div className="p-12 text-center">
          <p className="text-[#1E1A14] mb-2">{error}</p>
          <p className="text-sm text-[#9A8468]">
            Make sure the API server is running and <code className="bg-[#EBE2CC] px-2 py-0.5 rounded">data/profile.json</code> exists.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        eyebrow={{ zh: "职业档案 · 履历", en: "CAREER ARCHIVE · PROFILE" }}
        title={{ zh: "职业履历", en: "Career profile" }}
        subtitle={{ zh: "整理经历、技能与影响证据，为每次成文保留可靠原材。", en: "Gather experience, skills, and evidence for every tailored application." }}
      />

      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-10">
        {/* Profile summary card */}
        <div className="soft-card mb-8 flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:gap-6">
          <div className="size-16 rounded-[6px] bg-[#1E1A14] flex items-center justify-center text-[#F5EFE0] text-2xl font-medium">
            {personal.name ? personal.name.charAt(0).toUpperCase() : "?"}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-medium">{personal.name || text("你的姓名", "Your name")}</h2>
            <p className="text-sm text-[#9A8468]">{personal.email}</p>
            <div className="flex gap-4 mt-2 text-xs text-[#9A8468]">
              <span>{experiences.length} experience(s)</span>
              <span>{projects.length} project(s)</span>
              <span>
                {experiences.reduce((acc, e) => acc + e.bullets.length, 0) +
                  projects.reduce((acc, p) => acc + p.bullets.length, 0)}{" "}
                bullets
              </span>
            </div>
          </div>
          <button
            onClick={handleImportFile}
            disabled={importing}
            className="secondary-button whitespace-nowrap disabled:translate-y-0 disabled:opacity-50"
          >
            <BirchIcon name="bark" size={18} />
            {importing ? text("正在导入…", "Importing…") : text("导入 profile.json", "Import profile.json")}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[rgba(30,26,20,0.12)] mb-6">
          {(["personal", "skills", "experience", "projects"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b -mb-px capitalize transition-colors ${
                activeTab === tab
                  ? "border-[#B8A98A] text-[#1E1A14]"
                  : "border-transparent text-[#9A8468] hover:text-[#7A6A50]"
              }`}
            >
              {({ personal: text("个人", "Personal"), skills: text("技能", "Skills"), experience: text("经历", "Experience"), projects: text("项目", "Projects") } as const)[tab]}
            </button>
          ))}
        </div>

        {/* Personal Info */}
        {activeTab === "personal" && (
          <div className="bg-[#F5EFE0] rounded-xl border border-[rgba(30,26,20,0.12)] shadow-[0_2px_10px_rgba(30,26,20,0.07)] p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={text("姓名", "Full name")} value={personal.name} onChange={(v) => setPersonal({ ...personal, name: v })} />
              <Field label={text("邮箱", "Email")} value={personal.email} onChange={(v) => setPersonal({ ...personal, email: v })} />
              <Field label={text("电话", "Phone")} value={personal.phone} onChange={(v) => setPersonal({ ...personal, phone: v })} />
              <Field label={text("所在地", "Location")} value={personal.location} onChange={(v) => setPersonal({ ...personal, location: v })} />
              <Field label="LinkedIn URL" value={personal.linkedin} onChange={(v) => setPersonal({ ...personal, linkedin: v })} />
              <Field label="GitHub URL" value={personal.github} onChange={(v) => setPersonal({ ...personal, github: v })} />
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSavePersonal}
                disabled={saving === "personal"}
                className="bg-[#1E1A14] text-[#F5EFE0] px-6 py-2 rounded-lg font-medium text-sm hover:bg-[#1E1A14]/90 disabled:opacity-50 flex items-center gap-2"
              >
                {saving === "personal" ? "Saving..." : saving === "saved-personal" ? (
                  <>已保存 · Saved</>
                ) : text("保存个人信息", "Save personal info")}
              </button>
            </div>
          </div>
        )}

        {/* Skills */}
        {activeTab === "skills" && (
          <div className="bg-[#F5EFE0] rounded-xl border border-[rgba(30,26,20,0.12)] shadow-[0_2px_10px_rgba(30,26,20,0.07)] p-6">
            {Object.entries(skills).map(([category, items]) => (
              <div key={category} className="mb-6">
                <label className="block text-sm font-medium text-[#7A6A50] mb-2 capitalize">
                  {category.replace(/_/g, " ")}
                </label>
                <input
                  type="text"
                  value={items.join(", ")}
                  onChange={(e) =>
                    setSkills({
                      ...skills,
                      [category]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  className="w-full border border-[rgba(30,26,20,0.12)] rounded-lg px-4 py-2.5 text-sm focus:ring-0"
                  placeholder="Comma-separated skills"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {items.map((item) => (
                    <span key={item} className="text-xs bg-[#1E1A14]/10 text-[#1E1A14] px-2 py-0.5 rounded-[6px]">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {/* Add new skill category */}
            <button
              onClick={() => {
                const name = prompt("New skill category name (e.g., 'databases'):");
                if (name) setSkills({ ...skills, [name]: [] });
              }}
              className="text-sm text-[#1E1A14] font-medium flex items-center gap-1 hover:underline"
            >
              <span aria-hidden="true">＋</span>
              {text("添加分类", "Add category")}
            </button>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSaveSkills}
                disabled={saving === "skills"}
                className="bg-[#1E1A14] text-[#F5EFE0] px-6 py-2 rounded-lg font-medium text-sm hover:bg-[#1E1A14]/90 disabled:opacity-50 flex items-center gap-2"
              >
                {saving === "skills" ? "Saving..." : saving === "saved-skills" ? (
                  <>已保存 · Saved</>
                ) : text("保存技能", "Save skills")}
              </button>
            </div>
          </div>
        )}

        {/* Experience */}
        {activeTab === "experience" && (
          <div className="space-y-4">
            {experiences.map((exp) => (
              <div key={exp.id} className="bg-[#F5EFE0] rounded-xl border border-[rgba(30,26,20,0.12)] shadow-[0_2px_10px_rgba(30,26,20,0.07)] p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-medium text-lg">{exp.role}</h3>
                    <p className="text-sm text-[#9A8468]">
                      {exp.company} | {exp.date} | {exp.location}
                    </p>
                    {exp.stack && (
                      <p className="text-xs text-[#9A8468] mt-1">Stack: {exp.stack}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteExperience(exp.id)}
                    className="text-[#9A8468] hover:text-[#1E1A14] transition-colors"
                    title="Delete experience"
                  >
                    <span aria-hidden="true">删</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {exp.bullets.map((bullet) => (
                    <div key={bullet.id} className="flex items-start gap-2 text-sm">
                      <span className="text-[#1E1A14] mt-1">&#8226;</span>
                      <div className="flex-1">
                        <p className="text-[#7A6A50]">{bullet.text}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {bullet.tags.map((tag) => (
                            <span key={tag} className="text-[10px] bg-[#EBE2CC] text-[#9A8468] px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {exp.bullets.length === 0 && (
                    <p className="text-sm text-[#9A8468] italic">No bullets yet. Edit profile.json to add.</p>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={handleAddExperience}
              className="w-full py-4 border border-[rgba(30,26,20,0.12)] rounded-xl text-[#9A8468] hover:bg-[#FDFAF3] hover:text-[#1E1A14] transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <span aria-hidden="true">＋</span>
              {text("添加经历", "Add experience")}
            </button>
          </div>
        )}

        {/* Projects */}
        {activeTab === "projects" && (
          <div className="space-y-4">
            {projects.map((proj) => (
              <div key={proj.id} className="bg-[#F5EFE0] rounded-xl border border-[rgba(30,26,20,0.12)] shadow-[0_2px_10px_rgba(30,26,20,0.07)] p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-medium text-lg">{proj.name}</h3>
                    <p className="text-sm text-[#9A8468]">
                      {proj.role} | {proj.date} | {proj.location}
                    </p>
                    {proj.stack && (
                      <p className="text-xs text-[#9A8468] mt-1">Stack: {proj.stack}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteProject(proj.id)}
                    className="text-[#9A8468] hover:text-[#1E1A14] transition-colors"
                    title="Delete project"
                  >
                    <span aria-hidden="true">删</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {proj.bullets.map((bullet) => (
                    <div key={bullet.id} className="flex items-start gap-2 text-sm">
                      <span className="text-[#1E1A14] mt-1">&#8226;</span>
                      <div className="flex-1">
                        <p className="text-[#7A6A50]">{bullet.text}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {bullet.tags.map((tag) => (
                            <span key={tag} className="text-[10px] bg-[#EBE2CC] text-[#9A8468] px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {proj.bullets.length === 0 && (
                    <p className="text-sm text-[#9A8468] italic">No bullets yet. Edit profile.json to add.</p>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={handleAddProject}
              className="w-full py-4 border border-[rgba(30,26,20,0.12)] rounded-xl text-[#9A8468] hover:bg-[#FDFAF3] hover:text-[#1E1A14] transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <span aria-hidden="true">＋</span>
              {text("添加项目", "Add project")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#7A6A50] mb-1">{label}</label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[rgba(30,26,20,0.12)] rounded-lg px-4 py-2.5 text-sm focus:ring-0"
      />
    </div>
  );
}
