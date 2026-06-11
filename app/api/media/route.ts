import { NextRequest } from "next/server";
import { isRequestAuthorized, jsonNoStore } from "@/lib/access-server";
import { getChatMediaStore } from "@/lib/cloudflare";

export const runtime = "edge";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MEDIA_TTL_SECONDS = 2 * 60 * 60;

export async function POST(request: NextRequest) {
  if (!(await isRequestAuthorized(request))) {
    return jsonNoStore({ error: "未授权访问。" }, 401);
  }

  const mediaStore = getChatMediaStore();

  if (!mediaStore) {
    return jsonNoStore({ error: "KV 媒体存储尚未配置。" }, 503);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const roomId = formData.get("roomId");
  const type = formData.get("type");

  if (!(file instanceof File) || typeof roomId !== "string" || (type !== "image" && type !== "audio")) {
    return jsonNoStore({ error: "上传请求格式错误。" }, 400);
  }

  if (!/^[a-zA-Z0-9-]{1,100}$/.test(roomId)) {
    return jsonNoStore({ error: "房间编号无效。" }, 400);
  }

  if (type === "image" && (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES)) {
    return jsonNoStore({ error: "图片格式无效或超过 2MB。" }, 400);
  }

  if (type === "audio" && (!file.type.startsWith("audio/") || file.size > MAX_AUDIO_BYTES)) {
    return jsonNoStore({ error: "语音格式无效或超过 5MB。" }, 400);
  }

  const extension = getSafeExtension(file.name, type);
  const key = `${roomId}/${type}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  await mediaStore.put(key, await file.arrayBuffer(), {
    expirationTtl: MEDIA_TTL_SECONDS,
    metadata: {
      cacheControl: "private, max-age=7200",
      contentType: file.type,
      mediaType: type,
    },
  });

  return jsonNoStore({ path: `kv:${key}` });
}

function getSafeExtension(fileName: string, type: "image" | "audio") {
  const extension = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return extension || (type === "image" ? "webp" : "webm");
}
