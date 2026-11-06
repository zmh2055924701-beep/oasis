# Changelog

## v0.9.2 — 2026-11-06

### 目的系统生命周期

- 目标与待续新增短期 / 长期 horizon，以及 dueAt / eventDate。
- 新增真实 done 状态：模型完成、主人明确确认完成、事件日期到达、手动完成都会结案。
- 过期目标不再因为 attempts > 0 而继续保留；短期待续默认 48 小时 TTL。
- 旧 owner-topic 噪声、旧待续、旧 lastPurpose 在启动迁移时清理。
- 选择器对待续做年龄衰减，旧事项不再长期压过新目的。
- 新增 POST /api/purpose/complete 和设置页「完成」按钮。

### 大脑页面 v2

- 改为「人格核心 → 重要的人 / 行为 → 主题 / 情绪 → 记忆」关系拓扑。
- 支持搜索、类型筛选、拖拽缩放、点击详情。
- 左侧心情曲线 / 需求 / 内心活动 / 最近触发。
- 心情 SSE 实时推送，关系图与事件每 2 秒增量同步。

### 验证

- test-purpose-engine: 24/24
- test-purpose-wiring: 8/8
- npm run test:audit: 101/102（唯一失败为既有 ffprobe/ffmpeg 环境项）
