import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET_NAME = "chat-media";
const BATCH_SIZE = 100;
const MAX_BATCHES = 20;
const MAX_MESSAGE_AGE_MS = 2 * 60 * 60 * 1000;
const STORAGE_LIST_LIMIT = 1000;
const MEDIA_FOLDER_NAMES = new Set(["image", "audio", "video"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const cleanupSecret = Deno.env.get("CLEANUP_SECRET");
  const authorization = request.headers.get("authorization") ?? "";

  if (cleanupSecret && authorization !== `Bearer ${cleanupSecret}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "missing Supabase cleanup environment variables" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const cutoff = new Date(Date.now() - MAX_MESSAGE_AGE_MS).toISOString();
  const cutoffTime = new Date(cutoff).getTime();

  let removedFiles = 0;
  let removedOrphanFiles = 0;
  let deletedMessages = 0;
  let hasMore = false;
  const removedStoragePaths = new Set<string>();

  for (let batchNumber = 0; batchNumber < MAX_BATCHES; batchNumber += 1) {
    const { data: expiredMessages, error: selectError } = await supabase
      .from("messages")
      .select("id,file_url,type")
      .lt("created_at", cutoff)
      .limit(BATCH_SIZE);

    if (selectError) {
      return json(
        { stage: "selectExpiredMessages", error: serializeError(selectError) },
        500,
      );
    }

    const expiredIds = (expiredMessages ?? []).map((message) => message.id as string);

    if (expiredIds.length === 0) {
      break;
    }

    const storagePaths = Array.from(
      new Set(
        (expiredMessages ?? [])
          .filter(
            (message) =>
              message.type === "image" ||
              message.type === "audio" ||
              message.type === "video",
          )
          .map((message) => message.file_url as string | null)
          .filter((path): path is string => Boolean(path) && !path?.startsWith("kv:")),
      ),
    );

    if (storagePaths.length > 0) {
      const { error } = await supabase.storage.from(BUCKET_NAME).remove(storagePaths);

      if (error) {
        return json(
          {
            stage: "removeStorageFiles",
            paths: storagePaths,
            error: serializeError(error),
          },
          500,
        );
      }

      removedFiles += storagePaths.length;
      storagePaths.forEach((path) => removedStoragePaths.add(path));
    }

    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .in("id", expiredIds);

    if (deleteError) {
      return json({ stage: "deleteMessages", error: serializeError(deleteError) }, 500);
    }

    deletedMessages += expiredIds.length;
    hasMore = expiredIds.length === BATCH_SIZE;

    if (!hasMore) {
      break;
    }
  }

  const storageCleanupResult = await listExpiredStoragePaths(supabase, "", cutoffTime);

  if (storageCleanupResult.error) {
    return json(
      {
        stage: "listExpiredStorageFiles",
        error: serializeError(storageCleanupResult.error),
      },
      500,
    );
  }

  const orphanStoragePaths = storageCleanupResult.paths.filter(
    (path) => !removedStoragePaths.has(path),
  );

  for (let index = 0; index < orphanStoragePaths.length; index += BATCH_SIZE) {
    const paths = orphanStoragePaths.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.storage.from(BUCKET_NAME).remove(paths);

    if (error) {
      return json(
        {
          stage: "removeOrphanStorageFiles",
          paths,
          error: serializeError(error),
        },
        500,
      );
    }

    removedOrphanFiles += paths.length;
  }

  return json({
    cutoff,
    removedFiles,
    removedOrphanFiles,
    deletedMessages,
    hasMore,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function serializeError(error: unknown) {
  if (error && typeof error === "object") {
    return Object.fromEntries(
      Object.entries(error).filter(([, value]) => value !== undefined),
    );
  }

  return { message: String(error) };
}

async function listExpiredStoragePaths(
  supabase: ReturnType<typeof createClient>,
  prefix: string,
  cutoffTime: number,
) {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).list(prefix, {
      limit: STORAGE_LIST_LIMIT,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      return { paths, error };
    }

    const items = data ?? [];

    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;

      if (isStorageFolder(item)) {
        const childResult = await listExpiredStoragePaths(supabase, path, cutoffTime);

        if (childResult.error) {
          return childResult;
        }

        paths.push(...childResult.paths);
        continue;
      }

      const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;

      if (createdAt > 0 && createdAt < cutoffTime && isMediaStoragePath(path)) {
        paths.push(path);
      }
    }

    if (items.length < STORAGE_LIST_LIMIT) {
      break;
    }

    offset += STORAGE_LIST_LIMIT;
  }

  return { paths, error: null };
}

function isStorageFolder(item: { id?: string | null; metadata?: unknown }) {
  return !item.id && !item.metadata;
}

function isMediaStoragePath(path: string) {
  const [, mediaFolder] = path.split("/");
  return MEDIA_FOLDER_NAMES.has(mediaFolder);
}
