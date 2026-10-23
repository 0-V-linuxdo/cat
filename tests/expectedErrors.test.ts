import { describe, expect, test } from "bun:test";
import { isExpectedError } from "../src/plugins/library/media/expectedErrors";

const yes = (m: unknown, k: Parameters<typeof isExpectedError>[1]) => expect(isExpectedError(m, k)).toBe(true);
const no = (m: unknown, k: Parameters<typeof isExpectedError>[1]) => expect(isExpectedError(m, k)).toBe(false);

describe("isExpectedError", () => {
    test("script: Chrome sentences", () => {
        yes(new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host."), "script");
        yes(new Error("Cannot access a chrome:// URL"), "script");
        yes(new Error("Cannot access a chrome-extension:// URL of different extension"), "script");
        yes(new Error("The extensions gallery cannot be scripted."), "script");
        yes(new Error("Frame with ID 0 is showing error page"), "script");
        yes(new Error("No tab with id: 12."), "script");
    });
    test("script: near misses", () => {
        no(new Error("Cannot access 'x' before initialization"), "script");
        no(new Error("Failed to load chrome://newtab"), "script");
        no(new Error("chrome-extension://abc/x.js failed"), "script");
        no(new Error("Rendered error page template"), "script");
        no(new Error("Frame with ID 3 was removed"), "script");
        no(new Error("Unexpected token"), "script");
    });
    test("download", () => {
        yes(new Error("Download file already deleted"), "download");
        yes("Invalid download id 7", "download");
        no(new Error("File not found"), "download");
        no(new Error("Download must be complete"), "download");
    });
    test("message", () => {
        yes(new Error("Could not establish connection. Receiving end does not exist."), "message");
        yes({ message: "Receiving end does not exist." }, "message");
        no(new Error("Message length exceeded maximum allowed length."), "message");
        no(new Error("Connection established"), "message");
    });
    test("kinds don't cross / non-errors", () => {
        no(new Error("Receiving end does not exist."), "script");
        no(new Error("Cannot access a chrome:// URL"), "message");
        no(new Error("Download file already deleted"), "script");
        no(undefined, "script");
        no(42, "download");
    });
});
