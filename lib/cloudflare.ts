export type KvNamespaceBinding = {
  get(
    key: string,
    options: {
      cacheTtl?: number;
      type: "arrayBuffer";
    },
  ): Promise<ArrayBuffer | null>;
  getWithMetadata<Metadata>(
    key: string,
    options: {
      type: "arrayBuffer";
    },
  ): Promise<{
    metadata: Metadata | null;
    value: ArrayBuffer | null;
  }>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      expirationTtl?: number;
      metadata?: Record<string, string>;
    },
  ): Promise<void>;
};

type CloudflareEnv = {
  CHAT_ACCESS_PIN?: string;
  CHAT_MEDIA?: KvNamespaceBinding;
};

export function getCloudflareEnv() {
  const contextSymbol = Symbol.for("__cloudflare-request-context__");
  const context = (
    globalThis as unknown as Record<
      symbol,
      {
        env?: CloudflareEnv;
      }
    >
  )[contextSymbol];

  return context?.env;
}

export function getChatMediaStore() {
  return getCloudflareEnv()?.CHAT_MEDIA ?? null;
}
