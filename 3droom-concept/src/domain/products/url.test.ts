import { describe, expect, it } from "vitest";
import { extractHandle, normalizeProductUrl } from "./url";

describe("normalizeProductUrl", () => {
  it("strips utm tags and a variant query", () => {
    expect(
      normalizeProductUrl("https://floydhome.com/products/the-sofa?variant=41234567890&utm_source=ig&utm_medium=social#reviews")
    ).toBe("https://floydhome.com/products/the-sofa");
  });

  it("drops a collection prefix and lowercases the host", () => {
    expect(normalizeProductUrl("http://WWW.Sabai.Design/collections/sofas/products/The-Essential-Sofa/")).toBe(
      "https://www.sabai.design/products/the-essential-sofa"
    );
  });

  it("returns null for a URL without a product handle", () => {
    expect(normalizeProductUrl("https://floydhome.com/collections/sofas")).toBeNull();
    expect(normalizeProductUrl("not a url")).toBeNull();
  });
});

describe("extractHandle", () => {
  it("reads the handle from a path or a full URL", () => {
    expect(extractHandle("/products/the-sofa.json")).toBe("the-sofa");
    expect(extractHandle("https://floydhome.com/products/the-sofa?variant=1")).toBe("the-sofa");
    expect(extractHandle("https://floydhome.com/")).toBeNull();
  });
});
