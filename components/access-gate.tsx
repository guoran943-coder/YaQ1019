"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

type AccessState = "checking" | "locked" | "authorized";

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [pin, setPin] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkAccess() {
      try {
        const response = await fetch("/api/access", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const result = (await response.json()) as { authorized?: boolean; error?: string };

        if (!active) {
          return;
        }

        if (result.authorized) {
          setAccessState("authorized");
          return;
        }

        setErrorMessage(response.status === 503 ? result.error ?? "访问密码尚未配置。" : "");
        setAccessState("locked");
      } catch {
        if (active) {
          setErrorMessage("无法连接访问验证服务，请稍后重试。");
          setAccessState("locked");
        }
      }
    }

    void checkAccess();

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!pin) {
      setErrorMessage("请输入数字密码。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ pin }),
      });
      const result = (await response.json()) as { authorized?: boolean; error?: string };

      if (!response.ok || !result.authorized) {
        setErrorMessage(result.error ?? "密码错误。");
        setPin("");
        return;
      }

      setAccessState("authorized");
    } catch {
      setErrorMessage("验证失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (accessState === "authorized") {
    return children;
  }

  if (accessState === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-zinc-100 text-zinc-500">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="正在验证访问权限" />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white px-5 py-6 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-zinc-950">请输入访问密码</h1>
            <p className="mt-1 text-sm text-zinc-500">验证通过后即可继续</p>
          </div>
        </div>

        <label htmlFor="chat-access-pin" className="sr-only">
          数字访问密码
        </label>
        <input
          id="chat-access-pin"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="current-password"
          autoFocus
          maxLength={8}
          placeholder="输入数字密码"
          disabled={isSubmitting}
          className="h-12 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-center text-lg tracking-widest text-zinc-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-zinc-100"
        />

        {errorMessage ? <p className="mt-3 text-sm text-red-600">{errorMessage}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting || pin.length !== 8}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          确认
        </button>
      </form>
    </main>
  );
}
