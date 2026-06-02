export type ChatMessage = {
  id: string;
  room_id: string;
  nickname: string;
  content: string;
  type: "text" | "image" | "audio" | "video";
  file_url: string | null;
  created_at: string;
  expires_at: string;
};

export type ConnectionState =
  | "connecting"
  | "online"
  | "offline"
  | "missing-config";
