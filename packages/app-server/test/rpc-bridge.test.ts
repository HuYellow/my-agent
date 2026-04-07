import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app-server RPC bridge", () => {
  it("forwards arbitrary JSON-RPC methods such as turn/steer and review/* to core", () => {
    const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

    expect(source).toContain('url.pathname === "/api/rpc"');
    expect(source).toContain("const body = (await readJson(req)) as JsonRpcRequest");
    expect(source).toContain("const result = await runtime.server.handle(body)");
  });
});
