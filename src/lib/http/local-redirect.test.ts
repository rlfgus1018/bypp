import { describe, expect, it } from "vitest";
import { localRedirect } from "./local-redirect";

describe("localRedirect", () => {
  it("sends a relative Location, so a proxy's internal host never leaks into the redirect", () => {
    const response = localRedirect("/calendar?google=connected");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/calendar?google=connected");
  });

  it("refuses anything that is not a local path", () => {
    for (const path of ["https://evil.example/", "//evil.example/", "calendar"]) expect(() => localRedirect(path)).toThrow();
  });
});
