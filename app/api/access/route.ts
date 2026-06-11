import { NextRequest } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  createAccessToken,
  getAccessPin,
  isRequestAuthorized,
  isValidAccessPin,
  jsonNoStore,
} from "@/lib/access-server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const accessPin = getAccessPin();

  if (!accessPin) {
    return jsonNoStore({ authorized: false, error: "访问密码尚未配置。" }, 503);
  }

  return jsonNoStore({ authorized: await isRequestAuthorized(request) });
}

export async function POST(request: NextRequest) {
  const accessPin = getAccessPin();

  if (!accessPin) {
    return jsonNoStore({ authorized: false, error: "访问密码尚未配置。" }, 503);
  }

  let submittedPin = "";

  try {
    const body = (await request.json()) as { pin?: unknown };
    submittedPin = typeof body.pin === "string" ? body.pin : "";
  } catch {
    return jsonNoStore({ authorized: false, error: "请求格式错误。" }, 400);
  }

  if (!(await isValidAccessPin(submittedPin, accessPin))) {
    return jsonNoStore({ authorized: false, error: "密码错误。" }, 401);
  }

  const expectedToken = await createAccessToken(accessPin);
  const response = jsonNoStore({ authorized: true });
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
