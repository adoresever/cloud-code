# TODO

> Maintained by **AGI_Ananas**

## OpenAI-compat Adapter

- [x] Request format conversion (system/messages/tools)
- [x] Streaming SSE conversion (OpenAI → Anthropic events)
- [x] Tool call support (bidirectional)
- [x] Thinking model support (DeepSeek R1 / QwQ)
- [x] Interactive setup UI (provider select + input)
- [x] Config persistence (~/.claude.json)
- [x] Auto-load config on startup
- [x] URL smart handling (/v1 suffix)
- [ ] Image/multimodal testing with third-party models
- [ ] More provider presets
- [ ] `/model` command to switch models without re-login

## WeChat Bridge (iLink Bot)

- [x] iLink protocol SDK (zero-dependency)
- [x] QR code login + credential persistence
- [x] Text message send/receive (auto-chunking)
- [x] Image send/receive (CDN AES-128-ECB encrypt/decrypt)
- [x] File send/receive (PDF/DOC/ZIP etc.)
- [x] Video send/receive (CDN encrypt/decrypt)
- [x] Voice receive (auto-transcribe via WeChat)
- [x] Typing status ("正在输入中")
- [x] 24h token auto-reconnect
- [x] Long message chunking (1800 char threshold)
- [ ] Multi-turn conversation support (--resume / session persistence)
- [ ] Voice send (SILK encoding)
- [ ] Thumbnail support for image/video upload
- [ ] Slash commands in WeChat (/new, /model, /mode)
- [ ] Multiple WeChat account support
- [ ] Run as daemon (systemd / launchd)

## Packages

- [x] `url-handler-napi` — URL handler
- [x] `modifiers-napi` — Modifier key detection
- [x] `audio-capture-napi` — Audio capture
- [x] `color-diff-napi` — Color diff (full TS implementation)
- [x] `image-processor-napi` — Image processor