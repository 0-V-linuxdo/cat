import { describe, expect, test } from "bun:test";
import { colorFromPosition, compliments, contrastRatio, dotForColor, getGradient, hexToRgb, hslToRgb, MAX_DOTS, prefersLightText, rgbToHsl, textureFromAngle } from "../src/plugins/spaces/themes/gradient";

describe("Zen gradient port", () => {
    test("hsl round-trip", () => {
        const [h, s, l] = rgbToHsl(239, 84, 104);
        const back = hslToRgb(h / 360, s, l);
        expect(Math.abs(back[0] - 239) + Math.abs(back[1] - 84) + Math.abs(back[2] - 104)).toBeLessThan(4);
    });
    test("plane: centre is dark, angle is hue", () => {
        expect(colorFromPosition({ x: 0.5, y: 0.5 })).toEqual([0, 0, 0]);
        const [r, g, b] = colorFromPosition({ x: 0.75, y: 0.5 }); // hue 0 → red, mid lightness
        expect(r).toBeGreaterThan(200); expect(g).toBeLessThan(40); expect(b).toBeLessThan(40);
    });
    test("swatch → dot → colour stays close", () => {
        for (const hex of ["#ef5468", "#66b8db", "#f1ebe6", "#66658a"]) {
            const want = hexToRgb(hex), got = colorFromPosition(dotForColor(want));
            expect(Math.max(...want.map((v, i) => Math.abs(v - got[i])))).toBeLessThan(40);
        }
    });
    test("harmonies: add up to 3, remove back", () => {
        const one = [{ x: 0.8, y: 0.5 }];
        const two = compliments(one, "add");
        expect(two.dots.length).toBe(2); expect(two.algo).toBe("complementary");
        expect(two.dots[1].x).toBeCloseTo(0.2, 5);
        const three = compliments(two.dots, "add", two.algo);
        expect(three.dots.length).toBe(MAX_DOTS);
        expect(compliments(three.dots, "remove", three.algo).dots.length).toBe(2);
    });
    test("gradient shapes", () => {
        const base = hexToRgb("#121227");
        expect(getGradient([[255, 0, 0]], base, 0.5)).toMatch(/^rgb\(/);
        expect(getGradient([[255, 0, 0], [0, 0, 255]], base, 0.5)).toMatch(/linear-gradient.*linear-gradient/);
        expect(getGradient([[255, 0, 0], [0, 255, 0], [0, 0, 255]], base, 0.5)).toMatch(/radial-gradient/);
    });
    test("contrast picks text colour", () => {
        expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
        expect(prefersLightText([hexToRgb("#f1ebe6")], hexToRgb("#ece9f1"), 0.5)).toBe(false);
        expect(prefersLightText([hexToRgb("#66658a")], hexToRgb("#121227"), 0.5)).toBe(true);
    });
    test("dial angle → steps", () => {
        expect(textureFromAngle(0, -10)).toBe(0);
        expect(textureFromAngle(10, 0)).toBe(0.25);
        expect(textureFromAngle(0, 10)).toBe(0.5);
    });
});
