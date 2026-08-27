import { beforeEach, describe, expect, it } from "vitest";
import { resetState, seedProject } from "../agent/test-helpers";
import { RequirementValueError, upsertRequirement } from "./requirements";
import { snapshot } from "./state";

const agreed = (projectId: string) => snapshot(projectId).requirements.filter((r) => r.status === "agreed");

describe("upsertRequirement (#60)", () => {
  beforeEach(resetState);

  it("appends a new item and leaves every other row agreed", () => {
    const projectId = seedProject();
    const before = agreed(projectId).map((r) => r.id);
    const { requirement, created } = upsertRequirement(projectId, { type: "required_item", value: { name: "floor lamp", kind: "lighting" }, created_by: "ben" });
    expect(created).toBe(true);
    expect(requirement).toMatchObject({ status: "agreed", source: "chat", created_by: "ben", value_json: { name: "floor lamp", kind: "lighting" } });
    expect(agreed(projectId).map((r) => r.id)).toEqual([...before, requirement.id]);
    expect(snapshot(projectId).requirements.some((r) => r.status === "superseded")).toBe(false);
  });

  it("updates the item whose name matches by key and keeps its known kind", () => {
    const projectId = seedProject();
    const count = agreed(projectId).length;
    const first = upsertRequirement(projectId, { type: "required_item", value: "Floor Lamp", created_by: "ben" });
    upsertRequirement(projectId, { type: "required_item", value: { name: "floor lamp", kind: "lighting" }, created_by: "zach" });
    const again = upsertRequirement(projectId, { type: "required_item", value: " floor lamp ", created_by: "ben" });
    expect(again.created).toBe(false);
    expect(again.requirement.id).toBe(first.requirement.id);
    expect(again.requirement.value_json).toEqual({ name: "floor lamp", kind: "lighting" });
    expect(agreed(projectId).length).toBe(count + 1);
  });

  it("keys a rule by relation, subject, and objects, and spells names as the agreed items do", () => {
    const projectId = seedProject();
    const count = agreed(projectId).length;
    const rule = upsertRequirement(projectId, { type: "layout_requirement", value: { relation: "beside", subject: "floor lamp", objects: ["Deep Couch"] }, created_by: "ben" });
    expect(rule.created).toBe(true);
    expect(rule.requirement.value_json).toEqual({ relation: "beside", subject: "floor lamp", objects: ["deep couch"] });
    const update = upsertRequirement(projectId, { type: "layout_requirement", value: { relation: "beside", subject: "Floor Lamp", objects: ["deep couch"], distance_mm: 200 }, created_by: "ben" });
    expect(update.created).toBe(false);
    expect(update.requirement.id).toBe(rule.requirement.id);
    expect(update.requirement.value_json).toMatchObject({ distance_mm: 200 });
    // The seeded under rule is a different key and stays agreed.
    expect(agreed(projectId).length).toBe(count + 1);
    expect(agreed(projectId).filter((r) => r.type === "layout_requirement")).toHaveLength(2);
  });

  it("replaces the single visual_direction row", () => {
    const projectId = seedProject();
    const count = agreed(projectId).length;
    const { requirement, created } = upsertRequirement(projectId, { type: "visual_direction", value: { base: ["#ffffff"], accent: [] }, created_by: "zach" });
    expect(created).toBe(false);
    expect(requirement.value_json).toEqual({ base: ["#ffffff"], accent: [] });
    expect(agreed(projectId).filter((r) => r.type === "visual_direction")).toHaveLength(1);
    expect(agreed(projectId).length).toBe(count);
  });

  it("rejects a value with no readable shape", () => {
    const projectId = seedProject();
    expect(() => upsertRequirement(projectId, { type: "required_item", value: "   ", created_by: "ben" })).toThrow(RequirementValueError);
    expect(() => upsertRequirement(projectId, { type: "layout_requirement", value: { relation: "near", subject: "x", objects: [] }, created_by: "ben" })).toThrow(RequirementValueError);
  });
});
