"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Reply,
  SendHorizontal,
  Square,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getAnonymousIdentity } from "@/lib/identity";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { ChatMessage, ConnectionState } from "@/types/chat";

type RoomChatProps = {
  roomId: string;
};

type MediaType = "image" | "audio";
type ReplyTarget = {
  id: string;
  sender: string;
  type: ChatMessage["type"];
  content: string;
};
type LoadMessagesOptions = {
  forceScrollToBottom?: boolean;
  silent?: boolean;
};

const MESSAGE_SELECT_FIELDS =
  "id,room_id,nickname,content,type,file_url,reply_to_id,reply_to_content,reply_to_type,reply_to_sender,created_at,expires_at";
const CHAT_MEDIA_BUCKET = "chat-media";
const MAX_TEXT_LENGTH = 1000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const RATE_LIMIT_MS = 3000;
const BOTTOM_FOLLOW_THRESHOLD_PX = 120;
const LONG_PRESS_MS = 550;
const HIGHLIGHT_MS = 1400;

const connectionCopy: Record<ConnectionState, string> = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接中断",
  "missing-config": "等待配置",
};

export function RoomChat({ roomId }: RoomChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nickname, setNickname] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    isSupabaseConfigured ? "connecting" : "missing-config",
  );
  const [isLoading, setIsLoading] = useState(Boolean(isSupabaseConfigured));
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const connectionStateRef = useRef<ConnectionState>(connectionState);
  const initialLoadDoneRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const pendingScrollBehaviorRef = useRef<ScrollBehavior | null>(null);
  const subscribeVersionRef = useRef(0);
  const longPressTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    return () => {
      stopRecordingStream();
      clearLongPressTimer();

      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const cooldownMs = Math.max(0, cooldownUntil - now);
  const trimmedDraft = draft.trim();
  const canSendText =
    Boolean(supabase) &&
    Boolean(nickname) &&
    Boolean(trimmedDraft) &&
    trimmedDraft.length <= MAX_TEXT_LENGTH &&
    !isSending &&
    !isRecording &&
    cooldownMs === 0;

  const canSendMedia = Boolean(supabase) && Boolean(nickname) && !isSending && cooldownMs === 0;

  const isNearBottom = useCallback(() => {
    const list = listRef.current;

    if (!list) {
      return true;
    }

    return list.scrollHeight - list.scrollTop - list.clientHeight <= BOTTOM_FOLLOW_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const list = listRef.current;

        if (!list) {
          return;
        }

        list.scrollTo({
          top: list.scrollHeight,
          behavior,
        });
      });
    });
  }, []);

  const queueScrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    pendingScrollBehaviorRef.current = behavior;
  }, []);

  const handleListScroll = useCallback(() => {
    shouldStickToBottomRef.current = isNearBottom();
  }, [isNearBottom]);

  const keepBottomIfNeeded = useCallback(() => {
    if (shouldStickToBottomRef.current || isNearBottom()) {
      scrollToBottom("auto");
    }
  }, [isNearBottom, scrollToBottom]);

  const loadSignedUrl = useCallback(async (message: ChatMessage) => {
    const client = supabase;
    const storagePath = message.file_url;

    if (!client || !storagePath || message.type === "text") {
      return;
    }

    const { data, error } = await client.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUrl(storagePath, 60 * 60);

    if (!error && data?.signedUrl) {
      setMediaUrls((current) => ({
        ...current,
        [message.id]: data.signedUrl,
      }));
    }
  }, []);

  const loadMessages = useCallback(async (options: LoadMessagesOptions = {}) => {
    if (!supabase) {
      setConnectionState("missing-config");
      setIsLoading(false);
      return;
    }

    const shouldScrollAfterLoad =
      options.forceScrollToBottom || shouldStickToBottomRef.current || isNearBottom();

    if (!options.silent) {
      setIsLoading(true);
    }

    setErrorMessage("");

    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT_FIELDS)
      .eq("room_id", roomId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMessage(`读取消息失败：${error.message}`);
    } else {
      const nextMessages = normalizeMessages((data ?? []) as ChatMessage[]);
      setMessages(nextMessages);
      nextMessages.forEach((message) => {
        void loadSignedUrl(message);
      });

      initialLoadDoneRef.current = true;

      if (options.forceScrollToBottom || shouldScrollAfterLoad) {
        queueScrollToBottom(options.forceScrollToBottom ? "auto" : "smooth");
      }
    }

    if (!options.silent) {
      setIsLoading(false);
    }
  }, [isNearBottom, loadSignedUrl, queueScrollToBottom, roomId]);

  const subscribeToRoom = useCallback(async () => {
    const client = supabase;

    if (!client) {
      setConnectionState("missing-config");
      setIsLoading(false);
      return;
    }

    const version = subscribeVersionRef.current + 1;
    subscribeVersionRef.current = version;

    if (channelRef.current) {
      const previousChannel = channelRef.current;
      channelRef.current = null;
      await client.removeChannel(previousChannel);
    }

    if (version !== subscribeVersionRef.current) {
      return;
    }

    setConnectionState("connecting");

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
          const nextMessage = payload.new as ChatMessage;
          const shouldFollow = shouldStickToBottomRef.current || isNearBottom();

          if (shouldFollow) {
            queueScrollToBottom("smooth");
          }

          setMessages((current) => appendMessage(current, nextMessage));
          void loadSignedUrl(nextMessage);
        },
      );

    channelRef.current = channel;

    channel.subscribe((status) => {
      if (channelRef.current !== channel) {
        return;
      }

      if (status === "SUBSCRIBED") {
        setConnectionState("online");
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setConnectionState("offline");
      }
    });
  }, [isNearBottom, loadSignedUrl, queueScrollToBottom, roomId]);

  useEffect(() => {
    const client = supabase;

    if (!client) {
      setConnectionState("missing-config");
      setIsLoading(false);
      return;
    }

    initialLoadDoneRef.current = false;
    shouldStickToBottomRef.current = true;
    void loadMessages({ forceScrollToBottom: true });
    void subscribeToRoom();

    return () => {
      subscribeVersionRef.current += 1;

      if (channelRef.current) {
        const currentChannel = channelRef.current;
        channelRef.current = null;
        void client.removeChannel(currentChannel);
      }
    };
  }, [loadMessages, subscribeToRoom]);

  useEffect(() => {
    const behavior = pendingScrollBehaviorRef.current;

    if (!behavior) {
      return;
    }

    pendingScrollBehaviorRef.current = null;
    scrollToBottom(behavior);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    function refreshVisibleRoom() {
      void loadMessages({
        forceScrollToBottom: !initialLoadDoneRef.current,
        silent: initialLoadDoneRef.current,
      });

      if (!channelRef.current || connectionStateRef.current !== "online") {
        void subscribeToRoom();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshVisibleRoom();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", refreshVisibleRoom);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", refreshVisibleRoom);
    };
  }, [loadMessages, subscribeToRoom]);

  async function handleTextSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await sendTextMessage(trimmedDraft);
  }

  async function sendTextMessage(content: string) {
    if (!supabase || !nickname || !content) {
      return;
    }

    if (content.length > MAX_TEXT_LENGTH) {
      setErrorMessage(`消息最多 ${MAX_TEXT_LENGTH} 个字符。`);
      return;
    }

    if (!canSendNow()) {
      return;
    }

    setIsSending(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_id: roomId,
        nickname,
        content,
        type: "text",
        file_url: null,
        ...buildReplyPayload(replyTarget),
      })
      .select(MESSAGE_SELECT_FIELDS)
      .single();

    setIsSending(false);

    if (error) {
      setErrorMessage(`发送失败：${error.message}`);
      return;
    }

    markSent();
    setDraft("");
    setReplyTarget(null);

    if (data) {
      queueScrollToBottom("smooth");
        setMessages((current) => appendMessage(current, data as ChatMessage));
      }
  }

  async function sendMediaMessage(type: MediaType, url: string) {
    if (!supabase || !nickname || !url) {
      return;
    }

    if (!canSendNow()) {
      return;
    }

    setIsSending(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_id: roomId,
        nickname,
        content: url,
        type,
        file_url: url,
        ...buildReplyPayload(replyTarget),
      })
      .select(MESSAGE_SELECT_FIELDS)
      .single();

    setIsSending(false);

    if (error) {
      setErrorMessage(`发送失败：${error.message}`);
      return;
    }

    markSent();
    setReplyTarget(null);

    if (data) {
      const nextMessage = data as ChatMessage;
      queueScrollToBottom("smooth");
      setMessages((current) => appendMessage(current, nextMessage));
      void loadSignedUrl(nextMessage);
    }
  }

  async function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setErrorMessage("只能上传图片文件。");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setErrorMessage("单个图片最大 20MB。");
      return;
    }

    if (!canSendMedia) {
      showCooldownOrBusyError();
      return;
    }

    const uploadedPath = await uploadMediaFile(file, "image");
    if (uploadedPath) {
      await sendMediaMessage("image", uploadedPath);
    }
  }

  async function startRecording() {
    if (!canSendMedia) {
      showCooldownOrBusyError();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("当前浏览器不支持录音。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (recordEvent) => {
        if (recordEvent.data.size > 0) {
          recordingChunksRef.current.push(recordEvent.data);
        }
      };

      recorder.onstop = () => {
        void handleRecordingStop(recorder.mimeType || "audio/webm");
      };

      recorder.start();
      setIsRecording(true);
      setErrorMessage("");
    } catch (error) {
      stopRecordingStream();
      setIsRecording(false);
      setErrorMessage(error instanceof Error ? `录音失败：${error.message}` : "录音失败。");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  async function handleRecordingStop(mimeType: string) {
    const chunks = recordingChunksRef.current;
    const extension = mimeType.includes("mp4") ? "m4a" : "webm";
    const file = new File(chunks, `voice-${Date.now()}.${extension}`, {
      type: mimeType,
    });

    stopRecordingStream();
    setIsRecording(false);

    if (file.size === 0) {
      setErrorMessage("没有录到声音。");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setErrorMessage("单个语音最大 20MB。");
      return;
    }

    const uploadedPath = await uploadMediaFile(file, "audio");
    if (uploadedPath) {
      await sendMediaMessage("audio", uploadedPath);
    }
  }

  function stopRecordingStream() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
  }

  async function uploadMediaFile(file: File, type: MediaType) {
    const client = supabase;

    if (!client) {
      setErrorMessage("缺少 Supabase 环境变量，无法上传。");
      return null;
    }

    setIsSending(true);
    setErrorMessage("");

    const extension = getSafeExtension(file.name, type);
    const path = `${roomId}/${type}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { error } = await client.storage.from(CHAT_MEDIA_BUCKET).upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

    setIsSending(false);

    if (error) {
      setErrorMessage(`上传失败：${error.message}`);
      return null;
    }

    return path;
  }

  function canSendNow() {
    const lastSentAt = Number(window.localStorage.getItem(lastSentAtKey) ?? "0");
    const nextAvailableAt = lastSentAt + RATE_LIMIT_MS;

    if (Date.now() < nextAvailableAt) {
      setCooldownUntil(nextAvailableAt);
      setErrorMessage("发送太快，请稍后再试。");
      return false;
    }

    return true;
  }

  function markSent() {
    const sentAt = Date.now();
    window.localStorage.setItem(lastSentAtKey, String(sentAt));
    setCooldownUntil(sentAt + RATE_LIMIT_MS);
  }

  function showCooldownOrBusyError() {
    if (cooldownMs > 0) {
      setErrorMessage("发送太快，请稍后再试。");
      return;
    }

    if (isSending) {
      setErrorMessage("正在发送上一条消息。");
      return;
    }

    setErrorMessage("当前暂时不能发送。");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendTextMessage(trimmedDraft);
    }
  }

  function handleAudioPlay(messageId: string) {
    Object.entries(audioRefs.current).forEach(([id, audio]) => {
      if (id !== messageId && audio && !audio.paused) {
        audio.pause();
      }
    });
    setActiveAudioId(messageId);
  }

  function handleAudioPause(messageId: string) {
    if (activeAudioId === messageId) {
      setActiveAudioId(null);
    }
  }

  function handleReply(message: ChatMessage) {
    setReplyTarget({
      id: message.id,
      sender: message.nickname,
      type: message.type,
      content: getReplySnapshot(message),
    });
  }

  function startLongPressReply(message: ChatMessage) {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      handleReply(message);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function jumpToQuotedMessage(messageId: string | null) {
    if (!messageId) {
      return;
    }

    const target = messageRefs.current[messageId];

    if (!target) {
      return;
    }

    target.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });

    setHighlightedMessageId(messageId);

    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }

    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, HIGHLIGHT_MS);
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

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-zinc-50 px-4 py-4"
          onScroll={handleListScroll}
        >
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
            const isHighlighted = highlightedMessageId === message.id;

            return (
              <article
                key={message.id}
                ref={(node) => {
                  messageRefs.current[message.id] = node;
                }}
                className={`flex rounded-lg transition-shadow ${
                  isMine ? "justify-end" : "justify-start"
                } ${isHighlighted ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-50" : ""}`}
                onTouchStart={() => startLongPressReply(message)}
                onTouchMove={clearLongPressTimer}
                onTouchEnd={clearLongPressTimer}
                onTouchCancel={clearLongPressTimer}
              >
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
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
                        isMine ? "hover:bg-white/15" : "hover:bg-zinc-100"
                      }`}
                      onClick={() => handleReply(message)}
                      onTouchStart={(event) => event.stopPropagation()}
                    >
                      <Reply className="h-3.5 w-3.5" aria-hidden="true" />
                      引用
                    </button>
                  </div>
                  {message.reply_to_content ? (
                    <QuotedMessageBlock
                      content={message.reply_to_content}
                      isMine={isMine}
                      sender={message.reply_to_sender}
                      type={message.reply_to_type}
                      onClick={() => jumpToQuotedMessage(message.reply_to_id)}
                    />
                  ) : null}
                  {message.type === "text" ? (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                  ) : null}
                  {message.type === "image" ? (
                    <ImageMessage
                      imageUrl={mediaUrls[message.id]}
                      isMine={isMine}
                      onLoad={keepBottomIfNeeded}
                      onOpen={(url) => setPreviewImageUrl(url)}
                    />
                  ) : null}
                  {message.type === "audio" ? (
                    <AudioMessage
                      audioUrl={mediaUrls[message.id]}
                      duration={audioDurations[message.id]}
                      isActive={activeAudioId === message.id}
                      isMine={isMine}
                      onDuration={(duration) =>
                        setAudioDurations((current) => ({
                          ...current,
                          [message.id]: duration,
                        }))
                      }
                      onLoaded={keepBottomIfNeeded}
                      onPause={() => handleAudioPause(message.id)}
                      onPlay={() => handleAudioPlay(message.id)}
                      refSetter={(node) => {
                        audioRefs.current[message.id] = node;
                      }}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <form onSubmit={handleTextSubmit} className="border-t border-zinc-200 bg-white p-3 sm:p-4">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />
          {replyTarget ? (
            <div className="mb-3 flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-600">
                  <Reply className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="truncate">{replyTarget.sender}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-zinc-500">
                    {getMessageTypeLabel(replyTarget.type)}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-zinc-700">{replyTarget.content}</p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900"
                onClick={() => setReplyTarget(null)}
                title="取消引用"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={!canSendMedia || isRecording}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
              title="发送图片"
            >
              <Paperclip className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!isRecording && !canSendMedia}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 ${
                isRecording
                  ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
              }`}
              title={isRecording ? "停止录音" : "发送语音"}
            >
              {isRecording ? (
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
              ) : (
                <Mic className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
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
              placeholder={isRecording ? "正在录音" : "输入消息"}
              disabled={!supabase || isSending || isRecording}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-sm leading-6 text-zinc-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-zinc-100"
            />
            <button
              type="submit"
              disabled={!canSendText}
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
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span>{isRecording ? "正在录音，点方块结束" : "图片和语音最大 20MB"}</span>
            <span>
              {trimmedDraft.length}/{MAX_TEXT_LENGTH}
            </span>
          </div>
        </form>
      </div>

      <Link href="/" className="mt-3 text-center text-sm font-medium text-zinc-600 hover:text-zinc-950">
        返回首页
      </Link>

      {previewImageUrl ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImageUrl(null)}
          aria-label="关闭图片预览"
        >
          <X className="absolute right-4 top-4 h-7 w-7 text-white" aria-hidden="true" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImageUrl}
            alt="聊天图片预览"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      ) : null}
    </section>
  );
}

