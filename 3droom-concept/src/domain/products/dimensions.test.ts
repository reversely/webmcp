import { describe, expect, it } from "vitest";
import { FLAT_HEIGHT_MM, parseDimensions } from "./dimensions";

const SOFA_MM = { width_mm: 2134, depth_mm: 914, height_mm: 838 };

/**
 * Merchant text of the LampsUSA Bright Reader floor lamp as the demo run of 2026-08-27 ingested
 * it (issue #63): the tech specs line, the title, then the sizing sentence of the description.
 */
const FLOOR_LAMP = [
  "10.25 x 7 x 1 in",
  '63"H Slim Design LED Bright Reader Natural Daylight Full Spectrum Floor Lamp Black',
  'Floor Lamp height: 53" @ 90-degree position, 63" fully extended (Gooseneck design adjusts head from 44" to 53" in 90 degree position) Slimmer Base: 10" x 8" NEW 40% Slimmer Head: 10.25" x 7" x 1" Wt: 10 lbs, 6\' cord'
].join("\n");

describe("parseDimensions", () => {
  it.each([
    ['84" W x 36" D x 33" H', "in"],
    ["84W x 36D x 33H in", "in"],
    ["Width: 84 in\nDepth 36\"\nHeight: 33 inches", "in"],
    ['84″ × 36″ × 33″', "in"],
    ["2134 x 914 x 838 mm", "mm"]
  ])("reads %s as a sofa in millimetres", (text, unit) => {
    expect(parseDimensions(text)).toMatchObject({ ...SOFA_MM, unit, height_assumed: false });
  });

  it("reads centimetres", () => {
    expect(parseDimensions("Dimensions: 197 x 134 x 90 cm")).toMatchObject({
      width_mm: 1970,
      depth_mm: 1340,
      height_mm: 900,
      unit: "cm",
      matchedText: "197 x 134 x 90 cm"
    });
  });

  it("reads labelled measurements out of order", () => {
    expect(parseDimensions('H 33" x W 84" x D 36"')).toMatchObject(SOFA_MM);
  });

  it.each(['35.5" W x 36" D x 33" H', '35 1/2" W x 36" D x 33" H'])("reads the fraction in %s", (text) => {
    expect(parseDimensions(text)).toMatchObject({ width_mm: 902, depth_mm: 914, height_mm: 838 });
  });

  it("reads a rug as width by length with a nominal height", () => {
    expect(parseDimensions("7' x 10'")).toEqual({
      width_mm: 2134,
      depth_mm: 3048,
      height_mm: FLAT_HEIGHT_MM,
      unit: "ft",
      matchedText: "7' x 10'",
      height_assumed: true
    });
  });

  it("takes a rug's height from its pile", () => {
    expect(parseDimensions("Size: 5'3\" x 7'6\"\nPile height: 0.5\"")).toMatchObject({
      width_mm: 1600,
      depth_mm: 2286,
      height_mm: 13,
      height_assumed: true,
      matchedText: "5'3\" x 7'6\"; Pile height: 0.5\""
    });
  });

  it("maps a labelled length to depth when no depth is written", () => {
    expect(parseDimensions("Width: 8 ft\nLength: 10 ft")).toMatchObject({ width_mm: 2438, depth_mm: 3048 });
  });

  it("prefers the largest labelled height over a positional triple", () => {
    expect(parseDimensions(FLOOR_LAMP)).toMatchObject({
      width_mm: 260,
      depth_mm: 178,
      height_mm: 1600,
      unit: "in",
      height_assumed: false,
      matchedText: '10.25 x 7 x 1 in; 63"H'
    });
  });

  it.each([
    ['84 x 36 x 33 in\nOverall height: 40"', 1016],
    ['84" W x 36" D x 33" H\nSeat height: 18"', 838],
    ["Width: 84 in\nDepth 36\"\nHeight: 33 inches\nShade height: 12 in", 838],
    ['84 x 36 in, 33 in tall', 838]
  ])("reads the height of %j as %i mm", (text, height_mm) => {
    expect(parseDimensions(text)).toMatchObject({ width_mm: 2134, depth_mm: 914, height_mm, height_assumed: false });
  });

  it.each(["Seats 3, available in 12 colours", "Width: 84 in", "3 x 2 cushions", ""])(
    "returns null for %j",
    (text) => {
      expect(parseDimensions(text)).toBeNull();
    }
  );
});
