# my-agent 路线图与 Issue Backlog

## 摘要
按当前仓库状态，路线图采用 `Runtime 优先`、`可直接开发 issue` 的拆分方式，目标是先把 `my-agent` 从“功能骨架”推进到“可持续完成真实 coding 任务的通用 agent”，再补强编排、上下文与平台能力，最后再做工作台体验和生态分发。

Milestone 顺序固定为：

1. `P0-M1` 真实子代理
2. `P0-M2` 运行中 steer 与 review 模式
3. `P0-M3` PTY 终端与安全模型
4. `P1-M1` 执行单元与编排升级
5. `P1-M2` memory / context 分层
6. `P1-M3` 协议与工具治理统一
7. `P2-M1` 桌面工作台
8. `P2-M2` 插件与自动化平台
9. `P2-M3` 分发与模板化

每个 milestone 的完成标准是：协议、runtime、状态存储、基本 UI 可见性、测试同时落地；不接受“只有后端能力”或“只有 UI 壳”的完成定义。

## 关键接口与类型变更
需要在 roadmap 中统一规划这些公共接口变化，避免后续返工：

- `protocol` 增加 `turn/steer` 请求与响应类型，支持把追加指令注入正在运行的 turn。
- `protocol` 增加 `review/*` 类型，至少包含 `review/start`、`review/result`、`review/status` 的请求与事件结构。
- `AgentTaskRecord` 从“纯文本子任务结果”扩展为“真实子代理执行结果”，至少包含执行上下文、使用工具摘要、最终产物摘要。
- `EnvironmentRecord` 与 `WorktreeRecord` 之上增加统一的 execution context 概念，供 sub-agent、workflow、review 复用。
- `HarnessEvent` 增加计划、diff、review、steer 相关的结构化事件，不再只依赖 item stream 间接表达状态。
- 工具定义层统一补齐 capability 元数据，至少覆盖 `writes`、`network`、`interactive`、`approval mode`、`timeout`、`source`。

## P0 Milestone 规划

### P0-M1 真实子代理
目标：把 `agent/spawn` 从 chat-only worker 升级为真正会读、跑、改、回传结果的 coding sub-agent。

Issue：
1. 定义子代理执行模型  
将子代理执行路径改为复用主 runner 和 tool service，而不是直接走 `ProviderService.complete`。
2. 实现上下文继承策略  
实现 `inheritHistory` 的真实语义，明确继承 turn 历史、session 摘要、project instructions、selected skills 的最小集合。
3. 为子代理绑定独立 worktree  
子代理默认创建独立 worktree，并把 worktree 生命周期与 agent task 生命周期绑定。
4. 子代理结果结构化回传父 turn  
父 turn 中记录子代理摘要、最终状态、关键产物、失败原因，而不是只塞一段最终文本。
5. 子代理支持工具与审批  
子代理能够触发工具调用、审批、终止和等待，并通过统一事件回传到主线程。
6. 补充子代理状态测试  
覆盖 spawn、wait、send_input、interrupt、approval、失败恢复、worktree 清理等路径。

完成标准：
- 子代理能独立修改代码、执行命令、等待审批并完成任务。
- 父线程中能清晰看到 delegated task 的结构化结果。
- 现有 `agent/spawn` 接口不废弃，只升级语义。

### P0-M2 运行中 steer 与 review 模式
目标：让 turn 具备协作式控制能力，并把 review 提升为一等运行模式。

Issue：
1. 设计 `turn/steer` 协议  
定义追加指令、优先级、可见性和返回状态，确保对运行中 turn 可安全注入。
2. 在 runner 中实现 steer 注入  
支持模型在当前 run 内消费 steer 指令，而不是必须 cancel 后重启。
3. 设计 review 运行模式与结果结构  
review 结果必须输出 findings 列表、严重级别、定位信息、摘要，而不是自然语言散文。
4. 实现 review 数据源  
支持 review 当前 workspace diff、staged diff、指定 commit、指定 base branch diff。
5. review 与普通 turn 的状态隔离  
review 使用独立状态机和事件，避免与普通 coding turn 混淆。
6. 添加 review 基本 UI 占位  
桌面端至少可触发 review、查看 findings 列表和 review 状态。

