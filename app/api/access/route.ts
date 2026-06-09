import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const ACCESS_COOKIE_NAME = "chat_access";
const ACCESS_TOKEN_PREFIX = "temporary-private-chat-access-v1:";

export async function GET(request: NextRequest) {
  const accessPin = process.env.CHAT_ACCESS_PIN;

  if (!accessPin) {
    return json({ authorized: false, error: "访问密码尚未配置。" }, 503);
  }

  const expectedToken = await createAccessToken(accessPin);
  const currentToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? "";

  return json({ authorized: safeEqual(currentToken, expectedToken) });
}

export async function POST(request: NextRequest) {
  const accessPin = process.env.CHAT_ACCESS_PIN;

  if (!accessPin) {
    return json({ authorized: false, error: "访问密码尚未配置。" }, 503);
  }

  let submittedPin = "";

  try {
    const body = (await request.json()) as { pin?: unknown };
    submittedPin = typeof body.pin === "string" ? body.pin : "";
  } catch {
    return json({ authorized: false, error: "请求格式错误。" }, 400);
  }

  const expectedToken = await createAccessToken(accessPin);
  const submittedToken = await createAccessToken(submittedPin);

  if (!safeEqual(submittedToken, expectedToken)) {
    return json({ authorized: false, error: "密码错误。" }, 401);
  }

  const response = json({ authorized: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: expectedToken,
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  });

  return response;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

async function createAccessToken(pin: string) {
  const bytes = new TextEncoder().encode(`${ACCESS_TOKEN_PREFIX}${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
