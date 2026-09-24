import { describe, it, expect } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts a GitHub App installation token", () => {
    const out = redactSecrets(
      "remote: Invalid credentials for ghs_16CharsAndThenSomeMoreChars0123456789",
    );
    expect(out).not.toContain("ghs_16CharsAndThenSomeMoreChars0123456789");
    expect(out).toContain("REDACTED");
  });

  it("redacts the legacy v1.<sha> installation token form", () => {
    const token = "v1." + "a".repeat(40);
    const out = redactSecrets(`Authorization failed using ${token} today`);
    expect(out).not.toContain(token);
    expect(out).toContain("REDACTED");
  });

  it("redacts a clone URL carrying a token", () => {
    const out = redactSecrets(
      "Cloning into https://x-access-token:ghs_secretvalue123456@github.com/acme/app ...",
    );
    expect(out).not.toContain("ghs_secretvalue123456");
  });

  it("leaves ordinary build output alone", () => {
    const msg = "Step 3/7 : RUN npm ci --omit=dev";
    expect(redactSecrets(msg)).toBe(msg);
  });
});
