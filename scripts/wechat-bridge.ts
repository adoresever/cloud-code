#!/usr/bin/env bun
/**
 * wechat-bridge.ts — 微信 iLink Bot ↔ cloud-code 桥接
 *
 * 功能:
 *   - 文字消息收发（自动分片）
 *   - 图片收发（CDN AES-128-ECB 加解密）
 *   - 文件收发（PDF/DOC/ZIP 等任意文件）
 *   - 语音接收（SILK 自动转文字 + 原始音频保存）
 *   - 视频收发（CDN 加解密）
 *   - Typing 状态（"对方正在输入中"）
 *   - 24h Token 过期自动提示重新扫码
 *
 * 用法:
 *   bun run scripts/wechat-bridge.ts              # 启动（有凭证自动连，无则扫码）
 *   bun run scripts/wechat-bridge.ts --login      # 强制重新扫码
 *
 * 架构:
 *   微信用户 → iLink API → [本脚本] → bun run cli.tsx -p → OpenAI适配层 → LLM API
 *
 * 开源协议: MIT
 */

import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir, tmpdir } from "os";
import {
  ILinkClient,
  parseAesKey,
  decryptAesEcb,
  type ILinkCredentials,
  type WeixinMessage,
  type MessageItem,
} from "./ilink.js";

// ============================================================
// 配置 — 通过环境变量或自动检测
// ============================================================

/** cloud-code 源码根目录（自动检测：脚本所在目录的上一级） */
const CLOUD_CODE_DIR = process.env.CLOUD_CODE_DIR || resolve(dirname(new URL(import.meta.url).pathname), "..");

/** cloud-code CLI 入口 */
const CLI_ENTRY = join(CLOUD_CODE_DIR, "src/entrypoints/cli.tsx");

/** 状态存储目录 */
const STATE_DIR = process.env.WECHAT_BRIDGE_STATE_DIR || join(homedir(), ".wechat-bridge");

/** 媒体临时目录 */
const MEDIA_DIR = join(STATE_DIR, "media");

/** cloud-code 超时（毫秒），默认 5 分钟 */
const CC_TIMEOUT = parseInt(process.env.CC_TIMEOUT || "300000", 10);

// ============================================================
// 状态
// ============================================================

let client: ILinkClient | null = null;
let getUpdatesBuf = "";
let contextTokens: Record<string, string> = {};
let typingTickets: Record<string, { ticket: string; at: number }> = {};
let isRunning = true;

// ============================================================
// 工具函数
// ============================================================

function log(tag: string, ...args: any[]) {
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${ts}][${tag}]`, ...args);
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function credPath() { return join(STATE_DIR, "credentials.json"); }
function cursorPath() { return join(STATE_DIR, "cursor.json"); }

function saveCred(cred: ILinkCredentials) {
  ensureDir(STATE_DIR);
  writeFileSync(credPath(), JSON.stringify(cred, null, 2));
}

function loadCred(): ILinkCredentials | null {
  try { return JSON.parse(readFileSync(credPath(), "utf-8")); } catch { return null; }
}

function saveCursor(buf: string) {
  ensureDir(STATE_DIR);
  writeFileSync(cursorPath(), JSON.stringify({ buf }));
}

function loadCursor(): string {
  try { return JSON.parse(readFileSync(cursorPath(), "utf-8")).buf || ""; } catch { return ""; }
}

function clearState() {
  getUpdatesBuf = "";
  contextTokens = {};
  typingTickets = {};
  try { writeFileSync(cursorPath(), "{}"); } catch {}
}

// ============================================================
// Typing 管理
// ============================================================

async function startTyping(userId: string) {
  const ctx = contextTokens[userId];
  if (!ctx || !client) return;

  let cached = typingTickets[userId];
  if (!cached || Date.now() - cached.at > 23 * 3600_000) {
    const ticket = await client.getTypingTicket(userId, ctx);
    if (!ticket) return;
    cached = { ticket, at: Date.now() };
    typingTickets[userId] = cached;
  }
  await client.sendTyping(userId, cached.ticket, 1);
}

async function stopTyping(userId: string) {
  const cached = typingTickets[userId];
  if (!cached || !client) return;
  await client.sendTyping(userId, cached.ticket, 2);
}

// ============================================================
// cloud-code 调用
// ============================================================

function callCloudCode(prompt: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", CLI_ENTRY, "-p", prompt], {
      cwd: cwd || CLOUD_CODE_DIR,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });

    proc.on("close", (code) => {
      if (code === 0 || stdout.trim()) resolve(stdout.trim());
      else reject(new Error(`exit ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on("error", reject);

    setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch {}
      reject(new Error("cloud-code 超时"));
    }, CC_TIMEOUT);
  });
}

