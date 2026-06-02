"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, SendHorizontal, Wifi, WifiOff } from "lucide-react";
import { getAnonymousIdentity } from "@/lib/identity";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { ChatMessage, ConnectionState } from "@/types/chat";

type RoomChatProps = {
  roomId: string;
};

const MAX_TEXT_LENGTH = 1000;
const RATE_LIMIT_MS = 3000;

const connectionCopy: Record<ConnectionState, string> = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接中断",
  "missing-config": "等待配置",
};

export function RoomChat({ roomId }: RoomChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [nickname, setNickname] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    isSupabaseConfigured ? "connecting" : "missing-config",
  );
  const [isLoading, setIsLoading] = useState(Boolean(isSupabaseConfigured));
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);

  const lastSentAtKey = `temporary-private-chat-last-sent-at-${roomId}`;

  useEffect(() => {
    const identity = getAnonymousIdentity();
    const lastSentAt = Number(window.localStorage.getItem(lastSentAtKey) ?? "0");
    setNickname(identity.nickname);
    setCooldownUntil(lastSentAt + RATE_LIMIT_MS);
  }, [lastSentAtKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const cooldownMs = Math.max(0, cooldownUntil - now);
  const trimmedDraft = draft.trim();
  const canSend =
    Boolean(supabase) &&
    Boolean(nickname) &&
    Boolean(trimmedDraft) &&
    trimmedDraft.length <= MAX_TEXT_LENGTH &&
    !isSending &&
    cooldownMs === 0;

  const loadMessages = useCallback(async () => {
    if (!supabase) {
      setConnectionState("missing-config");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("messages")
      .select("id,room_id,nickname,content,type,file_url,created_at,expires_at")
      .eq("room_id", roomId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMessage(`读取消息失败：${error.message}`);
      setMessages([]);
    } else {
      setMessages((data ?? []) as ChatMessage[]);
    }

    setIsLoading(false);
  }, [roomId]);

  useEffect(() => {
    const client = supabase;

    if (!client) {
      setConnectionState("missing-config");
      setIsLoading(false);
      return;
    }

    void loadMessages();

    const channel = client
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setMessages((current) => appendMessage(current, payload.new as ChatMessage));
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionState("online");
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnectionState("offline");
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadMessages, roomId]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!supabase || !nickname || !trimmedDraft) {
      return;
    }

    if (trimmedDraft.length > MAX_TEXT_LENGTH) {
      setErrorMessage(`消息最多 ${MAX_TEXT_LENGTH} 个字符。`);
      return;
    }

    const lastSentAt = Number(window.localStorage.getItem(lastSentAtKey) ?? "0");
    const nextAvailableAt = lastSentAt + RATE_LIMIT_MS;

    if (Date.now() < nextAvailableAt) {
      setCooldownUntil(nextAvailableAt);
      setErrorMessage("发送太快，请稍后再试。");
      return;
    }

    setIsSending(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_id: roomId,
        nickname,
        content: trimmedDraft,
        type: "text",
        file_url: null,
      })
      .select("id,room_id,nickname,content,type,file_url,created_at,expires_at")
      .single();

    setIsSending(false);

    if (error) {
      setErrorMessage(`发送失败：${error.message}`);
      return;
    }

    const sentAt = Date.now();
    window.localStorage.setItem(lastSentAtKey, String(sentAt));
    setCooldownUntil(sentAt + RATE_LIMIT_MS);
    setDraft("");

    if (data) {
      setMessages((current) => appendMessage(current, data as ChatMessage));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-3 py-3 sm:px-6 sm:py-5">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <header className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal text-zinc-950">
              临时聊天房间
            </h1>
            <p className="mt-1 text-sm text-zinc-500">昵称：{nickname || "生成中"}</p>
          </div>

          <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700">
            {connectionState === "online" ? (
              <Wifi className="h-4 w-4" aria-hidden="true" />
            ) : connectionState === "connecting" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <WifiOff className="h-4 w-4" aria-hidden="true" />
            )}
            {connectionCopy[connectionState]}
          </span>
        </header>

        {!isSupabaseConfigured ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            缺少 Supabase 环境变量，无法连接聊天服务。
          </div>
        ) : null}

        {errorMessage ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50 px-4 py-4">
          {isLoading ? (
            <div className="flex h-full min-h-64 items-center justify-center text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              正在载入消息
            </div>
          ) : null}

          {!isLoading && messages.length === 0 ? (
            <div className="flex h-full min-h-64 items-center justify-center">
              <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-4 text-center text-sm text-zinc-500">
                还没有消息
              </div>
            </div>
          ) : null}

          {messages.map((message) => {
            const isMine = message.nickname === nickname;

            return (
              <article key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[86%] rounded-lg border px-3 py-2 shadow-sm sm:max-w-[70%] ${
                    isMine
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-zinc-200 bg-white text-zinc-950"
                  }`}
                >
                  <div
                    className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${
                      isMine ? "text-emerald-50" : "text-zinc-500"
                    }`}
                  >
                    <span className="max-w-44 truncate font-semibold">{message.nickname}</span>
                    <span>{formatMessageTime(message.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                </div>
              </article>
            );
          })}
        </div>

        <form onSubmit={sendMessage} className="border-t border-zinc-200 bg-white p-3 sm:p-4">
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="message">
              消息内容
            </label>
            <textarea
              id="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_TEXT_LENGTH}
              rows={1}
              placeholder="输入消息"
              disabled={!supabase || isSending}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm leading-6 text-zinc-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
              title={cooldownMs > 0 ? `还需等待 ${Math.ceil(cooldownMs / 1000)} 秒` : "发送"}
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizontal className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {cooldownMs > 0 ? `${Math.ceil(cooldownMs / 1000)}秒` : "发送"}
              </span>
            </button>
          </div>
          <div className="mt-2 flex items-center justify-end text-xs text-zinc-500">
            {trimmedDraft.length}/{MAX_TEXT_LENGTH}
          </div>
        </form>
      </div>

      <Link href="/" className="mt-3 text-center text-sm font-medium text-zinc-600 hover:text-zinc-950">
        返回首页
      </Link>
    </section>
  );
}

function appendMessage(current: ChatMessage[], nextMessage: ChatMessage) {
  if (current.some((message) => message.id === nextMessage.id)) {
    return current;
  }

  return [...current, nextMessage].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
