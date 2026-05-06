import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InternalToolProvider } from "../src/tools/internal-tool-provider.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
});

describe("InternalToolProvider", () => {
  it("loads manifests and executes internal tools over HTTP", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-internal-tools-"));
    const homeDir = join(root, "home");
    const workspaceRoot = join(root, "workspace");
    const manifestDir = join(homeDir, "internal-tools");

    mkdirSync(manifestDir, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];

      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            received: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          }),
        );
      });
    });
    servers.push(server);

    await new Promise<void>((resolvePromise) => server.listen(0, () => resolvePromise()));
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Failed to bind test server.");
    }

    writeFileSync(
      join(manifestDir, "internal-doc-lookup.json"),
      JSON.stringify(
        {
          name: "internal_doc_lookup",
          description: "Query the internal documentation gateway.",
          endpoint: `http://127.0.0.1:${address.port}/lookup`,
          method: "POST",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
            additionalProperties: false,
          },
          approval: {
            required: true,
            reason: "Internal documentation access should stay visible to the operator.",
            writes: false,
            network: true,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const provider = new InternalToolProvider(homeDir);
    const tools = provider.listTools({
      id: "workspace",
      name: "Workspace",
      rootPath: workspaceRoot,
      shell: process.platform === "win32" ? "powershell" : "bash",
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("internal_doc_lookup");

    const payload = await tools[0]!.execute(
      {
        query: "agent sdk session",
      },
      {
        workspace: {
          id: "workspace",
          name: "Workspace",
          rootPath: workspaceRoot,
          shell: process.platform === "win32" ? "powershell" : "bash",
          sandboxMode: "danger-full-access",
          approvalPolicy: "never",
        },
        emitCommandDelta: () => undefined,
      },
    );

    expect(JSON.parse(payload)).toEqual({
      ok: true,
      received: {
        query: "agent sdk session",
      },
    });
  });
});
