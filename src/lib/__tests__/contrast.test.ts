import { describe, it, expect } from "vitest";
import { contrastRatio, qrColorWarning } from "../contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("is 1 for identical colors", () => {
    expect(contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(
      contrastRatio("#abcdef", "#123456"),
      5,
    );
  });
});

describe("qrColorWarning", () => {
  it("returns null for high-contrast dark-on-light", () => {
    expect(qrColorWarning("#000000", "#ffffff")).toBeNull();
  });

  it("warns when colors are too similar", () => {
    expect(qrColorWarning("#888888", "#999999")).toMatch(/too similar/);
  });

  it("warns for light-on-dark even with good contrast", () => {
    expect(qrColorWarning("#ffffff", "#000000")).toMatch(/light-on-dark/i);
  });
});
