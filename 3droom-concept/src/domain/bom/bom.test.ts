import { describe, expect, it } from "vitest";
import { calculateBudget } from "./budget";
import { PRICES, PROJECT_ID, candidate, demoStore, itemFor, placement, rows } from "./fixture";
import { renameItem, renameItemInRule, setItemKind } from "./identity";
import { addToBom, approveBomItem, removeFromBom } from "./items";
import { regenerateBom } from "./regenerate";
import { VersionMismatchError, replaceBomItem } from "./replace";

const SOURCED_TOTAL = PRICES.sofa + PRICES.coffee_table + PRICES.ottoman + PRICES.rug;

describe("calculateBudget", () => {
  it("reports under for the four sourced demo items", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    expect(calculateBudget(store, PROJECT_ID)).toEqual({
      committed_cents: SOURCED_TOTAL,
      budget_cents: 250000,
      state: "under",
      overage_cents: 0
    });
  });

  it("reports exact when committed equals the budget", () => {
    const { store } = demoStore(SOURCED_TOTAL);
    regenerateBom(store, PROJECT_ID);
    expect(calculateBudget(store, PROJECT_ID)).toMatchObject({ state: "exact", overage_cents: 0 });
  });

  it("reports the side-table overage", () => {
    const { store } = demoStore();
    store.candidates.set("c_side", candidate("c_side", "side_table", "side_table"));
    regenerateBom(store, PROJECT_ID);
    expect(calculateBudget(store, PROJECT_ID)).toMatchObject({
      state: "over",
      overage_cents: SOURCED_TOTAL + PRICES.side_table - 250000
    });
  });

  it("multiplies by quantity and skips removed items", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const ottoman = itemFor(store, "ottoman");
    store.bomItems.set(ottoman.id, { ...ottoman, quantity: 2 });
    removeFromBom(store, itemFor(store, "rug").id);
    expect(calculateBudget(store, PROJECT_ID).committed_cents).toBe(
      PRICES.sofa + PRICES.coffee_table + 2 * PRICES.ottoman
    );
  });
});

describe("regenerateBom", () => {
  it("inserts a proposed item per selected candidate and none for other states", () => {
    const { store, events } = demoStore();
    store.candidates.set("c_ranked", candidate("c_ranked", "side_table", "side_table", "ranked"));
    const result = regenerateBom(store, PROJECT_ID);
    expect(result.inserted_item_ids).toHaveLength(4);
    expect(rows(store).bomItems.every((item) => item.status === "proposed")).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["BOM_REGENERATED"]);
  });

  it("is idempotent", () => {
    const { store, events } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const before = rows(store);
    const second = regenerateBom(store, PROJECT_ID);
    expect(second.inserted_item_ids).toEqual([]);
    expect(rows(store)).toEqual(before);
    expect(events.filter((event) => event.type === "BOM_REGENERATED")).toHaveLength(2);
  });

  it("never removes an item, even when its candidate is gone or eliminated", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    store.candidates.delete("c_rug");
    store.candidates.set("c_sofa", { ...store.candidates.get("c_sofa")!, ranking_state: "eliminated" });
    regenerateBom(store, PROJECT_ID);
    expect(rows(store).bomItems).toHaveLength(4);
    expect(itemFor(store, "rug").status).toBe("proposed");
  });

  it("emits BUDGET_VIOLATED with the overage when over", () => {
    const { store, events } = demoStore();
    store.candidates.set("c_side", candidate("c_side", "side_table", "side_table"));
    regenerateBom(store, PROJECT_ID);
    expect(events.at(-1)).toMatchObject({
      type: "BUDGET_VIOLATED",
      budget: { state: "over", overage_cents: SOURCED_TOTAL + PRICES.side_table - 250000 }
    });
  });
});