完成标准：
- 用户可以在 turn 运行过程中追加“停下来总结”“改成只读分析”“先跑测试”等指令。
- review 模式可以稳定产出结构化 findings。

### P0-M3 PTY 终端与安全模型
目标：把终端从 buffer 式会话升级为真实开发终端，并把审批/安全从规则判断推进到可信执行模型。

Issue：
1. 将 terminal manager 改为 PTY 后端  
支持交互命令、可靠输出流、窗口尺寸变更和长会话生命周期。
2. 完善 terminal session 状态  
记录 exit code、启动时间、最后活动时间、交互状态和错误状态。
3. 为交互式命令补充能力标记  
工具层区分普通命令与 interactive command，交给审批策略区别处理。
4. 扩展 sandbox policy  
引入 protected paths、危险 git 操作分级、网络访问细化、trusted command 分类。
5. 审批体验与 session approval 整理  
统一 preflight / deferred / session approval 语义，避免不同工具来源行为不一致。
6. 添加安全回归测试  
覆盖越界路径、只读模式写入、网络阻断、危险命令审批、交互命令拒绝或升级审批。

完成标准：
- terminal 可稳定运行交互式开发命令。
- 高风险命令、越界路径和危险 git 操作均有明确审批或阻断行为。

## P1 Milestone 规划

### P1-M1 执行单元与编排升级
目标：把 worktree、environment、sub-agent、workflow 统一成一个可复用的执行编排体系。

Issue：
1. 引入 execution context 抽象  
统一封装 `project + worktree + cwd + shell + env snapshot + detected tools`。
2. workflow step 切换到真实子代理  
`agent` step 必须复用 P0 子代理能力，不再走弱化版任务路径。
3. command / review / sub-agent 共享 execution context  
同一编排框架下，不同 step 只切换能力，不切换模型。
4. workflow 的失败恢复与 resume 细化  
支持 step 级别重试、人工确认后继续、失败产物保留。
5. workflow 结果结构化  
每个 step 输出统一的 status、artifact summary、execution context id。
6. 覆盖复杂 workflow 测试  
至少覆盖并行 step、pause/resume、agent step、approval step、worktree 清理。

完成标准：
- workflow 不再是“外层图 + 内层弱 agent”，而是统一的执行编排层。
- 任意 step 都能明确运行在哪个 execution context 中。

### P1-M2 memory / context 分层
目标：降低 prompt builder 对长 system prompt 的依赖，让长任务更稳。

Issue：
1. 设计三层上下文模型  
划分短期会话上下文、长程摘要记忆、按需检索上下文。
2. session 历史压缩机制升级  
从按 item 数量裁剪升级为语义摘要和关键事件保留。
3. 子代理上下文裁剪策略  
明确父线程内容如何裁剪后传给子代理，避免上下文污染。
4. AGENTS / skills / MCP context 注入重构  
把长期稳定上下文与本次任务特定上下文拆开，不再统一拼接。
5. 上下文可观测性  
在 UI 或事件中暴露本次 run 的 context 构成摘要，便于排查模型行为。
6. memory 回归测试  
覆盖长线程、多次 steer、子代理继承、技能激活、MCP 注入等场景。

完成标准：
- 长线程不会仅靠截断历史维持运行。
- 子代理与主线程的上下文传递可解释、可观测。

### P1-M3 协议与工具治理统一
目标：把 protocol、tool metadata、事件模型收敛成稳定平台接口。

Issue：
1. 统一 tool capability 元数据  
所有本地工具、插件工具、MCP 工具、internal tools 都输出一致的 capability 描述。
2. 设计结构化 plan / diff / review 事件  
避免前端从 item body 反推运行状态。
3. 规范工具错误模型  
统一 timeout、approval needed、blocked、validation error、execution failure 的错误类型。
4. 工具来源治理  
在事件和 UI 中稳定区分 local / plugin / MCP / internal。
5. protocol 文档化与 compatibility 约束  
为新增接口定义最小兼容规则，避免 desktop 与 core 演进脱节。
6. 套件级协议测试  
通过集成测试验证桌面端、core、app-server、MCP server 的协议一致性。

