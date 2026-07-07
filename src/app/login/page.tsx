"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  // 只接受站内相对路径（挡 open redirect：外域 URL 与协议相对的 "//host"），否则回落 /me
  const nextParam = params.get("next") || "";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/me";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/auth/${mode === "login" ? "login" : "signup"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password, nickname }),
      });
      // 网关 502 等非 JSON 响应时不把解析原文当错误文案：解析失败兜底为 null，统一可读文案
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok !== true) throw new Error(json?.error || "服务异常，请稍后再试");
      router.push(next);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-8">
        <h1 className="text-2xl font-semibold text-ink-950">{mode === "login" ? "登录" : "注册"}</h1>
        <p className="mt-1 text-sm text-ink-500">手机号或邮箱 · 微信登录即将上线</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-ink-800">用户名 / 手机号 / 邮箱</label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="手机号或邮箱"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none focus:border-[var(--ink3)]"
              required
            />
          </div>
          {mode === "signup" && (
            <div>
              <label className="mb-1.5 block text-sm text-ink-800">昵称（可选）</label>
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none focus:border-[var(--ink3)]" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm text-ink-800">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "至少 8 位，含字母和数字" : "输入密码"}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none focus:border-[var(--ink3)]"
              required
            />
          </div>
          {err && <p className="text-sm text-error">{err}</p>}
          <Button type="submit" full size="lg" loading={loading}>
            {mode === "login" ? "登录" : "注册并登录"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-500">
          {mode === "login" ? "还没有账号？" : "已有账号？"}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(null); }} className="ml-1 font-medium text-accent-700 hover:underline">
            {mode === "login" ? "去注册" : "去登录"}
          </button>
        </p>
      </div>
      <p className="mt-4 text-center text-xs text-ink-400">
        登录即代表同意 <Link href="/" className="underline">服务条款</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-ink-400">加载中…</div>}>
      <LoginInner />
    </Suspense>
  );
}
