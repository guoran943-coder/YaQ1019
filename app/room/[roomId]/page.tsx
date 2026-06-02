import { RoomChat } from "@/components/room-chat";

export const runtime = "edge";

type RoomPageProps = {
  params: Promise<{
    roomId: string;
  }>;
};

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  return (
    <main className="min-h-dvh bg-zinc-100">
      <RoomChat roomId={roomId} />
    </main>
  );
}
