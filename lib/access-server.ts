import { NextRequest, NextResponse } from "next/server";
import { getCloudflareEnv } from "@/lib/cloudflare";

export const ACCESS_COOKIE_NAME = "chat_access";
const ACCESS_TOKEN_PREFIX = "temporary-private-chat-access-v1:";

export function getAccessPin() {
  return getCloudflareEnv()?.CHAT_ACCESS_PIN ?? process.env.CHAT_ACCESS_PIN;
}

export async function isRequestAuthorized(request: NextRequest) {
  const accessPin = getAccessPin();

  if (!accessPin) {
    return false;
  }

  const expectedToken = await createAccessToken(accessPin);
  const currentToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? "";

  return safeEqual(currentToken, expectedToken);
}

export async function isValidAccessPin(submittedPin: string, accessPin: string) {
  const expectedToken = await createAccessToken(accessPin);
  const submittedToken = await createAccessToken(submittedPin);
  return safeEqual(submittedToken, expectedToken);
}

export async function createAccessToken(pin: string) {
  const bytes = new TextEncoder().encode(`${ACCESS_TOKEN_PREFIX}${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
