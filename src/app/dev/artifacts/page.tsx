"use client";
import { useState } from "react";
import { QuestionArtifact } from "../../projects/[id]/artifacts/question-artifact";
import { RankingArtifact } from "../../projects/[id]/artifacts/ranking-artifact";
import { SourcingArtifact } from "../../projects/[id]/artifacts/sourcing-artifact";
import type { RankingData, SourcingData } from "../../projects/[id]/artifacts/types";

/**
 * Dev preview of the chat artifacts with sample data. Titles, prices, and images come from the
 * recorded Global Catalog search in src/commerce/fixtures/global-search-three-seat-sofa.json;
 * counts, savings, and check results are invented for the preview and say so on the page.
 */
const FIXTURE = [
  { id: "gid://shopify/p/16uKDHRRNeJ1pSpDM2FWwO", title: "M1 Sofa Three Seater", price_cents: 119700, image_url: "https://cdn.shopify.com/s/files/1/0650/5850/4841/files/Helium_Cloud_14b702c4-b620-4564-bacd-59135d6266c1.webp" },
  { id: "gid://shopify/p/53csgjAZhgcda6AoYURpbU", title: "Campbell 3 Seater Sofa with Reversible Chaise in Dark Gray", price_cents: 37499, image_url: "https://cdn.shopify.com/s/files/1/0755/8073/5798/products/LVSF-01-DARKGREY_main.jpg" },
  { id: "gid://shopify/p/kezJreFoGpcA8Z9rfBBHy", title: "4-Seat Modular Sofa", price_cents: 430000, image_url: "https://cdn.shopify.com/s/files/1/0602/7195/2115/files/4-seat-modular-sofa-9417124.jpg" }
];

const sourcing: SourcingData = {
  categories: {
    sofa: { found: 8, available: 5, dimensioned: 4, compatible: 3, delivery_checked: 3, status: "selected", selected_product_id: FIXTURE[0].id },
    coffee_table: { found: 10, available: 7, dimensioned: 5, compatible: 5, delivery_checked: 0, status: "checking delivery" },
    ottoman: { found: 6, available: 4, dimensioned: 4, compatible: 0, delivery_checked: 0, status: "checking visual fit" },
    rug: { found: 11, available: 5, dimensioned: 0, compatible: 0, delivery_checked: 0, status: "checking dimensions" }
  },
  subtotal_cents: 119700,
  window: { min_cents: 200000, max_cents: 250000 }
};

const ranking: RankingData = {
  category: "sofa",
  required_savings_cents: 30000,
  ceiling_cents: 89700,
  selected_product_id: FIXTURE[1].id,
  rows: [
    { ...FIXTURE[1], product_id: FIXTURE[1].id, savings_cents: 82201, dims: "6'8\" × 3'0\" × 2'10\"", geometry: "pass", visual: "pass", delivery: "confirmed", status: "selected", rank: 1 },
    { ...FIXTURE[0], product_id: FIXTURE[0].id, savings_cents: 0, dims: "7'3\" × 3'2\" × 2'8\"", geometry: "pass", visual: "pass", delivery: "likely", status: "eliminated", reason: "No savings against the current sofa" },
    { ...FIXTURE[2], product_id: FIXTURE[2].id, savings_cents: -310300, dims: null, geometry: "pending", visual: "pending", delivery: "pending", status: "eliminated", reason: "Price is above the ceiling" }
  ]
};

const question = { run_id: "run_sample", field: "delivery_address", question: "What delivery address should I use to check arrival dates?" };

export default function ArtifactsPreview() {
  const [approved, setApproved] = useState(false);
  return (
    <div style={{ padding: 24, display: "grid", gap: 24, maxWidth: 1200 }}>
      <div>
        <h1 className="page-title">Chat artifacts</h1>
        <p className="page-summary">
          Sample data. Product titles, prices, and images are from the recorded catalog search fixture; the counts, savings, and check results are made up for this preview.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <div className="chat-log" style={{ background: "var(--paper)", borderRadius: 12, border: "1px solid var(--line)" }}>
          <div className="eyebrow">At chat width</div>
          <div className="msg user">
            <span className="who">Zach</span>
            Find me a living room that arrives by September 15.
          </div>
          <QuestionArtifact data={question} />
          <div className="msg user">
            <span className="who">Zach</span>
            10003
          </div>
          <SourcingArtifact data={sourcing} products={FIXTURE} />
          <div className="msg user">
            <span className="who">Ben</span>
            The sofa is too much. Cheaper?
          </div>
          <RankingArtifact data={ranking} title="Cheaper sofa options" onApprove={() => setApproved(true)} approving={approved} />
          {approved && <div className="msg agent">Sent &quot;approve&quot;.</div>}
        </div>
        <div style={{ display: "grid", gap: 24 }}>
          <div className="eyebrow">Ranking table at full width</div>
          <RankingArtifact data={ranking} title="Cheaper sofa options" onApprove={() => setApproved(true)} approving={approved} />
        </div>
      </div>
    </div>
  );
}
