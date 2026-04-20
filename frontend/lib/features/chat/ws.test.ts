import { createClientWithFallback } from "./ws";

describe("ws client boundary", () => {
  it("does not install a public fallback client", () => {
    const original = process.env.NEXT_PUBLIC_AGENT_WS_URL;
    try {
      process.env.NEXT_PUBLIC_AGENT_WS_URL = "ws://example.invalid";

      const client = createClientWithFallback("ws://localhost:8080/ws/builder", () => {});

      expect(client.onReconnectFailed).toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env.NEXT_PUBLIC_AGENT_WS_URL;
      } else {
        process.env.NEXT_PUBLIC_AGENT_WS_URL = original;
      }
    }
  });
});
