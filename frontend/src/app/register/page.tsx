"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import AuthLayout from "@/components/AuthLayout";
import { BirchIcon } from "@/components/icons/BirchIcons";
import { useLanguage } from "@/lib/language-context";
import { getRegistrationConfig } from "@/lib/auth-api";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [registrationMode, setRegistrationMode] = useState<"open" | "invite" | "closed">("open");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { text } = useLanguage();

  useEffect(() => {
    getRegistrationConfig().then((config) => setRegistrationMode(config.mode)).catch(() => undefined);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setLoading(true);
    try {
      await register(email, password, inviteCode);
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout mode="register">
      <p className="mb-5 text-center text-xs leading-6 text-[#7A6A50]">{text("从一份真实履历开始，慢慢长成你的职业知识系统。", "Begin with an honest profile and let it grow into your career knowledge system.")}</p>
      {error && <div className="mb-5 flex items-start gap-2.5 rounded-[6px] border border-[rgba(30,26,20,0.10)] bg-[#EBE2CC] px-4 py-3 text-xs text-[#1E1A14]"><BirchIcon name="bud" size={17} />{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        {registrationMode === "closed" && <p className="rounded-[6px] bg-[#EBE2CC] px-4 py-3 text-xs">{text("目前暂停开放注册。", "Registration is currently closed.")}</p>}
        <RegisterField label={text("电子邮箱", "Email address")} icon="mail" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <RegisterField label={text("密码", "Password")} icon="lock" type="password" value={password} onChange={setPassword} placeholder={text("至少 8 个字符", "At least 8 characters")} />
        <RegisterField label={text("确认密码", "Confirm password")} icon="lock" type="password" value={confirm} onChange={setConfirm} placeholder={text("再次输入密码", "Repeat your password")} />
        {registrationMode === "invite" && <RegisterField label={text("邀请码", "Invitation code")} icon="lock" type="password" value={inviteCode} onChange={setInviteCode} placeholder={text("输入邀请码", "Enter invitation code")} />}
        <button type="submit" disabled={loading || registrationMode === "closed"} className="primary-button mt-2 w-full disabled:translate-y-0 disabled:opacity-50">
          {loading ? text("正在创建…", "Creating…") : text("创建我的桦", "Create my workspace")}
          {!loading && <span aria-hidden="true">→</span>}
        </button>
      </form>
    </AuthLayout>
  );
}

function RegisterField({ label, icon, type, value, onChange, placeholder }: { label: string; icon: "mail" | "lock"; type: string; value: string; onChange: (value: string) => void; placeholder: string }) {
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
