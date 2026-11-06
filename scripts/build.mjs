// 정적 공개 폴더(public/) 빌드 스크립트
// 공개 대상(HTML/CSS/브라우저 JS/이미지)만 복사하고,
// .git / .env / .kiro / docs(개인 기록) / node_modules / netlify 함수 등 비공개 항목은 제외한다.
//
// 실행: node scripts/build.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public");

// 공개할 정적 자산 확장자 (HTML/CSS/브라우저 JS/이미지/폰트)
const PUBLIC_EXT = new Set([
  ".html", ".css", ".js", ".mjs",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".otf",
  ".json", ".txt", ".webmanifest"
]);

// 절대 공개 폴더에 들어가면 안 되는 최상위 항목 (서버 비밀/개인 기록/빌드 부산물)
const EXCLUDE_TOP = new Set([
  ".git", ".env", ".kiro", "docs", "node_modules",
  "netlify", "scripts", "public",
  ".gitignore", ".netlify",
  "package.json", "package-lock.json", "netlify.toml"
]);

// 추가로 어느 깊이에서든 제외할 파일/폴더
const EXCLUDE_ALWAYS = new Set([
  ".git", ".env", "node_modules", ".DS_Store", "Thumbs.db"
]);

function isSecretName(name) {
  // .env, .env.local, *.secret.* 등 비밀 파일 방어
  return /^\.env(\..+)?$/.test(name) || /\.secret\./.test(name);
}

async function rimraf(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function copyPublic(srcDir, destDir, depth = 0) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (EXCLUDE_ALWAYS.has(name) || isSecretName(name)) continue;
    if (depth === 0 && EXCLUDE_TOP.has(name)) continue;

    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyPublic(srcPath, destPath, depth + 1);
      // 비어 있으면 정리
      const left = await fs.readdir(destPath);
      if (left.length === 0) await fs.rmdir(destPath);
    } else if (entry.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (!PUBLIC_EXT.has(ext)) continue;
      await fs.copyFile(srcPath, destPath);
      console.log("copy:", path.relative(root, destPath));
    }
  }
}

async function main() {
  await rimraf(outDir);
  await fs.mkdir(outDir, { recursive: true });
  await copyPublic(root, outDir);

  // 루트(/) 첫 화면을 food.html로 만든다.
  // 소스 index.html(게임)은 건드리지 않고, 공개 산출물의 index.html만 food.html 내용으로 덮어쓴다.
  // => Netlify 기본 주소로 접속하면 food 화면이 뜨고, public/index.html == food.html 이 된다.
  const foodSrc = path.join(root, "food.html");
  const indexOut = path.join(outDir, "index.html");
  await fs.copyFile(foodSrc, indexOut);
  console.log("override: public/index.html <= food.html (루트 첫 화면)");

  const files = [];
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(path.relative(outDir, p));
    }
  }
  await walk(outDir);

  console.log("\n빌드 완료. 공개 폴더:", path.relative(root, outDir));
  console.log("포함된 파일 수:", files.length);
  files.sort().forEach(f => console.log("  -", f));
}

main().catch(err => {
  console.error("빌드 실패:", err);
  process.exit(1);
});
