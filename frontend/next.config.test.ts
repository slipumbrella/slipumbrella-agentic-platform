import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./next.config";

describe("buildContentSecurityPolicy", () => {
  it("keeps the backend API and websocket origins while removing dead allowances", () => {
    const csp = buildContentSecurityPolicy("https://api.example.com", "wss://api.example.com");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' https://api.example.com wss://api.example.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("googleapis.com");
    expect(csp).not.toContain("50052");
  });

  it("allows unsafe-eval only in development mode", () => {
    const devCsp = buildContentSecurityPolicy("https://api.example.com", "wss://api.example.com", {
      isDevelopment: true,
    });
    const prodCsp = buildContentSecurityPolicy("https://api.example.com", "wss://api.example.com", {
      isDevelopment: false,
    });

    expect(devCsp).toContain("'unsafe-eval'");
    expect(prodCsp).not.toContain("'unsafe-eval'");
  });
});
