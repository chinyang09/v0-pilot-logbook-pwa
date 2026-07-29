/**
 * The glass rasters are neutral everywhere except the rim, so `buildGlassRasters`
 * only walks the bands that can reach it. That optimisation is the whole reason
 * the nav sidebar stopped hitching for a second on Android when it settles, and
 * it is invisible if it's wrong — a missed band is a seam in the refraction that
 * only shows on one device at one size.
 *
 * So every case here compares the fast scan byte-for-byte against
 * `scanEveryPixel`, the reference that walks the lot.
 */

import { describe, it, expect } from "vitest";
import { buildGlassRasters, type GlassMapOptions } from "../displacement";

function assertMatchesFullScan(opts: GlassMapOptions) {
  const fast = buildGlassRasters(opts);
  const reference = buildGlassRasters({ ...opts, scanEveryPixel: true });

  expect(fast.w).toBe(reference.w);
  expect(fast.h).toBe(reference.h);
  expect(fast.displacementScale).toBeCloseTo(reference.displacementScale, 10);

  // Report the first difference rather than a 5MB diff.
  for (const [name, a, b] of [
    ["displacement", fast.disp, reference.disp],
    ["specular", fast.spec, reference.spec],
  ] as const) {
    for (let i = 0; i < b.length; i++) {
      if (a[i] !== b[i]) {
        const px = Math.floor(i / 4);
        throw new Error(
          `${name} differs at (${px % fast.w}, ${Math.floor(px / fast.w)}) ` +
            `channel ${i % 4}: fast=${a[i]} reference=${b[i]}`
        );
      }
    }
  }
}

describe("buildGlassRasters rim scan", () => {
  it("matches a full scan for the nav pill", () => {
    assertMatchesFullScan({ width: 340, height: 56, radius: 28, pixelRatio: 3 });
  });

  it("matches a full scan for the nav sidebar", () => {
    assertMatchesFullScan({ width: 300, height: 620, radius: 20, pixelRatio: 2 });
  });

  it("matches a full scan for a square control", () => {
    assertMatchesFullScan({ width: 56, height: 56, radius: 24, pixelRatio: 2 });
  });

  it("matches a full scan when the radius is a full semicircle", () => {
    // radius clamps to half the short side — the corner arcs meet, leaving no
    // straight edge at all.
    assertMatchesFullScan({ width: 200, height: 44, radius: 999, pixelRatio: 1 });
  });

  it("matches a full scan when the bezel is wider than the radius", () => {
    // Then every interior pixel formally satisfies the bezel test; it still has
    // to resolve to the neutral value the fill already wrote.
    assertMatchesFullScan({
      width: 120,
      height: 400,
      radius: 4,
      bezelWidth: 24,
      pixelRatio: 1,
    });
  });

  it("matches a full scan at a degenerate size", () => {
    assertMatchesFullScan({ width: 3, height: 900, radius: 20, pixelRatio: 1 });
  });

  it("matches a full scan with a square radius of zero", () => {
    assertMatchesFullScan({ width: 80, height: 80, radius: 0, pixelRatio: 1 });
  });
});

describe("buildGlassRasters output shape", () => {
  it("supersamples the raster to the pixel ratio but reports CSS px", () => {
    const r = buildGlassRasters({ width: 100, height: 40, radius: 12, pixelRatio: 3 });
    expect(r.cssW).toBe(100);
    expect(r.cssH).toBe(40);
    expect(r.w).toBe(300);
    expect(r.h).toBe(120);
  });

  it("caps the supersample so a large surface can't allocate an unbounded map", () => {
    // The sidebar at phone DPR: 3× would be 1.67M px, over the budget, so the
    // factor is pulled back — but never below 1, which would undersample the
    // element itself.
    const r = buildGlassRasters({ width: 300, height: 620, radius: 20, pixelRatio: 3 });
    // Rounding each side up can nudge a pixel or two past the budget; it is a
    // ceiling on the allocation, not an exact count.
    expect(r.w * r.h).toBeLessThan(1_210_000);
    expect(r.w).toBeGreaterThan(300);
    expect(r.w / 300).toBeLessThan(3);

    // A surface already past the budget at 1:1 still gets a full-size raster —
    // going below 1× would blur the element's own rim.
    const huge = buildGlassRasters({ width: 1200, height: 1600, radius: 20, pixelRatio: 3 });
    expect(huge.w).toBe(1200);
    expect(huge.h).toBe(1600);
  });

  it("leaves the interior neutral — grey displacement, transparent specular", () => {
    const r = buildGlassRasters({ width: 200, height: 200, radius: 20, pixelRatio: 1 });
    const centre = (Math.floor(r.h / 2) * r.w + Math.floor(r.w / 2)) * 4;
    expect([r.disp[centre], r.disp[centre + 1], r.disp[centre + 3]]).toEqual([128, 128, 255]);
    expect(r.spec[centre + 3]).toBe(0);
  });

  it("writes a specular rim on the edge", () => {
    const r = buildGlassRasters({ width: 200, height: 200, radius: 20, pixelRatio: 1 });
    let lit = 0;
    for (let i = 3; i < r.spec.length; i += 4) if (r.spec[i] > 0) lit++;
    expect(lit).toBeGreaterThan(0);
    // A rim, not a fill.
    expect(lit).toBeLessThan(r.w * r.h * 0.2);
  });
});
