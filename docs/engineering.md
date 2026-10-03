# 本项目工程与文档约定

本仓的 README、工程入口、docs 与 OpenSpec 应能在单独 clone 时独立使用。项目实现架构、稳定契约、任务、运维与证据由本仓维护；整体产品优先级在 Morphix 容器，由外部链接提供背景，不是本仓开发前置条件。

- 文档有 owner、状态与边界；当前实现以源码核对，目标放 plans/change，历史放 archive。
- 任务全勾选不是完成的充分证据；未完成的登录态/部署/客户端生命周期验收保留开放。Diagnostic 不等于 end-to-end，不用冻结数据成绩冒充当前线上质量。
- 稳定需求在 openspec/specs；完整实施 change 在 changes；仅想法/未采纳方案进入 openspec/drafts；已完成 scoped 工作归档到日期目录。
- 迁移先记录原提交和 SHA-256，核对副本，再修链接/索引，不留第二份权威。正文唯一；重复或无意义产物可删除，但独特决策与证据保留。
- 必读相对链接不得越出仓根；跨仓背景用 canonical URL。不要引用个人绝对路径作为团队依赖。
- 环境变量只按 key 名检查，值编辑与进程注入走 morphix-env；不读/打印 .env*、token 或个人语料。
- 代码改动在独立分支验证后走 PR；不无审查 push main，不删测试换绿。文档治理不自动授权产品部署、数据写入或密钥改动。
- 提示词保持短、按需；不复制包版本/工具数量/用户数据。项目 Skill 只放团队需要的工作流，客户端共享一份正文；MCP 机器专属凭据留本地，不入 Git。

普通实现任务先查现役 source/docs/spec 和相关 active change；archive、历史 reports、大型审计 JSON 和未启用的 prompts_bak 按明确调查目的读取。删除的旧正文按本仓 documentation-deletions.json 的固定 commit/path/hash 恢复，不依赖父仓归档。
