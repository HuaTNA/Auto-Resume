"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AuthLayout from "@/components/AuthLayout";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { useLanguage } from "@/lib/language-context";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { text } = useLanguage();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout mode="login">
      {error && <div className="mb-5 flex items-start gap-2.5 rounded-[6px] border border-[rgba(30,26,20,0.10)] bg-[#EBE2CC] px-4 py-3 text-xs text-[#1E1A14]"><BirchIcon name="bud" size={17} />{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField label={text("电子邮箱", "Email address")} icon="mail" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <AuthField label={text("密码", "Password")} icon="lock" type="password" value={password} onChange={setPassword} placeholder={text("请输入密码", "Enter your password")} />
        <button type="submit" disabled={loading} className="primary-button mt-2 w-full disabled:translate-y-0 disabled:opacity-50">
          {loading ? text("正在登录…", "Signing in…") : text("进入工作台", "Enter workspace")}
          {!loading && <span aria-hidden="true">→</span>}
        </button>
      </form>
    </AuthLayout>
  );
}

function AuthField({ label, icon, type, value, onChange, placeholder }: { label: string; icon: "mail" | "lock"; type: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] tracking-[0.08em] text-[#9A8468]">{label}</span>
      <span className="relative block">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2"><BirchIcon name={icon === "mail" ? "leaf" : "bark"} size={17} /></span>
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required placeholder={placeholder} className="w-full rounded-[6px] border border-[rgba(30,26,20,0.10)] bg-[#EDE7D3] py-3 pl-11 pr-4 text-[13px] text-[#1E1A14] outline-none transition-colors duration-300" />
      </span>
    </label>
  );
}