完成标准：
- 新增任意工具类型时，不需要再写一套独立错误和审批语义。
- 前端可以直接消费结构化 plan / diff / review 事件。

## P2 Milestone 规划

### P2-M1 桌面工作台
目标：把桌面端从状态面板升级为真正的 agent 工作台。

Issue：
1. 增加 sub-agent 树视图  
显示父子代理关系、状态、worktree、输出摘要。
2. 增加 plan 面板  
独立渲染 plan，不混在普通消息流中。
3. 增加 diff / patch 面板  
支持查看本次 turn 的文件变化与差异。
4. 增加 review findings 面板  
按严重级别和文件定位展示 findings。
5. 增加 steer 输入入口  
运行中的 turn 可以直接在 UI 追加指令。
6. 增加 execution context 视图  
展示当前 thread / agent / workflow 绑定的 worktree、shell、环境信息。

完成标准：
- 用户不需要仅靠消息流理解 agent 在做什么。
- review、plan、diff、sub-agent 都有独立工作区。

### P2-M2 插件与自动化平台
目标：让插件、internal tools、automation 从“目录发现”升级为“可管理的平台能力”。

Issue：
1. 插件安装与启停管理  
支持列出、启停、来源标记、版本展示和首次信任确认。
2. internal tool 管理面  
支持查看 manifest、启停、超时、审批策略和运行日志。
3. 自动化任务模型  
定义 recurring task / automation 的最小协议与持久化方式。
4. app-server / GitHub Action 与 automation 打通  
支持无头运行 workflow 或 prompt，并把结果结构化输出。
5. 插件能力声明校验  
安装和启动时校验工具 schema、能力声明和权限需求。
6. 自动化与插件测试  
覆盖安装、启停、运行失败、审批、无头调用和结果回放。

完成标准：
- 插件和自动化不再是“把文件放进目录里就行”的隐式机制。
- 用户可管理、可审计、可启停。

### P2-M3 分发与模板化
目标：降低他人为 `my-agent` 编写 skill / workflow / plugin 的门槛。

Issue：
1. skill / workflow / plugin 模板脚手架  
提供最小可运行模板。
2. 示例仓库与参考实现  
给出 repo skill、review workflow、internal tool、plugin 示例。
3. 文档站或 repo docs 整理  
覆盖 protocol、runtime、plugin、workflow、automation 的开发说明。
4. 兼容性与版本策略  
明确 manifest 版本、协议版本与迁移提示。
5. 生态分发入口  
为用户目录和 repo 目录之外预留安装来源模型。
6. 模板验证测试  
验证生成物能被 runtime 正常发现、加载和执行。

完成标准：
- 第三方开发者能低成本扩展 `my-agent`。
- 平台接口有清晰的版本和迁移边界。

## 测试计划
每个 milestone 都必须补最小回归集，统一遵循以下场景：

- 主 turn、子代理、workflow、review 的 happy path 全链路测试。
- 审批场景测试：preflight、deferred、session approval、reject。
- 终端与命令测试：长命令、交互命令、中断、退出码记录。
- 沙箱测试：越界路径、只读写入、网络限制、危险 git 操作。
- 上下文测试：长线程、steer、子代理继承、memory 摘要。
- 协议测试：desktop、core、app-server、MCP server 对新增类型的一致性。
- UI 冒烟测试：review findings、diff、sub-agent、plan、steer 入口能渲染基本状态。

## 假设与默认决策
- 默认以 `runtime/core/protocol` 为先，UI 仅做能支撑 milestone 验证的最小可见性。
- 子代理、review、workflow 都复用同一 runner 能力栈，不维护第二套简化模型执行路径。
- 现有接口尽量升级语义而不是直接删除，避免 desktop 与外围包同时大改。
- review v1 只输出结构化 findings，不在 v1 内做自动修复建议工作流。
- execution context 先服务本地运行与 worktree，不在本轮引入云端执行。
- 每个 milestone 结束后才允许进入下一 milestone；不并行推进两个 P0 milestone，以避免协议和状态模型反复返工。