function ImageMessage({
  imageUrl,
  isMine,
  onLoad,
  onOpen,
}: {
  imageUrl?: string;
  isMine: boolean;
  onLoad: () => void;
  onOpen: (url: string) => void;
}) {
  if (!imageUrl) {
    return <p className="text-sm opacity-80">正在加载图片</p>;
  }

  return (
    <button type="button" className="block text-left" onClick={() => onOpen(imageUrl)}>
      <span className={`mb-2 flex items-center gap-2 text-xs ${isMine ? "text-emerald-50" : "text-zinc-500"}`}>
        <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
        点击放大
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="聊天图片" className="max-h-72 rounded-md object-contain" onLoad={onLoad} />
    </button>
  );
}

function AudioMessage({
  audioUrl,
  duration,
  isActive,
  isMine,
  onDuration,
  onLoaded,
  onPause,
  onPlay,
  refSetter,
}: {
  audioUrl?: string;
  duration?: number;
  isActive: boolean;
  isMine: boolean;
  onDuration: (duration: number) => void;
  onLoaded: () => void;
  onPause: () => void;
  onPlay: () => void;
  refSetter: (node: HTMLAudioElement | null) => void;
}) {
  if (!audioUrl) {
    return <p className="text-sm opacity-80">正在加载语音</p>;
  }

  return (
    <div
      className={`min-w-56 rounded-md border p-2 transition ${
        isActive
          ? isMine
            ? "border-white bg-white/15"
            : "border-emerald-500 bg-emerald-50"
          : isMine
            ? "border-white/20 bg-white/10"
            : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <div className={`mb-2 flex items-center justify-between gap-3 text-xs ${isMine ? "text-white" : "text-zinc-600"}`}>
        <span className="inline-flex items-center gap-1.5">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          语音消息
        </span>
        <span>{formatDuration(duration)}</span>
      </div>
      <audio
        ref={refSetter}
        controls
        src={audioUrl}
        className="w-full"
        onLoadedMetadata={(event) => {
          onDuration(event.currentTarget.duration);
          onLoaded();
        }}
        onPause={onPause}
        onPlay={onPlay}
      />
    </div>
  );
}

function QuotedMessageBlock({
  content,
  isMine,
  sender,
  type,
  onClick,
}: {
  content: string;
  isMine: boolean;
  sender: string | null;
  type: ChatMessage["type"] | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mb-2 block w-full rounded-md border-l-4 px-2.5 py-2 text-left transition ${
        isMine
          ? "border-white/60 bg-white/15 hover:bg-white/20"
          : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100"
      }`}
      onClick={onClick}
    >
      <span className={`block truncate text-xs font-semibold ${isMine ? "text-emerald-50" : "text-zinc-600"}`}>
        {sender || "匿名用户"} · {getMessageTypeLabel(type)}
      </span>
      <span className={`mt-1 block truncate text-sm ${isMine ? "text-white/80" : "text-zinc-500"}`}>
        {content}
      </span>
    </button>
  );
}

