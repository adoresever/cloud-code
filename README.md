# Cloud Code (OpenAI Compatible Fork)

基于 Claude Code CLI 逆向还原项目的二次开发版本，**新增 OpenAI 兼容 API 适配层** + **微信远程控制桥接**。

> Maintained by **AGI_Ananas**
>
> 原始逆向工程基础来自社区，本仓库在此基础上实现了第三方模型接入能力和微信远程控制。

## 功能特性

- **OpenAI 兼容 API 适配层** — 接入 DeepSeek、MiniMax、Ollama、优云智算等任意 OpenAI 兼容 API
- **微信远程控制** — 通过腾讯官方 iLink Bot API（ClawBot 插件），在手机微信中远程操控 cloud-code
- **🐾 /buddy 宠物系统** — 已解锁 Claude Code 隐藏的 Tamagotchi 终端宠物，18 物种 × 5 稀有度 × Shiny，支持暴力搜索最稀有组合
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
│   ├── buddy/                             # 🐾 Tamagotchi 宠物系统（已解锁）
│   │   ├── companion.ts                   # 确定性抽卡逻辑（Mulberry32 PRNG）
│   │   ├── CompanionSprite.tsx            # 终端精灵渲染（React + Ink）
│   │   ├── sprites.ts                     # 18 物种 × 3 帧 ASCII art
│   │   ├── types.ts                       # 物种/稀有度/属性类型定义
│   │   ├── prompt.ts                      # Companion 提示词注入
│   │   └── useBuddyNotification.tsx       # 彩虹通知 hook
│   ├── commands/
│   │   └── buddy/index.ts                 # /buddy 命令实现（已补全）
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

## 🐾 /buddy 宠物系统（已解锁）

2026年3月31日 Claude Code v2.1.88 源码泄露事件中，社区在 `src/buddy/` 目录发现了一个完整但被编译时 flag 隐藏的 **Tamagotchi 风格终端宠物系统**。本项目已将其完整解锁——你的 AI 编程助手现在有了一只会卖萌的伙伴。

### 它长什么样？

```
                                                                              -+-
❯ 帮我重构这个函数                                                           /^\  /^\
  ⎿  好的，让我看看这个函数的结构…                                          <  @  @  >
                                                                            (   ~~   )
                                                                             `-vvvv-´
                                                                              Ember
