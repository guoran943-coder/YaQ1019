import { NextRequest } from "next/server";
import { isRequestAuthorized, jsonNoStore } from "@/lib/access-server";
import { getChatMediaStore } from "@/lib/cloudflare";

export const runtime = "edge";

type MediaRouteProps = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(request: NextRequest, { params }: MediaRouteProps) {
  if (!(await isRequestAuthorized(request))) {
    return jsonNoStore({ error: "未授权访问。" }, 401);
  }

  const mediaStore = getChatMediaStore();

  if (!mediaStore) {
    return jsonNoStore({ error: "KV 媒体存储尚未配置。" }, 503);
  }

  const { path } = await params;
  const key = path.join("/");
  const object = await mediaStore.getWithMetadata<{
    cacheControl?: string;
    contentType?: string;
  }>(key, {
    type: "arrayBuffer",
  });

  if (!object.value) {
    return jsonNoStore({ error: "文件不存在或已过期。" }, 404);
  }

  return new Response(object.value, {
    headers: {
      "cache-control": object.metadata?.cacheControl ?? "private, max-age=7200",
      "content-length": String(object.value.byteLength),
      "content-type": object.metadata?.contentType ?? "application/octet-stream",
    },
  });
}
