import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ResolvedCodexSpawn {
  bin: string;
  useShell: boolean;
}

function getTargetTriple(): string | null {
  const { platform, arch } = process;
  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return null;
}

function findNativeCodexInPackage(pkgDir: string): string | null {
  const triple = getTargetTriple();
  if (!triple) return null;
  const exeName = process.platform === "win32" ? "codex.exe" : "codex";
  const platformPkg = `codex-${process.platform}-${process.arch}`;
  const candidates = [
    path.join(pkgDir, "node_modules", "@openai", platformPkg, "vendor", triple, "bin", exeName),
    path.join(path.dirname(pkgDir), platformPkg, "vendor", triple, "bin", exeName),
    path.join(pkgDir, "vendor", triple, "bin", exeName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolves the appropriate command and shell flag for spawning the Codex CLI binary.
 * On Windows, this resolves to the direct native codex.exe when available (bypassing cmd.exe)
 * or to codex.cmd with shell: true when only batch wrappers are installed.
 */
export function resolveCodexSpawn(customBin?: string): ResolvedCodexSpawn {
  const trimmed = customBin?.trim();

  // 1. Explicit path specified
  if (trimmed && trimmed !== "codex") {
    const isPathLike = path.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\");
    if (isPathLike && fs.existsSync(trimmed)) {
      if (/\.(cmd|bat)$/i.test(trimmed)) {
        // If pointing to a .cmd/.bat wrapper, check if the native binary is installed nearby
        const adjacentPkg = path.join(path.dirname(trimmed), "node_modules", "@openai", "codex");
        const nativeBin = findNativeCodexInPackage(adjacentPkg);
        if (nativeBin) return { bin: nativeBin, useShell: false };
        return { bin: trimmed, useShell: true };
      }
      return { bin: trimmed, useShell: false };
    }

    if (process.platform === "win32") {
      if (/\.(cmd|bat)$/i.test(trimmed)) return { bin: trimmed, useShell: true };
      if (/\.exe$/i.test(trimmed)) return { bin: trimmed, useShell: false };
    } else {
      return { bin: trimmed, useShell: false };
    }
  }

  // 2. Check local project node_modules
  const localPkg = path.resolve("node_modules/@openai/codex");
  const localNative = findNativeCodexInPackage(localPkg);
  if (localNative) return { bin: localNative, useShell: false };

  // 3. Platform specific resolution
  if (process.platform === "win32") {
    const localCmd = path.resolve("node_modules/.bin/codex.cmd");
    if (fs.existsSync(localCmd)) return { bin: localCmd, useShell: true };

    // Global APPDATA npm
    const appdata = process.env.APPDATA;
    if (appdata) {
      const globalPkg = path.join(appdata, "npm", "node_modules", "@openai", "codex");
      const globalNative = findNativeCodexInPackage(globalPkg);
      if (globalNative) return { bin: globalNative, useShell: false };

      const globalCmd = path.join(appdata, "npm", "codex.cmd");
      if (fs.existsSync(globalCmd)) return { bin: globalCmd, useShell: true };
    }

    // Search PATH directories
    const pathDelimiter = path.delimiter || ";";
    const pathDirs = (process.env.PATH || "").split(pathDelimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      const exeCandidate = path.join(dir, "codex.exe");
      if (fs.existsSync(exeCandidate)) return { bin: exeCandidate, useShell: false };

      const cmdCandidate = path.join(dir, "codex.cmd");
      if (fs.existsSync(cmdCandidate)) {
        const adjacentPkg = path.join(dir, "node_modules", "@openai", "codex");
        const nativeBin = findNativeCodexInPackage(adjacentPkg);
        if (nativeBin) return { bin: nativeBin, useShell: false };
        return { bin: cmdCandidate, useShell: true };
      }
    }

    return { bin: "codex.cmd", useShell: true };
  }

  // Linux / macOS
  const standardUnixPaths = [
    "/usr/bin/codex",
    "/usr/local/bin/codex",
    path.join(os.homedir(), ".local", "bin", "codex"),
  ];
  for (const candidate of standardUnixPaths) {
    if (fs.existsSync(candidate)) return { bin: candidate, useShell: false };
  }

  return { bin: trimmed || "codex", useShell: false };
}

/**
 * Returns the resolved binary path or command name.
 */
export function resolveCodexBinary(customBin?: string): string {
  return resolveCodexSpawn(customBin).bin;
}
