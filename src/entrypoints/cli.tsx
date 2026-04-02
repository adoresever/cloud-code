// Runtime polyfill for bun:bundle (build-time macros)
// Must be BEFORE any import that uses feature()

// resolves everywhere, not just in this file.
if (typeof globalThis.MACRO === "undefined") {
    (globalThis as any).MACRO = {
        VERSION: "2.1.888",
        BUILD_TIME: new Date().toISOString(),
        FEEDBACK_CHANNEL: "",
        ISSUES_EXPLAINER: "",
        NATIVE_PACKAGE_URL: "",
        PACKAGE_URL: "",
        VERSION_CHANGELOG: "",
    };
}
(globalThis as any).BUILD_TARGET = "external";
(globalThis as any).BUILD_ENV = "production";
(globalThis as any).INTERFACE_TYPE = "stdio";

process.env.COREPACK_ENABLE_AUTO_PIN = "0";

if (!process.env.CLAUDE_CODE_USE_OPENAI_COMPAT) {
  try {
    const _fs = require("fs"), _os = require("os"), _path = require("path");
    const _p = _path.join(_os.homedir(), ".claude.json");
    if (_fs.existsSync(_p)) {
      const _d = JSON.parse(_fs.readFileSync(_p, "utf-8"));
      if (_d.openaiCompat && _d.openaiCompat.baseUrl) {
        process.env.CLAUDE_CODE_USE_OPENAI_COMPAT = "1";
        process.env.OPENAI_COMPAT_BASE_URL = _d.openaiCompat.baseUrl;
        process.env.OPENAI_COMPAT_API_KEY = _d.openaiCompat.apiKey || "";
        process.env.OPENAI_COMPAT_MODEL = _d.openaiCompat.model || "";
      }
    }
  } catch (_e) {}
}

if (process.env.CLAUDE_CODE_REMOTE === "true") {
    const existing = process.env.NODE_OPTIONS || "";
    process.env.NODE_OPTIONS = existing
        ? `${existing} --max-old-space-size=8192`
        : "--max-old-space-size=8192";
}

if (false && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
    for (const k of [
        "CLAUDE_CODE_SIMPLE",
        "CLAUDE_CODE_DISABLE_THINKING",
        "DISABLE_INTERLEAVED_THINKING",
        "DISABLE_COMPACT",
        "DISABLE_AUTO_COMPACT",
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
        "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS",
    ]) {
        process.env[k] ??= "1";
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (
        args.length === 1 &&
        (args[0] === "--version" || args[0] === "-v" || args[0] === "-V")
    ) {
        console.log(`${MACRO.VERSION} (Claude Code)`);
        return;
    }

    const { profileCheckpoint } = await import("../utils/startupProfiler.js");
    profileCheckpoint("cli_entry");

    if (args.includes("--bare")) {
        process.env.CLAUDE_CODE_SIMPLE = "1";
    }

    if (
        args.length === 1 &&
        (args[0] === "--update" || args[0] === "--upgrade")
    ) {
        process.argv = [process.argv[0]!, process.argv[1]!, "update"];
    }

    const { startCapturingEarlyInput } = await import("../utils/earlyInput.js");
    startCapturingEarlyInput();
    profileCheckpoint("cli_before_main_import");
    const { main: cliMain } = await import("../main.jsx");
    profileCheckpoint("cli_after_main_import");
    await cliMain();
    profileCheckpoint("cli_after_main_complete");
}

void main();
