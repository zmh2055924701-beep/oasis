# Oasis

**一个身份，多个身体。**

Oasis 让 QQ、B 站和桌宠共用同一套人格、记忆与情绪。  
它不是一个只会转发消息的机器人框架，而是一个有身份、有记忆、有情绪、有边界，能在不同身体里保持连续的本地 AI 伙伴。

---

## 亮点

- **一个身份，多个身体**  
  QQ、B 站、桌宠共享同一套角色卡、记忆、情绪和关系。

- **统一设置窗口**  
  QQ 桥接、B 站养趣、记忆、身份对齐、桌宠、Token 额度，都在一个窗口里管理。

- **双向脱敏记忆**  
  QQ 与 B 站之间的记忆可以互通，但敏感信息双向脱敏，原始记忆不直接暴露。

- **身份对齐**  
  QQ 里的她、B 站里的她、桌宠里的她，保持一致的身份与关系。

- **情绪与需求驱动**  
  不是固定时间排班，而是由情绪、需求、记忆和当前情境决定行动。

- **公共动作审批**  
  发动态、评论、分享等公开行为有额度、有审批、有硬上限，不会替你做未经授权的公开动作。

- **本地优先**  
  人格、记忆、配置和密钥默认留在本机；不会主动上传到第三方。

- **可扩展**  
  通过统一接口接入新的身体、平台和动作。

---

## 近期更新

### 2026-11-06

**目的系统生命周期**

- 目标与待续新增「短期 / 长期」区分，并记录事件日期、完成时间和完成来源。
- 新增真实的完成状态：模型明确完成、主人明确说已完成、事件日期到达、或手动完成时，目标会结案。
- 过期目标不再因为「曾经尝试过」而长期保留；待续事项也有短 TTL 和事件日期，过期自动关闭。
- 旧版本留下的短期目标、旧待续、旧 owner-topic 噪声会在启动迁移时清理；旧的「上次目的」不会继续影响下一轮。
- 选择器会对旧待续做年龄衰减，不再让很久以前的事情长期压过新目的。
- 新增手动完成接口与设置页「完成」按钮；目的状态现在会显示短期/长期标记。

**大脑页面 v2**

- 从脑区皮层画法改为「人格核心 → 重要的人 / 行为 → 主题 / 情绪 → 记忆」关系拓扑。
- 支持搜索、类型筛选、拖拽、缩放、点击记忆查看详情。
- 左侧保留心情曲线、需求条、内心活动和最近触发；最近触发改为可读卡片。
- 心情/需求走 SSE 实时推送，关系图和事件每 2 秒增量同步。

---

## 环境要求

- Windows 10 / 11
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 0.2.1 或更新版本
- Node.js >= 22.13.0
- QQ 功能需要自行安装并登录 SnowLuma 2（第三方运行时，不随本项目分发）
- B 站功能需要你自己的 B 站账号与登录状态

---

## 新手下载

不想用 git 的话，直接下载 Release 里的完整包：

```text
oasis-v0.9.2-public.zip
```

它已经包含源码、`vendor/semantic` 和 `vendor/dsh-pet`，解压即可继续安装。  
也可以点 Code → Download ZIP；仓库里同样包含 `vendor`。

> `node_modules` 不会打进仓库，下载后仍然需要执行 `npm install`。

## 安装

```powershell
git clone https://github.com/zmh2055924701-beep/oasis.git
cd oasis
npm install
node scripts/setup-dsh.mjs
```

也可以直接双击 `install.bat`，它会检查 Node、执行 `npm install` 并注册 DSH。

然后重启 DSH，打开：

```text
设置 → Oasis
```

> 插件依赖仓库根目录的 `src/`，不要只复制 `plugins/oasis` 单独安装。  
> 安装完成后如果设置页没有出现 Oasis，刷新页面或重启 DSH。

---

## 第一次使用

1. 打开 **设置 → Oasis**。
2. 在 QQ 页配置 SnowLuma 和 QQ 白名单。
3. 在 B 站页配置 B 站账号/登录状态与养趣参数。
4. 在角色页导入或创建自己的角色包。
5. 按需开启 QQ、B 站和桌宠。

默认数据目录：

```text
%USERPROFILE%\.dsh\oasis
```

---

## 数据与隐私

- 记忆、角色、配置、日志默认保存在本机。
- 本项目不包含真实 QQ 号、群号、B 站账号、角色卡或记忆。
- SnowLuma 是第三方专有运行时，本项目只通过 OneBot 协议与它通信，不包含其源码或二进制。
- 公开动作前可配置审批与每日额度。
- 建议定期备份 `%USERPROFILE%\.dsh\oasis`。

---

## 目录结构

```text
oasis/
├─ plugins/oasis/       DSH 插件、设置界面、presets
├─ src/                 QQ bridge、大脑、记忆、身份与 B 站核心
├─ scripts/             安装、启动、停止与隐私检查
├─ examples/            脱敏角色包示例
├─ config.example.json  配置模板
└─ LICENSE / NOTICE     许可与来源说明
```

---

## 常用命令

```powershell
npm start                 # 直接启动 QQ bridge
node scripts/setup-dsh.mjs
node scripts/privacy-scan.mjs
powershell -File scripts/stop-qq-bot.ps1
```

---

## 许可

MIT License。  
部分设计或代码参考自 SurfCore / qq-bridge / QSH；具体来源与版权声明见 [NOTICE.md](NOTICE.md) 和 [LICENSE](LICENSE)。

SnowLuma 及其相关运行时是第三方组件，不随本项目分发，使用前请阅读其自身许可。