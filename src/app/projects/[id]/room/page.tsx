import { snapshot } from "../../../../server/state";
import { RoomConfigurator } from "./configurator";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snap = snapshot(id);
  return <RoomConfigurator projectId={id} space={snap.space} estimate={snap.room_estimate} />;
}
