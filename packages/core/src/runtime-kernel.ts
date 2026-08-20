import { type HarnessEvent, type JsonRpcNotification } from "@yellow-flow/protocol";
import { HarnessServer } from "./rpc/harness-server.js";
import { PromptBuilder } from "./services/prompt-builder.js";
import { getDefaultHomeDir, getDefaultSystemSkillsRoot, SkillService } from "./services/skill-service.js";
import { HarnessDatabase, getDefaultDatabasePath } from "./store/database.js";

export interface RuntimeKernel {
  homeDir: string;
  database: HarnessDatabase;
  skillService: SkillService;
  promptBuilder: PromptBuilder;
  server: HarnessServer;
  dispose: () => void;
}

export function createRuntimeKernel(options: {
  homeDir?: string;
  emitEvent: (event: HarnessEvent) => void;
}): RuntimeKernel {
  const homeDir = options.homeDir ?? process.env.YELLOW_FLOW_HOME ?? getDefaultHomeDir();
  const database = new HarnessDatabase(getDefaultDatabasePath(homeDir));
  const emitRaw = (notification: JsonRpcNotification) => {
    options.emitEvent({
      type: notification.method as HarnessEvent["type"],
      payload: notification.params as HarnessEvent["payload"],
    } as HarnessEvent);
  };
  const skillService = new SkillService(getDefaultSystemSkillsRoot(), homeDir, (skills) => {
    emitRaw({
      jsonrpc: "2.0",
      method: "skills/changed",
      params: { skills },
    });
  });
  const promptBuilder = new PromptBuilder(skillService);
  const server = new HarnessServer(database, skillService, promptBuilder, emitRaw);

  return {
    homeDir,
    database,
    skillService,
    promptBuilder,
    server,
    dispose: () => {
      server.dispose();
      skillService.dispose();
    },
  };
}
