/**
 * ilink.ts — 微信 iLink Bot API 协议封装
 * 
 * 封装所有与 ilinkai.weixin.qq.com 的 HTTP 通信：
 * - QR 扫码登录
 * - getupdates 长轮询
 * - sendmessage 发送
 * - sendtyping 输入状态
 * - getuploadurl + CDN 上传
 * - CDN 下载
 * 
 * 零外部依赖，纯 Node.js / Bun 原生 API
 */

import crypto from "crypto";

// ============================================================
// 类型定义
// ============================================================

export interface ILinkCredentials {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
  savedAt: string;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;    // 1=USER, 2=BOT
  message_state?: number;   // 0=NEW, 1=GENERATING, 2=FINISH
  context_token?: string;
  item_list?: MessageItem[];
}

export interface MessageItem {
  type?: number;  // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO
  text_item?: { text?: string };
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  ref_msg?: { title?: string; message_item?: MessageItem };
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;          // 16字节 hex (32 hex chars)
  mid_size?: number;
  thumb_size?: number;
  thumb_width?: number;
  thumb_height?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;     // 6=SILK
  playtime?: number;
  text?: string;            // 语音转文字
  sample_rate?: number;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_width?: number;
  thumb_height?: number;
}

export interface GetUpdatesResult {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  sync_buf?: string;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";
const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
const POLL_TIMEOUT = 40_000;

// ============================================================
// 工具函数
// ============================================================

function randomUin(): string {
  const val = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(val), "utf8").toString("base64");
}

