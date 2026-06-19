import fs from "fs";

import path from "path";
import esbuild from "esbuild";
const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

const SRC_DIR = "src";
const DIST_DIR = "distro";
const DEFAULT_TARGETS = ["chrome", "firefox", "safari"];

function getBuildTargets() {
  const rawTargets = process.env.BUILD_TARGETS;
  if (!rawTargets) return DEFAULT_TARGETS;

  return rawTargets
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
}

function copyDir(src, dest) {
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);

    if (item.endsWith("json") || item.endsWith("js")) {
      continue
    }
    // only copy non-script files
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyManifests(target) {
  const destDir = path.join(DIST_DIR, target);
  const baseManifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, "manifest.base.json")));
  baseManifest.version = process.env.RELEASE_TAG?.replace("v", "") || pkg.version;
  const targetManifest = JSON.parse(fs.readFileSync(path.join(SRC_DIR, `manifest.${target}.json`)));

  const combinedManifest = {
    ...baseManifest,
    ...targetManifest
  }

  fs.writeFileSync(path.join(destDir, "manifest.json"), JSON.stringify(combinedManifest, null, 2))
}

function applyTargetHtmlTweaks(target) {
  if (target !== "safari") return;

  const popupPath = path.join(DIST_DIR, target, "popup.html");
  const html = fs.readFileSync(popupPath, "utf-8");
  fs.writeFileSync(popupPath, html.replace("<html>", '<html class="safari-popup">'));
}

async function buildScripts(outDir, target) {
  const scriptTarget = target === "safari" ? ["safari15"] : ["chrome109"];

  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, "*.js")],
    bundle: true,
    outdir: outDir,
    format: "iife",
    target: scriptTarget,
    logLevel: "info",
    treeShaking: false,
  });

  // Popup (separately, as module)
  const popupEntry = path.join(SRC_DIR, "popup", "main.js");
  const popupOutFile = path.join(outDir, "popup.js");

  const popupDir = path.dirname(popupOutFile);
  if (!fs.existsSync(popupDir)) fs.mkdirSync(popupDir, { recursive: true });

  await esbuild.build({
    entryPoints: [popupEntry],
    outfile: popupOutFile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: scriptTarget,
    logLevel: "info",
    treeShaking: false,
  });
}

async function build(target) {
  const destDir = path.join(DIST_DIR, target);
  copyDir(SRC_DIR, destDir);
  copyManifests(target);
  applyTargetHtmlTweaks(target);

  // Bundle js specifically for this target
  await buildScripts(destDir, target);

  console.log(`Built ${target} extension to ${destDir}`);
}

async function main() {
  try {
    for (const target of getBuildTargets()) {
      await build(target);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
