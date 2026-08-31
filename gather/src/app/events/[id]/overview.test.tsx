/** #137: the Overview Gifts section lists the snapshot's gifts and shows the empty hint only when there are none. */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetState, publishEvent } from "../../../domain/store";
import { createEventFromBody, createGiftFromBody, snapshot } from "../../../server/api";
import { Overview } from "./overview";

const BODY = {
  title: "Test event",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 1000,
  rsvp_deadline: "2030-01-03"
};

describe("the Overview Gifts section", () => {
  beforeEach(resetState);

  it("shows the empty hint when the snapshot has no gift", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const html = renderToStaticMarkup(<Overview snap={snapshot(event.id)} invite={null} onChanged={() => {}} />);
    expect(html).toContain("No gift chosen yet");
  });

  it("lists a gift row once a gift exists in the snapshot", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    createGiftFromBody(event.id, { product_id: "prod_1", product_title: "Tote bag", shop_domain: "shop.example", default_variant_id: "var_plain" });
    const html = renderToStaticMarkup(<Overview snap={snapshot(event.id)} invite={null} onChanged={() => {}} />);
    expect(html).toContain('data-testid="gift-row"');
    expect(html).toContain("Tote bag");
    expect(html).toContain("shop.example");
    expect(html).not.toContain("No gift chosen yet");
  });
});
