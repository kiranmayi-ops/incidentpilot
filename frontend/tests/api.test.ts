import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, EngineAPI } from "@/lib/api";

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EngineAPI", () => {
  it("builds correct URL and payload for investigate", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { run_id: 7 }));
    await EngineAPI.investigate("INC-2001", "memory");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/incidents/INC-2001/investigate");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify({ kind: "memory" }));
  });

  it("surfaces the backend detail message on non-OK responses", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(404, { detail: "incident INC-9999 not found" }));
    await expect(EngineAPI.incident("INC-9999")).rejects.toThrow(
      "incident INC-9999 not found",
    );
    await expect(EngineAPI.incident("INC-9999")).rejects.toBeInstanceOf(ApiError);
  });

  it("falls back to the status code when the error body has no detail", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(EngineAPI.health()).rejects.toThrow("500");
  });

  it.each([
    ["incidents", () => EngineAPI.incidents(), "/incidents"],
    ["timeline", () => EngineAPI.incidentTimeline("INC-1"), "/incidents/INC-1/timeline"],
    ["memory", () => EngineAPI.memory("INC-1"), "/incidents/INC-1/memory"],
    ["strategy", () => EngineAPI.learningStrategy(), "/learning/strategy"],
    ["evolution", () => EngineAPI.learningEvolution(), "/learning/evolution"],
  ])("hits %s at %s", async (_name, call, path) => {
    vi.stubGlobal("fetch", mockFetchOnce(200, []));
    await call();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(path);
  });
});