function genClientId(): string {
  return `ccbridge-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function genFileKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

function genAesKey(): { keyBuf: Buffer; keyHex: string } {
  const keyBuf = crypto.randomBytes(16);
  return { keyBuf, keyHex: keyBuf.toString("hex") };
}

// ============================================================
// AES-128-ECB 加解密
// ============================================================

export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * 解析 aes_key（兼容两种编码格式）
 * 格式A: base64(raw 16 bytes)  → 解码后 16 字节
 * 格式B: base64(hex string)    → 解码后 32 字节 hex → 再 hex decode 成 16 字节
 */
export function parseAesKey(aesKeyB64?: string, aesKeyHex?: string): Buffer | null {
  // 优先用 hex 格式（image_item.aeskey）
  if (aesKeyHex && /^[0-9a-f]{32}$/i.test(aesKeyHex)) {
    return Buffer.from(aesKeyHex, "hex");
  }
  if (!aesKeyB64) return null;
  const decoded = Buffer.from(aesKeyB64, "base64");
  if (decoded.length === 16) {
    return decoded; // 格式A
  }
  if (decoded.length === 32) {
    const hexStr = decoded.toString("utf8");
    if (/^[0-9a-f]{32}$/i.test(hexStr)) {
      return Buffer.from(hexStr, "hex"); // 格式B
    }
  }
  return decoded.subarray(0, 16); // fallback
}

/** 计算 AES-128-ECB + PKCS7 填充后的密文大小 */
export function ciphertextSize(rawSize: number): number {
  return Math.ceil((rawSize + 1) / 16) * 16;
}

// ============================================================
// ILink 客户端类
// ============================================================

export class ILinkClient {
  private credentials: ILinkCredentials;

  constructor(credentials: ILinkCredentials) {
    this.credentials = credentials;
  }

  get token() { return this.credentials.token; }
  get baseUrl() { return this.credentials.baseUrl; }
  get accountId() { return this.credentials.accountId; }
  get userId() { return this.credentials.userId; }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Authorization": `Bearer ${this.credentials.token}`,
      "X-WECHAT-UIN": randomUin(),
    };
  }

  // ---- 登录 ----

  static async getQRCode(): Promise<{ qrcode: string; url: string }> {
    const res = await fetch(`${DEFAULT_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`);
    const data = (await res.json()) as any;
    return { qrcode: data.qrcode, url: data.qrcode_img_content };
  }

  static async pollQRStatus(qrcode: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40_000);
    try {
      const res = await fetch(
        `${DEFAULT_BASE}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`,
        { headers: { "iLink-App-ClientVersion": "1" }, signal: ctrl.signal }
      );
      return (await res.json()) as any;
    } catch {
      return { status: "wait" };
    } finally {
      clearTimeout(timer);
    }
  }

  static async login(): Promise<ILinkCredentials> {
    const { qrcode, url } = await ILinkClient.getQRCode();
    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║  请用微信扫描以下链接中的二维码完成登录：   ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log(`\n  ${url}\n`);

    while (true) {
      const result = await ILinkClient.pollQRStatus(qrcode);
      if (result.status === "confirmed") {
        return {
          token: result.bot_token,
          baseUrl: result.baseurl || DEFAULT_BASE,
          accountId: result.ilink_bot_id,
          userId: result.ilink_user_id,
          savedAt: new Date().toISOString(),
        };
      }
      if (result.status === "scaned") console.log("  已扫码，等待确认...");
      if (result.status === "expired") {
        console.log("  二维码已过期，重新获取...");
        return ILinkClient.login();
      }
    }
  }

  // ---- 消息收发 ----

  async getUpdates(buf: string): Promise<GetUpdatesResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), POLL_TIMEOUT);
    try {
      const res = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          get_updates_buf: buf,
          base_info: { channel_version: "1.0.0" },
        }),
        signal: ctrl.signal,
      });
      return (await res.json()) as any;
    } catch {
      return {}; // 超时 = 空轮询
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(toUserId: string, contextToken: string, items: MessageItem[]) {
    await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: genClientId(),
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: items,
        },
        base_info: { channel_version: "1.0.0" },
      }),
    });
  }

  async sendText(toUserId: string, contextToken: string, text: string) {
    text = text.trim();
    if (!text) return;

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 1800) {
      let cut = remaining.lastIndexOf("\n\n", 1800);
      if (cut < 100) cut = remaining.lastIndexOf("\n", 1800);
      if (cut < 100) cut = remaining.lastIndexOf(" ", 1800);
      if (cut < 100) cut = 1800;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining) chunks.push(remaining);

    for (const chunk of chunks) {
      await this.sendMessage(toUserId, contextToken, [
        { type: 1, text_item: { text: chunk } },
      ]);
      if (chunks.length > 1) await sleep(500);
    }
  }

  // ---- Typing ----

  async getTypingTicket(userId: string, contextToken: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          ilink_user_id: userId,
          context_token: contextToken,
          base_info: { channel_version: "1.0.0" },
        }),
      });
      const data = (await res.json()) as any;
      if ((data.ret === 0 || data.ret === undefined) && data.typing_ticket) {
        return data.typing_ticket;
      }
    } catch {}
    return null;
  }

  async sendTyping(userId: string, ticket: string, status: 1 | 2) {
    try {
      await fetch(`${this.baseUrl}/ilink/bot/sendtyping`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          ilink_user_id: userId,
          typing_ticket: ticket,
          status,
          base_info: { channel_version: "1.0.0" },
        }),
      });
    } catch {}
  }

  // ---- CDN 媒体 ----

  async getUploadUrl(params: {
    filekey: string;
    media_type: number; // 1=IMAGE, 2=VIDEO, 3=FILE, 4=VOICE
    to_user_id: string;
    rawsize: number;
    rawfilemd5: string;
    filesize: number;
    aeskey: string;
  }): Promise<{ upload_param: string; thumb_upload_param?: string }> {
    const res = await fetch(`${this.baseUrl}/ilink/bot/getuploadurl`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...params,
        no_need_thumb: true,
        base_info: { channel_version: "1.0.0" },
      }),
    });
    return (await res.json()) as any;
  }

  async uploadToCDN(uploadParam: string, filekey: string, encryptedData: Buffer): Promise<string> {
    const url = `${CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${filekey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: encryptedData,
    });
    // encrypt_query_param 在响应头 x-encrypted-param 中
    const encryptedParam = res.headers.get("x-encrypted-param") || "";
    return encryptedParam;
  }

  async downloadFromCDN(encryptQueryParam: string): Promise<Buffer> {
    const url = `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
    const res = await fetch(url);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  /**
   * 上传媒体文件的完整流程:
   * 1. 生成 AES key
   * 2. 加密文件
   * 3. getuploadurl
   * 4. 上传到 CDN
   * 返回: { encryptQueryParam, aesKeyB64, aesKeyHex, cipherSize }
   */
  async uploadMedia(
    fileData: Buffer,
    mediaType: number,
    toUserId: string
  ): Promise<{
    encryptQueryParam: string;
    aesKeyB64: string;
    aesKeyHex: string;
    cipherSize: number;
  }> {
    const { keyBuf, keyHex } = genAesKey();
    const encrypted = encryptAesEcb(fileData, keyBuf);
    const filekey = genFileKey();
    const md5 = crypto.createHash("md5").update(fileData).digest("hex");

    const { upload_param } = await this.getUploadUrl({
      filekey,
      media_type: mediaType,
      to_user_id: toUserId,
      rawsize: fileData.length,
      rawfilemd5: md5,
      filesize: encrypted.length,
      aeskey: keyHex,
    });

    const encryptQueryParam = await this.uploadToCDN(upload_param, filekey, encrypted);

    // aes_key 用 base64(hex string) 格式（和腾讯官方 openclaw 一致）
    const aesKeyB64 = Buffer.from(keyHex, "utf8").toString("base64");

    return { encryptQueryParam, aesKeyB64, aesKeyHex: keyHex, cipherSize: encrypted.length };
  }

  /**
   * 下载并解密 CDN 媒体文件
   */
  async downloadMedia(cdnMedia: CDNMedia, fallbackAesKeyHex?: string): Promise<Buffer | null> {
    if (!cdnMedia.encrypt_query_param) return null;
    const key = parseAesKey(cdnMedia.aes_key, fallbackAesKeyHex);
    if (!key) return null;

    const encrypted = await this.downloadFromCDN(cdnMedia.encrypt_query_param);
    return decryptAesEcb(encrypted, key);
  }

  // ---- 发送媒体消息 ----

  async sendImage(toUserId: string, contextToken: string, imageData: Buffer) {
    const upload = await this.uploadMedia(imageData, 1, toUserId);
    await this.sendMessage(toUserId, contextToken, [{
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: upload.encryptQueryParam,
          aes_key: upload.aesKeyB64,
          encrypt_type: 1,
        },
        mid_size: upload.cipherSize,
      },
    }]);
  }

  async sendFile(toUserId: string, contextToken: string, fileData: Buffer, fileName: string) {
    const upload = await this.uploadMedia(fileData, 3, toUserId);
    const md5 = crypto.createHash("md5").update(fileData).digest("hex");
    await this.sendMessage(toUserId, contextToken, [{
      type: 4,
      file_item: {
        media: {
          encrypt_query_param: upload.encryptQueryParam,
          aes_key: upload.aesKeyB64,
          encrypt_type: 1,
        },
        file_name: fileName,
        md5,
        len: String(fileData.length),
      },
    }]);
  }

  async sendVideo(toUserId: string, contextToken: string, videoData: Buffer) {
    const upload = await this.uploadMedia(videoData, 2, toUserId);
    const md5 = crypto.createHash("md5").update(videoData).digest("hex");
    await this.sendMessage(toUserId, contextToken, [{
      type: 5,
      video_item: {
        media: {
          encrypt_query_param: upload.encryptQueryParam,
          aes_key: upload.aesKeyB64,
          encrypt_type: 1,
        },
        video_size: upload.cipherSize,
        video_md5: md5,
      },
    }]);
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
