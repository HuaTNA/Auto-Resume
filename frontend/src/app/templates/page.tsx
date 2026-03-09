"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { getTemplates } from "@/lib/api";

interface Template {
  name: string;
  description: string;
  path: string;
  exists: boolean;
}

const TEMPLATE_PREVIEWS: Record<string, { color: string; icon: string; features: string[] }> = {
  classic: {
    color: "from-slate-700 to-slate-900",
    icon: "text_format",
    features: ["Clean layout", "Standard margins", "ATS-friendly", "Best for most tech roles"],
  },
  modern: {
    color: "from-blue-600 to-indigo-800",
    icon: "palette",
    features: ["Blue accent headers", "Tighter margins", "More content space", "Stands out visually"],
  },
  consulting: {
    color: "from-gray-600 to-gray-800",
    icon: "business_center",
    features: ["Conservative style", "Experience first", "Skills at bottom", "PM / Finance / Consulting"],
  },
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const data = await getTemplates();
      setTemplates(data.templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(name: string) {
    router.push(`/generate?template=${name}`);
  }

  return (
    <>
      <Header title="Resume Templates" />

      <div className="p-8 max-w-5xl mx-auto w-full">
        <p className="text-slate-600 mb-8">
          Choose a template style for your resume. Click to start generating.
        </p>

        {loading ? (
          <div className="text-center py-12 text-slate-500">Loading templates...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{error}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {templates.map((t) => {
              const preview = TEMPLATE_PREVIEWS[t.name] || TEMPLATE_PREVIEWS.classic;
              return (
                <div
                  key={t.name}
                  onClick={() => handleSelect(t.name)}
                  className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-lg hover:border-[#4051b5]/50 transition-all cursor-pointer group"
                >
                  {/* Preview header */}
                  <div
                    className={`bg-gradient-to-br ${preview.color} p-8 text-white text-center relative group-hover:opacity-90 transition-opacity`}
                  >
                    <span className="material-symbols-outlined text-5xl mb-3 block opacity-80">
                      {preview.icon}
                    </span>
                    <h3 className="text-xl font-bold capitalize">{t.name}</h3>
                    {t.name === "classic" && (
                      <span className="absolute top-3 right-3 bg-white/20 px-2 py-0.5 rounded text-xs">
                        Default
                      </span>
                    )}
                  </div>

                  {/* Details */}
                  <div className="p-6">
                    <p className="text-sm text-slate-600 mb-4">{t.description}</p>
                    <ul className="space-y-2">
                      {preview.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                          <span className="material-symbols-outlined text-green-500 text-[16px]">
                            check_circle
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>

                    <button className="mt-6 w-full bg-[#4051b5] text-white py-2.5 rounded-lg font-medium text-sm hover:bg-[#4051b5]/90 transition-colors flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                      Use This Template
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