```

宠物常驻在终端右侧，有 3 帧待机动画（500ms/帧）。宽终端（≥100列）显示完整 ASCII 精灵 + 语音气泡；窄终端压缩为一行脸部表情。用 `/buddy pet` 撸它时会飘出爱心动画。

### 物种图鉴

共 **18 个物种**，每个都有独立的 5 行×12 字符 ASCII art 和 3 帧动画：

| 物种 | 脸 | 特点 |
|------|:---:|------|
| 🦆 duck | `(·>` | 经典小黄鸭，尾巴会摇 |
| 🪿 goose | `(·>` | 脖子会伸缩，有攻击性 |
| 🫧 blob | `(··)` | 会膨胀收缩的果冻 |
| 🐱 cat | `=·ω·=` | ω 嘴，尾巴会晃 |
| 🐉 dragon | `<·~·>` | 头顶冒烟，有翅膀 |
| 🐙 octopus | `~(··)~` | 触手会交替摆动 |
| 🦉 owl | `(·)(·)` | 大眼睛，会眨眼 |
| 🐧 penguin | `(·>)` | 翅膀会拍 |
| 🐢 turtle | `[·_·]` | 壳上花纹会变 |
| 🐌 snail | `·(@)` | 壳上有螺旋纹 |
| 👻 ghost | `/··\` | 底部波浪飘动 |
| 🦎 axolotl | `}·.·{` | 腮会左右摆动 |
| 🫏 capybara | `(·oo·)` | 最大号的脸 |
| 🌵 cactus | `\|·  ·\|` | 手臂会上下 |
| 🤖 robot | `[··]` | 天线会闪 |
| 🐇 rabbit | `(··..)` | 耳朵会歪 |
| 🍄 mushroom | `\|·  ·\|` | 帽子斑点会变 |
| 🐈‍⬛ chonk | `(·.·)` | 大胖猫，尾巴摇 |

### 稀有度体系

| 稀有度 | 概率 | 颜色 | 星级 | 帽子 | 属性下限 |
|--------|:----:|:----:|:----:|:----:|:--------:|
| Common | 60% | 灰色 | ★ | 无 | 5 |
| Uncommon | 25% | 绿色 | ★★ | 随机 | 15 |
| Rare | 10% | 蓝色 | ★★★ | 随机 | 25 |
| Epic | 4% | 金色 | ★★★★ | 随机 | 35 |
| **Legendary** | **1%** | **红色** | **★★★★★** | **随机** | **50** |

在此基础上，每只 buddy 还有独立的 **1% Shiny 概率**（发光特效）。

**最稀有的组合是 ✦ SHINY LEGENDARY — 总概率 0.01%（万分之一）。**

每只 buddy 还有 5 个属性：DEBUGGING、PATIENCE、CHAOS、WISDOM、SNARK。一个高峰属性（可达 100）、一个低谷属性（可低至 1）、其余随机分布。Legendary 的属性下限为 50，远高于 Common 的 5。

装饰系统包含 6 种眼型（`·` `✦` `×` `◉` `@` `°`）和 7 种帽子（crown 👑、tophat 🎩、propeller、halo、wizard 🧙、beanie、tinyduck 🦆）。

### 快速上手

```bash
# 启动（已默认配置 --feature=BUDDY）
bun run dev

# 孵化宠物（首次）或查看卡片
/buddy

# 撸宠物（飘爱心）
/buddy pet

# 隐藏 / 恢复
/buddy mute
/buddy unmute
```

### 解锁原理

仅需 **3 处改动**，不触碰任何核心功能代码：

| # | 文件 | 改动 | 说明 |
|:-:|------|------|------|
| ① | `package.json` | dev 命令加 `--feature=BUDDY` | Bun 原生运行时 flag，让 `feature('BUDDY')` 返回 true |
| ② | `src/commands/buddy/index.ts` | 从空 stub 补全为完整命令 | 泄露源码中此文件为自动生成的空壳 |
| ③ | `src/buddy/companion.ts` | 修改 SALT 值（可选） | 选择想要的 buddy 物种和稀有度 |

**对主体功能的影响：零。** `--feature=BUDDY` 仅解锁 buddy 子系统，代码编辑、API 通信、权限管理、会话管理等核心模块完全不受影响。唯一副作用是有 companion 时 system prompt 多注入约 5 行提示词（告诉模型旁边有只宠物）。

### 重新抽卡（换 buddy）

你的 buddy 由 `hash(userId + SALT)` 确定性生成——同一 userId + SALT 永远得到同一只。想换一只需要改种子：

```bash
# 1. 修改 SALT（数字随便换）
sed -i "s/const SALT = .*/const SALT = 'friend-2026-新数字'/" src/buddy/companion.ts

# 2. 清除旧 companion 数据
#    Linux / macOS:
bun -e "const fs=require('fs'),p=require('os').homedir()+'/.claude.json';
const c=JSON.parse(fs.readFileSync(p,'utf-8'));delete c.companion;
fs.writeFileSync(p,JSON.stringify(c,null,2));console.log('cleared')"

#    Windows (PowerShell):
bun -e "const fs=require('fs'),p=require('os').homedir()+'\\.claude.json';const c=JSON.parse(fs.readFileSync(p,'utf-8'));delete c.companion;fs.writeFileSync(p,JSON.stringify(c,null,2));console.log('cleared')"

# 3. 重启并输入 /buddy
bun run dev
```

### 暴力搜索最稀有的 buddy

不想靠运气？可以用脚本预先搜索哪个 SALT 值能出 Legendary 甚至 Shiny Legendary。

**第一步：获取你的 userId**

```bash
# Linux / macOS
grep userID ~/.claude.json

# Windows (PowerShell)
Select-String userID $env:USERPROFILE\.claude.json
```

**第二步：运行搜索脚本**

将下面脚本保存为 `search-buddy.mjs`，把 `uid` 替换为你的真实 userId：

```javascript
// search-buddy.mjs — 用 bun 运行: bun run search-buddy.mjs
const SPECIES = ['duck','goose','blob','cat','dragon','octopus','owl','penguin',
  'turtle','snail','ghost','axolotl','capybara','cactus','robot','rabbit','mushroom','chonk'];
const RARITIES = ['common','uncommon','rare','epic','legendary'];
const W = {common:60,uncommon:25,rare:10,epic:4,legendary:1};
const EYES = ['·','✦','×','◉','@','°'];
const HATS = ['none','crown','tophat','propeller','halo','wizard','beanie','tinyduck'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bunHash(s) { return Number(BigInt(Bun.hash(s)) & 0xffffffffn); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function rollRarity(rng) {
  let r = rng() * 100;
  for (const x of RARITIES) { r -= W[x]; if (r < 0) return x; }
  return 'common';
}

// ⚠️ 替换为你的真实 userId
const uid = '你的userID';
const MAX = 500000;

console.log(`Searching ${MAX} salts for user: ${uid.slice(0,16)}...`);
console.log('---');

let legendaryCount = 0;
for (let i = 0; i < MAX; i++) {
  const salt = 'friend-2026-' + i;
  const rng = mulberry32(bunHash(uid + salt));
  const rarity = rollRarity(rng);
  if (rarity !== 'legendary') continue;
  legendaryCount++;
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const hat = pick(rng, HATS);
  const shiny = rng() < 0.01;
  const tag = shiny ? '✦ SHINY ' : '';
  console.log(`${tag}LEGENDARY ${species} — eye:${eye} hat:${hat} — salt: "${salt}"`);
  if (shiny) {
    console.log(`\n🎉 SHINY LEGENDARY found! Total legendaries scanned: ${legendaryCount}`);
    console.log(`👉 Use this salt: ${salt}`);
    process.exit(0);
  }
}
console.log(`\nScanned ${MAX} salts, found ${legendaryCount} legendaries (no shiny). Try increasing MAX.`);
```

```bash
# ⚠️ 必须用 bun 运行（依赖 Bun.hash，Node.js 无此函数）
bun run search-buddy.mjs
```

**第三步：应用找到的 salt**

```bash
# 替换 SALT（以找到的值为例）
sed -i "s/const SALT = .*/const SALT = 'friend-2026-47899'/" src/buddy/companion.ts

# Windows (PowerShell) 等效命令：
(Get-Content src/buddy/companion.ts) -replace "const SALT = .*", "const SALT = 'friend-2026-47899'" | Set-Content src/buddy/companion.ts
```

然后清 companion、重启、`/buddy` 即可。

> **跨平台说明**：搜索脚本依赖 `Bun.hash()` 内置函数，此函数在 **Linux、macOS、Windows** 上的 Bun 运行时中行为一致，搜索结果跨平台通用。但 `sed` 命令在 Windows 上不可用，请使用上方提供的 PowerShell 等效命令。

### 只改名字和个性描述

不想换物种，只是想给宠物改个名字？直接编辑 config 文件：

```bash
# 查看当前 companion
grep -A5 companion ~/.claude.json      # Linux/macOS
Select-String companion $env:USERPROFILE\.claude.json   # Windows

# 手动编辑 ~/.claude.json 中的 companion.name 和 companion.personality 字段即可
```

> **注意**：外观（物种、稀有度、眼型、帽子）由 userId hash 实时计算，不存在 config 中，无法通过编辑 config 伪造。这是原版的防作弊设计。

## 许可证

本项目仅供学习研究用途。