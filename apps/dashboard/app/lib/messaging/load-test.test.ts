import { describe, expect, it } from "vitest";
import { runSimulatedLoadTest } from "./load-test-sim";

describe("Load Test: 50-Organization Webhook Ingestion & Background Queue", () => {
  it("processes 500 concurrent messages across 50 organizations under load", async () => {
    const result = await runSimulatedLoadTest(50, 10);

    expect(result.totalMessages).toBe(500);
    expect(result.organizationsCount).toBe(50);
    expect(result.throughputMsgsPerSec).toBeGreaterThan(100);
    expect(result.p95LatencyMs).toBeLessThan(100);
    expect(result.rateLimitRejections).toBe(0);
  });
});
