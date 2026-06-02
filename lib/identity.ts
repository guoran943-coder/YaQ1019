const NICKNAME_KEY = "temporary-private-chat-nickname";
const CLIENT_ID_KEY = "temporary-private-chat-client-id";

export type AnonymousIdentity = {
  nickname: string;
  clientId: string;
};

export function getAnonymousIdentity(): AnonymousIdentity {
  const storedNickname = window.localStorage.getItem(NICKNAME_KEY);
  const storedClientId = window.localStorage.getItem(CLIENT_ID_KEY);

  const nickname = storedNickname ?? generateNickname();
  const clientId = storedClientId ?? createUuid();

  window.localStorage.setItem(NICKNAME_KEY, nickname);
  window.localStorage.setItem(CLIENT_ID_KEY, clientId);

  return { nickname, clientId };
}

function generateNickname() {
  const number = Math.floor(1000 + Math.random() * 9000);
  return `匿名用户${number}`;
}

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
