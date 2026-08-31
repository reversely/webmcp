import type { Delivery, Event, Venue } from "../domain/types";

/** The address the gifts ship to and the date they must arrive by, as the organizer set them; `needed_by` stays null until set. */
export function deliveryTarget(event: Pick<Event, "venue" | "delivery">): { address: Venue; needed_by: string | null; label: string } {
  const d: Delivery = event.delivery ?? { destination: "venue", address: null, needed_by: null };
  const address = d.destination === "address" && d.address ? d.address : event.venue;
  const place = (name: string, city: string) => [name, city].filter(Boolean).join(" in ");
  const label = d.destination === "address" && d.address ? place(d.address.name || d.address.line1, d.address.city) : place(event.venue.name || "the venue", event.venue.city);
  return { address, needed_by: d.needed_by, label };
}
