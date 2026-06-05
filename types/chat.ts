export type MessageType = "text" | "image" | "audio" | "video";

export type ChatMessage = {
  id: string;
  room_id: string;
  nickname: string;
  content: string;
  type: MessageType;
  file_url: string | null;
  reply_to_id: string | null;
  reply_to_content: string | null;
  reply_to_type: MessageType | null;
  reply_to_sender: string | null;
  created_at: string;
  expires_at: string;
};

export type ConnectionState =
  | "connecting"
  | "online"
  | "offline"
  | "missing-config";