function buildReplyPayload(replyTarget: ReplyTarget | null) {
  if (!replyTarget) {
    return {
      reply_to_id: null,
      reply_to_content: null,
      reply_to_type: null,
      reply_to_sender: null,
    };
  }

  return {
    reply_to_id: replyTarget.id,
    reply_to_content: replyTarget.content,
    reply_to_type: replyTarget.type,
    reply_to_sender: replyTarget.sender,
  };
}

function getReplySnapshot(message: ChatMessage) {
  if (message.type === "image") {
    return "[图片]";
  }

  if (message.type === "audio") {
    return "[语音]";
  }

  if (message.type === "video") {
    return "[视频]";
  }

  return truncateText(message.content, 50);
}

function getMessageTypeLabel(type: ChatMessage["type"] | null) {
  if (type === "image") {
    return "图片";
  }

  if (type === "audio") {
    return "语音";
  }

  if (type === "video") {
    return "视频";
  }

  return "文字";
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}...`;
}

function appendMessage(current: ChatMessage[], nextMessage: ChatMessage) {
  if (current.some((message) => message.id === nextMessage.id)) {
    return current;
  }

  return normalizeMessages([...current, nextMessage]);
}

function normalizeMessages(messages: ChatMessage[]) {
  return Array.from(new Map(messages.map((message) => [message.id, message])).values()).sort(
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

function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return "00:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSafeExtension(fileName: string, type: MediaType) {
  const extension = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (extension) {
    return extension;
  }

  return type === "image" ? "jpg" : "webm";
}
