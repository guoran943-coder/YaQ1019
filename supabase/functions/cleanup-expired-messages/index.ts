import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET_NAME = "chat-media";
const BATCH_SIZE = 1000;

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

  const now = new Date().toISOString();

  const { data: expiredMessages, error: selectError } = await supabase
    .from("messages")
    .select("id,file_url,type")
    .lt("expires_at", now)
    .limit(BATCH_SIZE);

  if (selectError) {
    return json({ error: selectError.message }, 500);
  }

  const expiredIds = (expiredMessages ?? []).map((message) => message.id as string);
  const storagePaths = Array.from(
    new Set(
      (expiredMessages ?? [])
        .filter((message) => message.type === "image" || message.type === "audio")
        .map((message) => message.file_url as string | null)
        .filter((path): path is string => Boolean(path)),
    ),
  );

  let removedFiles = 0;

  for (let index = 0; index < storagePaths.length; index += BATCH_SIZE) {
    const batch = storagePaths.slice(index, index + BATCH_SIZE);
    const { error } = await supabase.storage.from(BUCKET_NAME).remove(batch);

    if (error) {
      return json({ error: error.message }, 500);
    }

    removedFiles += batch.length;
  }

  let deletedMessages = 0;

  if (expiredIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .in("id", expiredIds);

    if (deleteError) {
      return json({ error: deleteError.message }, 500);
    }

    deletedMessages = expiredIds.length;
  }

  return json({
    removedFiles,
    deletedMessages,
    hasMore: expiredIds.length === BATCH_SIZE,
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