// ============================================================
// 媒体消息处理
// ============================================================

/**
 * 下载入站媒体文件并保存到临时目录
 */
async function downloadInboundMedia(
  item: MessageItem,
  type: "image" | "voice" | "file" | "video"
): Promise<{ path: string; fileName: string } | null> {
  if (!client) return null;
  ensureDir(MEDIA_DIR);

  let media = null;
  let fallbackHex: string | undefined;
  let fileName = `${type}_${Date.now()}`;

  switch (type) {
    case "image":
      media = item.image_item?.media;
      fallbackHex = item.image_item?.aeskey;
      fileName += ".jpg";
      break;
    case "voice":
      media = item.voice_item?.media;
      fileName += ".silk";
      break;
    case "file":
      media = item.file_item?.media;
      fileName = item.file_item?.file_name || fileName + ".bin";
      break;
    case "video":
      media = item.video_item?.media;
      fileName += ".mp4";
      break;
  }

  if (!media?.encrypt_query_param) return null;

  try {
    const key = parseAesKey(media.aes_key, fallbackHex);
    if (!key) {
      log("MEDIA", `无法解析 AES key (${type})`);
      return null;
    }

    const encrypted = await client.downloadFromCDN(media.encrypt_query_param);
    const decrypted = decryptAesEcb(encrypted, key);

    const filePath = join(MEDIA_DIR, fileName);
    writeFileSync(filePath, decrypted);
    log("MEDIA", `↓ 已下载 ${type}: ${fileName} (${decrypted.length} bytes)`);
    return { path: filePath, fileName };
  } catch (err: any) {
    log("MEDIA", `下载 ${type} 失败: ${err.message}`);
    return null;
  }
}

// ============================================================
// 消息处理主逻辑
// ============================================================

async function handleMessage(msg: WeixinMessage) {
  if (msg.message_type !== 1) return; // 只处理用户消息

  const userId = msg.from_user_id;
  const ctx = msg.context_token;
  if (!userId || !ctx || !client) return;

  contextTokens[userId] = ctx;
  const items = msg.item_list || [];

  // 提取消息内容
  let textParts: string[] = [];
  let mediaFiles: { path: string; fileName: string; type: string }[] = [];

  for (const item of items) {
    switch (item.type) {
      case 1: // 文字
        if (item.text_item?.text) textParts.push(item.text_item.text);
        break;

      case 2: { // 图片
        const img = await downloadInboundMedia(item, "image");
        if (img) {
          mediaFiles.push({ ...img, type: "image" });
          textParts.push(`[收到图片: ${img.fileName}，已保存到 ${img.path}]`);
        }
        break;
      }

      case 3: // 语音
        if (item.voice_item?.text) {
          // 微信自动转写的文字
          textParts.push(item.voice_item.text);
          log("MSG", `[语音转文字] ${item.voice_item.text}`);
        }
        // 同时保存原始音频
        const voice = await downloadInboundMedia(item, "voice");
        if (voice) {
          mediaFiles.push({ ...voice, type: "voice" });
        }
        break;

      case 4: { // 文件
        const file = await downloadInboundMedia(item, "file");
        if (file) {
          mediaFiles.push({ ...file, type: "file" });
          textParts.push(`[收到文件: ${file.fileName}，已保存到 ${file.path}]`);
        }
        break;
      }

      case 5: { // 视频
        const video = await downloadInboundMedia(item, "video");
        if (video) {
          mediaFiles.push({ ...video, type: "video" });
          textParts.push(`[收到视频: ${video.fileName}，已保存到 ${video.path}]`);
        }
        break;
      }

      default:
        textParts.push(`[不支持的消息类型: ${item.type}]`);
    }
  }

  const fullText = textParts.join("\n").trim();
  if (!fullText) {
    await client.sendText(userId, ctx, "收到了消息，但无法解析内容");
    return;
  }

  const preview = fullText.slice(0, 80) + (fullText.length > 80 ? "..." : "");
  log("MSG", `← [${userId.slice(0, 12)}...] ${preview}`);

  // 显示"正在输入"
  await startTyping(userId);

  try {
    const reply = await callCloudCode(fullText);
    await stopTyping(userId);

    if (reply) {
      const replyPreview = reply.slice(0, 80) + (reply.length > 80 ? "..." : "");
      log("MSG", `→ [${userId.slice(0, 12)}...] ${replyPreview}`);
      await client.sendText(userId, ctx, reply);
    } else {
      await client.sendText(userId, ctx, "（处理完成，无输出）");
    }
  } catch (err: any) {
    log("ERR", `cloud-code: ${err.message}`);
    await stopTyping(userId);
    await client.sendText(userId, ctx, `出错了: ${err.message.slice(0, 200)}`);
  }

  // 清理临时媒体文件
  for (const f of mediaFiles) {
    try { unlinkSync(f.path); } catch {}
  }
}

