"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f6f8] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-[#4051b5] size-10 rounded-lg flex items-center justify-center text-white">
            <span className="material-symbols-outlined">auto_awesome</span>
          </div>
          <div>
            <h1 className="text-slate-900 text-xl font-bold leading-none">AI Resume</h1>
            <p className="text-slate-500 text-xs mt-1">Generator Pro</p>
          </div>
        </div>

        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Welcome back</h2>
        <p className="text-slate-500 text-sm mb-6">Sign in to your account</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#4051b5]/30 focus:border-[#4051b5]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#4051b5]/30 focus:border-[#4051b5]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#4051b5] text-white font-medium rounded-lg py-2.5 text-sm hover:bg-[#3344a0] transition-colors disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Don't have an account?{" "}
          <Link href="/register" className="text-[#4051b5] font-medium hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
