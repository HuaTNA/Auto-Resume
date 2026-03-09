"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
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
    if (!confirm("Import from data/profile.json? This will overwrite your current profile.")) return;
    setImporting(true);
    try {
      const result = await importProfileFromFile();
      await loadProfile();
      alert(
        `Imported ${result.imported.experiences} experiences, ${result.imported.projects} projects, ${result.imported.total_bullets} bullets.`
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
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
        <Header title="Profile" />
        <div className="p-12 text-center text-slate-500">Loading profile...</div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header title="Profile" />
        <div className="p-12 text-center">
          <p className="text-red-500 mb-2">{error}</p>
          <p className="text-sm text-slate-500">
            Make sure the API server is running and <code className="bg-slate-100 px-2 py-0.5 rounded">data/profile.json</code> exists.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Profile" />

      <div className="p-8 max-w-4xl mx-auto w-full">
        {/* Profile summary card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8 flex items-center gap-6">
          <div className="size-16 rounded-full bg-[#4051b5] flex items-center justify-center text-white text-2xl font-bold">
            {personal.name ? personal.name.charAt(0).toUpperCase() : "?"}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{personal.name || "Your Name"}</h2>
            <p className="text-sm text-slate-500">{personal.email}</p>
            <div className="flex gap-4 mt-2 text-xs text-slate-500">
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
            className="bg-amber-500 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            {importing ? "Importing..." : "Import profile.json"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-6">
          {(["personal", "skills", "experience", "projects"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
                activeTab === tab
                  ? "border-[#4051b5] text-[#4051b5]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Personal Info */}
        {activeTab === "personal" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full Name" value={personal.name} onChange={(v) => setPersonal({ ...personal, name: v })} />
              <Field label="Email" value={personal.email} onChange={(v) => setPersonal({ ...personal, email: v })} />
              <Field label="Phone" value={personal.phone} onChange={(v) => setPersonal({ ...personal, phone: v })} />
              <Field label="Location" value={personal.location} onChange={(v) => setPersonal({ ...personal, location: v })} />
              <Field label="LinkedIn URL" value={personal.linkedin} onChange={(v) => setPersonal({ ...personal, linkedin: v })} />
              <Field label="GitHub URL" value={personal.github} onChange={(v) => setPersonal({ ...personal, github: v })} />
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSavePersonal}
                disabled={saving === "personal"}
                className="bg-[#4051b5] text-white px-6 py-2 rounded-lg font-medium text-sm hover:bg-[#4051b5]/90 disabled:opacity-50 flex items-center gap-2"
              >
                {saving === "personal" ? "Saving..." : saving === "saved-personal" ? (
                  <><span className="material-symbols-outlined text-[18px]">check</span> Saved</>
                ) : "Save Personal Info"}
              </button>
            </div>
          </div>
        )}

        {/* Skills */}
        {activeTab === "skills" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            {Object.entries(skills).map(([category, items]) => (
              <div key={category} className="mb-6">
                <label className="block text-sm font-bold text-slate-700 mb-2 capitalize">
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
                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#4051b5] focus:border-transparent"
                  placeholder="Comma-separated skills"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {items.map((item) => (
                    <span key={item} className="text-xs bg-[#4051b5]/10 text-[#4051b5] px-2 py-0.5 rounded-full">
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
              className="text-sm text-[#4051b5] font-medium flex items-center gap-1 hover:underline"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add Category
            </button>

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSaveSkills}
                disabled={saving === "skills"}
                className="bg-[#4051b5] text-white px-6 py-2 rounded-lg font-medium text-sm hover:bg-[#4051b5]/90 disabled:opacity-50 flex items-center gap-2"
              >
                {saving === "skills" ? "Saving..." : saving === "saved-skills" ? (
                  <><span className="material-symbols-outlined text-[18px]">check</span> Saved</>
                ) : "Save Skills"}
              </button>
            </div>
          </div>
        )}

        {/* Experience */}
        {activeTab === "experience" && (
          <div className="space-y-4">
            {experiences.map((exp) => (
              <div key={exp.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg">{exp.role}</h3>
                    <p className="text-sm text-slate-500">
                      {exp.company} | {exp.date} | {exp.location}
                    </p>
                    {exp.stack && (
                      <p className="text-xs text-slate-400 mt-1">Stack: {exp.stack}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteExperience(exp.id)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                    title="Delete experience"
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {exp.bullets.map((bullet) => (
                    <div key={bullet.id} className="flex items-start gap-2 text-sm">
                      <span className="text-[#4051b5] mt-1">&#8226;</span>
                      <div className="flex-1">
                        <p className="text-slate-700">{bullet.text}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {bullet.tags.map((tag) => (
                            <span key={tag} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {exp.bullets.length === 0 && (
                    <p className="text-sm text-slate-400 italic">No bullets yet. Edit profile.json to add.</p>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={handleAddExperience}
              className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-[#4051b5] hover:text-[#4051b5] transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <span className="material-symbols-outlined">add_circle</span>
              Add Experience
            </button>
          </div>
        )}

        {/* Projects */}
        {activeTab === "projects" && (
          <div className="space-y-4">
            {projects.map((proj) => (
              <div key={proj.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg">{proj.name}</h3>
                    <p className="text-sm text-slate-500">
                      {proj.role} | {proj.date} | {proj.location}
                    </p>
                    {proj.stack && (
                      <p className="text-xs text-slate-400 mt-1">Stack: {proj.stack}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteProject(proj.id)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                    title="Delete project"
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {proj.bullets.map((bullet) => (
                    <div key={bullet.id} className="flex items-start gap-2 text-sm">
                      <span className="text-[#4051b5] mt-1">&#8226;</span>
                      <div className="flex-1">
                        <p className="text-slate-700">{bullet.text}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {bullet.tags.map((tag) => (
                            <span key={tag} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {proj.bullets.length === 0 && (
                    <p className="text-sm text-slate-400 italic">No bullets yet. Edit profile.json to add.</p>
                  )}
                </div>
              </div>
            ))}

            <button
              onClick={handleAddProject}
              className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-[#4051b5] hover:text-[#4051b5] transition-colors flex items-center justify-center gap-2 font-medium"
            >
              <span className="material-symbols-outlined">add_circle</span>
              Add Project
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
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#4051b5] focus:border-transparent"
      />
    </div>
  );
}
