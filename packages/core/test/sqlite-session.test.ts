import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteSession } from "../src/services/sqlite-session.js";
import { HarnessDatabase } from "../src/store/database.js";

describe("SqliteSession", () => {
  it("stores and retrieves session history in order", async () => {
    const root = mkdtempSync(join(tmpdir(), "my-agent-session-"));
    const database = new HarnessDatabase(join(root, "app.db"));
    const session = new SqliteSession(database, "thread-1");

    await session.addItems([
      { role: "user", content: "hello" },
      {
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "world" }],
      },
    ]);

    const items = await session.getItems();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ role: "user", content: "hello" });
    expect(items[1]).toMatchObject({ role: "assistant" });

    const popped = await session.popItem();
    expect(popped).toMatchObject({ role: "assistant" });
    expect(await session.getItems()).toHaveLength(1);

    await session.clearSession();
    expect(await session.getItems()).toHaveLength(0);
  });
});
