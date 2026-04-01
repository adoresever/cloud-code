# Cloud Code (OpenAI Compatible Fork)

基于 Claude Code CLI 逆向还原项目的二次开发版本，**新增 OpenAI 兼容 API 适配层** + **微信远程控制桥接**。

> Maintained by **AGI_Ananas**
>
> 原始逆向工程基础来自社区，本仓库在此基础上实现了第三方模型接入能力和微信远程控制。

## 功能特性

- **OpenAI 兼容 API 适配层** — 接入 DeepSeek、MiniMax、Ollama、优云智算等任意 OpenAI 兼容 API
- **微信远程控制** — 通过腾讯官方 iLink Bot API（ClawBot 插件），在手机微信中远程操控 cloud-code
- 支持文字、图片、文件、语音、视频的收发
- 零外部依赖（微信桥接），纯 Bun 原生 API

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) >= 1.3.11（必须最新版，`bun upgrade`）
- Node.js >= 18
- 微信 iOS 最新版 + ClawBot 插件（我 → 设置 → 插件 → ClawBot）

### 安装 & 运行

```bash
bun install
bun run dev
```

启动后选择第四个选项 `OpenAI-compatible API`，按引导输入 API 地址、Key、模型名即可：

```
Select login method:
  1. Claude account with subscription · Pro, Max, Team, or Enterprise
  2. Anthropic Console account · API usage billing
  3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI
❯ 4. OpenAI-compatible API · DeepSeek, Ollama, QwQ, etc.
```

配置自动保存到 `~/.claude.json`，下次启动无需重复输入。

### 环境变量方式（可选）

```bash
export CLAUDE_CODE_USE_OPENAI_COMPAT=1
export OPENAI_COMPAT_BASE_URL=https://api.deepseek.com
export OPENAI_COMPAT_API_KEY=sk-xxx
export OPENAI_COMPAT_MODEL=deepseek-chat
bun run dev
```

## 微信远程控制

在手机微信中远程控制电脑上的 cloud-code，基于腾讯官方 iLink Bot API，**不会封号**。

### 使用方法

```bash
# 启动微信桥接（首次会显示二维码，微信扫码）
bun run wechat

# 强制重新扫码
bun run wechat:login
```

扫码成功后，在微信中给 ClawBot 发消息即可远程使用 cloud-code。

### 支持的消息类型

| 类型 | 入站（微信→Bot） | 出站（Bot→微信） |
|:----:|:---:|:---:|
| 文字 | ✅ 自动分片 | ✅ 自动分片 |
| 图片 | ✅ CDN 下载解密 | ✅ CDN 加密上传 |
| 文件 | ✅ 任意文件类型 | ✅ 任意文件类型 |
| 语音 | ✅ 自动转文字 | — |
| 视频 | ✅ CDN 下载解密 | ✅ CDN 加密上传 |

### 架构

```
手机微信 ──发消息──→ iLink API (ilinkai.weixin.qq.com)
                         ↑ HTTP 长轮询
                     wechat-bridge.ts
                         ↓ spawn bun -p
                     cloud-code CLI
                         ↓
                     OpenAI 兼容适配层 → LLM API
                         ↓
                     stdout → sendmessage → 微信
```

### 技术细节

- 协议: 腾讯官方 iLink Bot API（HTTP/JSON，非逆向）
- 媒体加密: AES-128-ECB + PKCS7 padding
- CDN: `novac2c.cdn.weixin.qq.com/c2c`
- Token 有效期: 24 小时，过期自动提示重新扫码
- 凭证存储: `~/.wechat-bridge/`（不在项目目录内）

## OpenAI 兼容 API 适配层

### 支持的 API 提供商

| 提供商 | Base URL | 示例模型 |
|--------|----------|----------|
| 优云智算 | `https://api.modelverse.cn/v1` | MiniMax-M2.5, gpt-5.4 |
| DeepSeek | `https://api.deepseek.com` | deepseek-chat, deepseek-reasoner |
| Ollama | `http://localhost:11434` | qwen2.5:7b, llama3 |
| 任意 OpenAI 兼容 API | 自定义 URL | 自定义模型名 |

### 适配层架构

适配层位于 `src/services/api/openai-compat/`，通过 duck-typing 伪装 Anthropic SDK 客户端，上游代码零改动：

```
claude.ts → getAnthropicClient() → createOpenAICompatClient()
  ├─ request-adapter.ts: Anthropic params → OpenAI params
  ├─ fetch() → 第三方 API
  └─ stream-adapter.ts: OpenAI SSE → Anthropic 事件流
```

## 项目结构

```
cloud-code/
├── src/
│   ├── entrypoints/cli.tsx                # 入口（含 OpenAI 配置自动加载）
│   ├── services/api/
│   │   ├── client.ts                      # Provider 选择（含 openai_compat 分支）
│   │   └── openai-compat/                 # OpenAI 兼容适配层
│   │       ├── index.ts                   # 伪 Anthropic 客户端
│   │       ├── request-adapter.ts         # 请求格式转换
│   │       ├── stream-adapter.ts          # 流式响应转换
│   │       └── thinking-adapter.ts        # 思考模型适配
│   └── components/
│       └── OpenAICompatSetup.tsx          # 交互式配置界面
├── scripts/
│   ├── wechat-bridge.ts                   # 微信桥接主脚本
│   └── ilink.ts                           # iLink 协议封装
├── CLAUDE.md
├── README.md
├── RECORD.md
└── TODO.md
```

## 其他命令

```bash
# 管道模式
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# 构建
bun run build
```

## 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。