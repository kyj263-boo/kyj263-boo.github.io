// 등록/수정/삭제 함수 공통 로직
// - 서버 전용 비밀값(SUPABASE_SERVICE_ROLE_KEY)은 환경변수로만 읽는다.
// - 비밀번호는 식당마다 개별. 해시 생성/검증은 모두 서버에서 처리한다.
// - 평문 비밀번호는 저장하지 않는다 (scrypt 해시 + 솔트만 저장).
// - 공통 비밀번호 환경변수는 더 이상 사용하지 않는다 (식당별 개별 해시로 대체).
//
// [재시도 제한의 한계 — 정직한 설명]
// Netlify Functions는 무상태(stateless)이고 여러 인스턴스로 확장될 수 있어,
// 아래 인메모리 카운터는 "같은 인스턴스"에서만 공유된다. 즉 완벽한 전역 제한은 아니다.
// 과제/데모 수준의 무차별 대입 방어로는 충분하지만, 엄격한 전역 제한이 필요하면
// Supabase 테이블(ip, 실패횟수, 잠금시각)로 옮겨야 한다.

import { createClient } from "@supabase/supabase-js";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const MAX_ATTEMPTS = 10;          // 허용 실패 횟수
const LOCK_MS = 10 * 60 * 1000;   // 초과 시 잠금 시간 (10분)
const WINDOW_MS = 10 * 60 * 1000; // 실패 횟수 집계 창 (10분)

// IP -> { fails: number, firstFailAt: number, lockedUntil: number }
const attempts = new Map();

export function getClientIp(req) {
  const xf = req.headers.get("x-nf-client-connection-ip")
    || req.headers.get("x-forwarded-for")
    || "";
  return (xf.split(",")[0] || "unknown").trim();
}

// 현재 IP가 잠겨 있으면 남은 시간을 반환, 아니면 null
export function checkLock(ip) {
  const rec = attempts.get(ip);
  if (!rec) return null;
  const now = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > now) {
    return Math.ceil((rec.lockedUntil - now) / 1000); // 남은 초
  }
  return null;
}

export function recordFailure(ip) {
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || (now - rec.firstFailAt) > WINDOW_MS) {
    rec = { fails: 0, firstFailAt: now, lockedUntil: 0 };
  }
  rec.fails += 1;
  if (rec.fails >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCK_MS;
  }
  attempts.set(ip, rec);
  return { fails: rec.fails, remaining: Math.max(0, MAX_ATTEMPTS - rec.fails) };
}

export function resetFailures(ip) {
  attempts.delete(ip);
}

// 비밀번호 형식 검증: 숫자 4자리
export function isValidPin(pw) {
  return /^\d{4}$/.test(String(pw || ""));
}

// 비밀번호 해시 생성 (scrypt + 랜덤 솔트). 저장 형식: "scrypt:<saltHex>:<hashHex>"
// 평문은 저장하지 않는다.
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

// 저장된 해시와 입력 비밀번호 비교 (상수시간). 형식이 깨졌거나 null이면 false.
export function verifyHash(pw, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(String(pw), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export const TABLE = "recommended_restaurants";