describe("addToBom, removeFromBom, approveBomItem", () => {
  it("leaves a proposed or approved item alone and inserts nothing", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const sofa = itemFor(store, "sofa");
    const before = rows(store);
    expect(addToBom(store, sofa.id)).toBe(false);
    approveBomItem(store, sofa.id);
    expect(addToBom(store, sofa.id)).toBe(false);
    expect(rows(store).bomItems).toHaveLength(before.bomItems.length);
    expect(itemFor(store, "sofa").status).toBe("approved");
  });

  it("restores a removed item to proposed and recalculates", () => {
    const { store, events } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const rug = itemFor(store, "rug");
    removeFromBom(store, rug.id);
    expect(itemFor(store, "rug").status).toBe("removed");
    expect(calculateBudget(store, PROJECT_ID).committed_cents).toBe(SOURCED_TOTAL - PRICES.rug);
    expect(addToBom(store, rug.id)).toBe(true);
    expect(itemFor(store, "rug").status).toBe("proposed");
    expect(events.at(-1)).toMatchObject({ type: "BOM_REGENERATED", budget: { committed_cents: SOURCED_TOTAL } });
  });

  it("bumps the project version once per changing operation", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    expect(store.getProject(PROJECT_ID).version).toBe(1);
    const sofa = itemFor(store, "sofa");
    approveBomItem(store, sofa.id);
    expect(store.getProject(PROJECT_ID).version).toBe(2);
    approveBomItem(store, sofa.id);
    expect(store.getProject(PROJECT_ID).version).toBe(2);
  });
});

describe("replaceBomItem", () => {
  function overBudgetStore() {
    const fixture = demoStore();
    const { store } = fixture;
    store.candidates.set("c_side", candidate("c_side", "side_table", "side_table"));
    regenerateBom(store, PROJECT_ID);
    const table = itemFor(store, "coffee_table");
    store.placements.set("pl_table", placement("pl_table", table.id));
    store.placements.set("pl_sofa", placement("pl_sofa", itemFor(store, "sofa").id));
    return { ...fixture, table };
  }

  it("swaps the item, moves its placement, appends a decision, and bumps the version", () => {
    const { store, events, table } = overBudgetStore();
    events.length = 0;
    const version = store.getProject(PROJECT_ID).version;
    const result = replaceBomItem(store, {
      projectId: PROJECT_ID,
      expectedVersion: version,
      oldItemId: table.id,
      newProductId: "cheaper_table",
      actor: "zach",
      now: () => "2026-08-27T10:00:00.000Z"
    });

    const newItem = store.getBomItem(result.new_item_id);
    expect(newItem).toMatchObject({ product_id: "cheaper_table", category: "coffee_table", kind: "table", status: "proposed" });
    expect(store.getBomItem(table.id).status).toBe("removed");
    expect(store.placements.get("pl_table")?.bom_item_id).toBe(newItem.id);
    expect(store.placements.get("pl_sofa")?.bom_item_id).toBe(itemFor(store, "sofa").id);
    expect(store.decisions.get(result.decision_id)).toMatchObject({
      actor: "zach",
      type: "product_replaced",
      payload_json: { old_item_id: table.id, new_item_id: newItem.id, new_product_id: "cheaper_table" },
      created_at: "2026-08-27T10:00:00.000Z"
    });
    expect(store.getProject(PROJECT_ID).version).toBe(version + 1);
    expect(result.version).toBe(version + 1);
    expect(events.map((event) => event.type)).toEqual(["BOM_REGENERATED", "PRODUCT_REPLACED"]);
    expect(rows(store).candidates.find((row) => row.product_id === "cheaper_table")).toMatchObject({
      category: "coffee_table",
      ranking_state: "selected"
    });
  });

  it("brings the demo budget back under 250000", () => {
    const { store, table } = overBudgetStore();
    expect(calculateBudget(store, PROJECT_ID).state).toBe("over");
    const result = replaceBomItem(store, {
      projectId: PROJECT_ID,
      expectedVersion: store.getProject(PROJECT_ID).version,
      oldItemId: table.id,
      newProductId: "cheaper_table",
      actor: "zach"
    });
    expect(result.budget.committed_cents).toBeLessThanOrEqual(250000);
    expect(result.budget).toEqual(calculateBudget(store, PROJECT_ID));
    expect(result.budget.state).toBe("under");
  });

  it("throws on a version mismatch and leaves the store and event stream unchanged", () => {
    const { store, events, table } = overBudgetStore();
    const before = rows(store);
    const emitted = events.length;
    expect(() =>
      replaceBomItem(store, {
        projectId: PROJECT_ID,
        expectedVersion: store.getProject(PROJECT_ID).version + 1,
        oldItemId: table.id,
        newProductId: "cheaper_table",
        actor: "zach"
      })
    ).toThrow(VersionMismatchError);
    expect(rows(store)).toEqual(before);
    expect(events).toHaveLength(emitted);
  });

  it("rolls back every partial write when a later step fails", () => {
    const { store, table } = overBudgetStore();
    const before = rows(store);
    expect(() =>
      replaceBomItem(store, {
        projectId: PROJECT_ID,
        expectedVersion: store.getProject(PROJECT_ID).version,
        oldItemId: table.id,
        newProductId: "missing_product",
        actor: "zach"
      })
    ).toThrow();
    expect(rows(store)).toEqual(before);
  });

  it("restores a previously removed row for the new product instead of inserting a duplicate", () => {
    const { store, table } = overBudgetStore();
    store.candidates.set("c_cheap", candidate("c_cheap", "cheaper_table", "coffee_table"));
    regenerateBom(store, PROJECT_ID);
    const cheap = itemFor(store, "cheaper_table");
    removeFromBom(store, cheap.id);
    const count = store.bomItems.size;
    const result = replaceBomItem(store, {
      projectId: PROJECT_ID,
      expectedVersion: store.getProject(PROJECT_ID).version,
      oldItemId: table.id,
      newProductId: "cheaper_table",
      actor: "zach"
    });
    expect(result.new_item_id).toBe(cheap.id);
    expect(store.bomItems.size).toBe(count);
    expect(store.getBomItem(cheap.id).status).toBe("proposed");
  });
});

