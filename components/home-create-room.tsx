"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2, MessageCircle, Plus } from "lucide-react";
import { getAnonymousIdentity } from "@/lib/identity";
import { isSupabaseConfigured } from "@/lib/supabase";

export function HomeCreateRoom() {
  const [nickname, setNickname] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const identity = getAnonymousIdentity();
    setNickname(identity.nickname);
  }, []);

  function createRoom() {
    setIsCreating(true);
    setCopied(false);

    const roomId = createRoomId();
    setRoomLink(`${window.location.origin}/room/${roomId}`);
    setIsCreating(false);
  }

  async function copyRoomLink() {
    if (!roomLink) {
      return;
    }

    await navigator.clipboard.writeText(roomLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-4 py-6 sm:px-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal text-zinc-950 sm:text-3xl">
              一对一临时聊天
            </h1>
            <p className="mt-1 text-sm text-zinc-500">创建房间链接，发给另一个人即可文字聊天。</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          当前昵称：<span className="font-medium text-zinc-900">{nickname || "生成中"}</span>
        </div>

        {!isSupabaseConfigured ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            缺少 Supabase 环境变量，无法连接聊天服务。
          </div>
        ) : null}

        <div className="mt-6">
          <button
            type="button"
            onClick={createRoom}
            disabled={isCreating || !isSupabaseConfigured}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 sm:w-auto"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            创建临时房间
          </button>
        </div>

        {roomLink ? (
          <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-sm font-medium text-zinc-700">房间链接</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                value={roomLink}
                readOnly
                className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none"
              />
              <button
                type="button"
                onClick={copyRoomLink}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? "已复制" : "复制"}
              </button>
              <Link
                href={roomLink.replace(window.location.origin, "")}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
              >
                进入
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function createRoomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
