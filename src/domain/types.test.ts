import { describe, expect, it } from "vitest";
import {
  BomItem,
  Candidate,
  Product,
  Project,
  Space,
  feetToMm,
  formatFeetInches,
  inchesToMm
} from "./types";

describe("unit conversion", () => {
  it("converts the demo room to the PRD millimetre values", () => {
    expect(feetToMm(12)).toBe(3658);
    expect(feetToMm(18)).toBe(5486);
  });

  it("round-trips inches through millimetres within one inch", () => {
    for (const inches of [1, 12, 36, 84, 120]) {
      expect(formatFeetInches(inchesToMm(inches))).toBe(`${Math.floor(inches / 12)}' ${inches % 12}"`);
    }
  });

  it("rolls 11.6 inches up to the next foot instead of printing 12 inches", () => {
    expect(formatFeetInches(feetToMm(1) - 5)).toBe(`1' 0"`);
  });
});

describe("schemas", () => {
  const project = {
    id: "p1",
    name: "Zach + Ben Living Room",
    budget_cents: 250000,
    currency: "USD",
    required_by: "2026-09-15",
    delivery_address_json: null,
    created_at: "2026-08-27T00:00:00.000Z"
  };

  it("accepts the demo project and rejects a fractional budget", () => {
    expect(Project.parse(project).budget_cents).toBe(250000);
    expect(() => Project.parse({ ...project, budget_cents: 2500.5 })).toThrow();
  });

  it("rejects a space with fractional millimetres", () => {
    const space = { id: "s1", project_id: "p1", name: "Living room", width_mm: 3657.6, length_mm: 5486, height_mm: null };
    expect(() => Space.parse(space)).toThrow();
  });

  it("requires a product to declare its spatial status", () => {
    const product = {
      id: "x1",
      merchant: "floydhome.com",
      source_url: "https://floydhome.com/products/sofa",
      external_product_id: "gid://shopify/Product/1",
      title: "The Sofa",
      description: "",
      primary_image_url: null,
      price_cents: 129500,
      currency: "USD",
      width_mm: null,
      depth_mm: null,
      height_mm: null,
      dimension_source: null,
      variant_json: null,
      availability_json: null,
      glb_url: null,
      model_status: "no_model"
    };
    expect(() => Product.parse(product)).toThrow();
    expect(Product.parse({ ...product, spatial_status: "visual_only" }).spatial_status).toBe("visual_only");
  });

  it("limits candidate category and BOM status to the PRD enumerations", () => {
    const base = { id: "c1", project_id: "p1", product_id: "x1" };
    expect(() =>
      Candidate.parse({ ...base, category: "lamp", hard_constraint_results_json: null, visual_evaluation_json: null, delivery_status: null, delivery_evidence_json: null, ranking_state: "pending", rank: null })
    ).toThrow();
    expect(() => BomItem.parse({ ...base, category: "sofa", quantity: 1, status: "draft" })).toThrow();
    expect(BomItem.parse({ ...base, category: "sofa", quantity: 1, status: "proposed" }).status).toBe("proposed");
  });
});