describe("renameItem and setItemKind", () => {
  it("renames the BOM item and every candidate under the old phrase, case-insensitively", () => {
    const { store } = demoStore();
    store.candidates.set("c_sofa_alt", candidate("c_sofa_alt", "side_table", "Sofa", "ranked"));
    regenerateBom(store, PROJECT_ID);
    const sofa = itemFor(store, "sofa");
    const before = store.getProject(PROJECT_ID).version;
    const result = renameItem(store, sofa.id, "  reading sofa ");
    expect(result).toMatchObject({ old_name: "sofa", name: "reading sofa" });
    expect(itemFor(store, "sofa").category).toBe("reading sofa");
    expect(store.candidates.get("c_sofa")?.category).toBe("reading sofa");
    expect(store.candidates.get("c_sofa_alt")?.category).toBe("reading sofa");
    expect(store.candidates.get("c_rug")?.category).toBe("rug");
    expect(itemFor(store, "rug").category).toBe("rug");
    expect(store.getProject(PROJECT_ID).version).toBe(before + 1);
  });

  it("rejects an empty name and leaves the rows alone", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const before = rows(store);
    expect(() => renameItem(store, itemFor(store, "sofa").id, "   ")).toThrow(/name/);
    expect(rows(store)).toEqual(before);
  });

  it("changes the kind on the item and the candidate carrying its product", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const ottoman = itemFor(store, "ottoman");
    expect(setItemKind(store, ottoman.id, "seating").kind).toBe("seating");
    expect(store.candidates.get("c_ottoman")?.kind).toBe("seating");
    expect(store.candidates.get("c_sofa")?.kind).toBe("seating");
    expect(itemFor(store, "rug").kind).toBe("soft_floor");
  });

  it("rewrites a rule's subject and objects that name the old phrase", () => {
    const rule = { relation: "under" as const, subject: "Big Rug", objects: ["sofa", "coffee table"], distance_mm: 0 };
    expect(renameItemInRule(rule, "big rug", "area rug")).toEqual({ ...rule, subject: "area rug" });
    expect(renameItemInRule(rule, "sofa", "couch")).toEqual({ ...rule, objects: ["couch", "coffee table"] });
    const text = { relation: "text" as const, text: "keep the sofa away from the window" };
    expect(renameItemInRule(text, "sofa", "couch")).toBe(text);
  });
});

describe("removeFromBom placements", () => {
  it("drops the removed item's placement and keeps the others", () => {
    const { store } = demoStore();
    regenerateBom(store, PROJECT_ID);
    const rug = itemFor(store, "rug");
    store.placements.set("pl_rug", placement("pl_rug", rug.id));
    store.placements.set("pl_sofa", placement("pl_sofa", itemFor(store, "sofa").id));
    removeFromBom(store, rug.id);
    expect(store.placements.has("pl_rug")).toBe(false);
    expect(store.placements.has("pl_sofa")).toBe(true);
  });
});
