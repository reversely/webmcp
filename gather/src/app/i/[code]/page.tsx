import { notFound } from "next/navigation";
import { inviteView } from "../../../server/api";
import { InviteForm } from "./invite-form";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ guest?: string }> };

/** The invite (PRD Section 6): the event, the response options, and the questions; the same link edits or cancels. */
export default async function Page({ params, searchParams }: Props) {
  const { code } = await params;
  const { guest } = await searchParams;
  let invite;
  try {
    invite = inviteView(code);
  } catch {
    notFound();
  }
  return <InviteForm invite={invite} guestId={guest ?? null} />;
}