// ============================================================
// 主循环
// ============================================================

async function mainLoop() {
  log("POLL", "开始消息轮询...");
  let errors = 0;

  while (isRunning) {
    try {
      const result = await client!.getUpdates(getUpdatesBuf);

      // Session 过期
      if (result.ret === -14 || result.errcode === -14 || result.errmsg === "session timeout") {
        log("POLL", "⚠️ Session 过期，需重新扫码");
        clearState();
        const cred = await ILinkClient.login();
        saveCred(cred);
        client = new ILinkClient(cred);
        errors = 0;
        continue;
      }

      // 错误处理（ret 可能 undefined = 成功）
      if (result.ret !== undefined && result.ret !== null && result.ret !== 0) {
        log("POLL", `API 错误: ret=${result.ret} ${result.errmsg || ""}`);
        errors++;
        await new Promise(r => setTimeout(r, errors >= 3 ? 30_000 : 3_000));
        continue;
      }

      errors = 0;

      // 更新游标
      if (result.get_updates_buf) {
        getUpdatesBuf = result.get_updates_buf;
        saveCursor(getUpdatesBuf);
      }

      // 处理消息
      for (const msg of result.msgs || []) {
        handleMessage(msg).catch(e => log("ERR", `消息处理异常: ${e.message}`));
      }
    } catch (err: any) {
      log("POLL", `轮询异常: ${err.message}`);
      errors++;
      await new Promise(r => setTimeout(r, 3_000));
    }
  }
}

// ============================================================
// 入口
// ============================================================

async function main() {
  console.log("┌─────────────────────────────────────────────────┐");
  console.log("│  cloud-code 微信桥接 v2.0                       │");
  console.log("│  支持: 文字 · 图片 · 文件 · 语音 · 视频         │");
  console.log("│  协议: 腾讯官方 iLink Bot API (不会封号)        │");
  console.log("└─────────────────────────────────────────────────┘\n");

  // 检查 cloud-code
  if (!existsSync(CLI_ENTRY)) {
    console.error(`❌ 找不到 cloud-code: ${CLI_ENTRY}`);
    console.error(`   设置环境变量 CLOUD_CODE_DIR 或确保脚本在 cloud-code/scripts/ 下`);
    process.exit(1);
  }
  log("INIT", `cloud-code: ${CLOUD_CODE_DIR}`);

  // 登录
  const forceLogin = process.argv.includes("--login");
  let cred = forceLogin ? null : loadCred();

  if (cred) {
    log("INIT", `已有凭证: ${cred.accountId} (${cred.savedAt})`);
  } else {
    cred = await ILinkClient.login();
    saveCred(cred);
    log("INIT", `✅ 登录成功: ${cred.accountId}`);
  }

  client = new ILinkClient(cred);
  getUpdatesBuf = loadCursor();

  // 优雅退出
  const exit = () => { isRunning = false; process.exit(0); };
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);

  log("INIT", "✅ 就绪，在微信中给 ClawBot 发消息即可");
  log("INIT", "   Ctrl+C 退出\n");

  await mainLoop();
}

main().catch(e => { console.error("致命错误:", e); process.exit(1); });
