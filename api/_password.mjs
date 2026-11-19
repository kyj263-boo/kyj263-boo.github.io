// 비밀번호 해시 유틸 (서버 함수 공용)
// - Node 내장 crypto 의 PBKDF2(SHA-256) 사용 (외부 패키지 없음, 모든 런타임에서 동일 동작).
// - 저장 형식: "pbkdf2$<iterations>$<saltHex>$<hashHex>" (평문은 절대 저장하지 않음)
// - 비교는 timingSafeEqual 로 타이밍 공격을 피한다.
// - salt 를 hex 문자열로 다뤄, scrypt 에서 발생하던 바이트/인자 처리 문제를 피한다.

import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 100000;
const KEYLEN = 32;
const DIGEST = "sha256";

// 비밀번호 → 해시 문자열
export function hashPassword(password) {
  const saltHex = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), saltHex, ITERATIONS, KEYLEN, DIGEST);
  return `pbkdf2$${ITERATIONS}$${saltHex}$${hash.toString("hex")}`;
}

// 입력한 비밀번호가 저장된 해시와 일치하는지
export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expected = Buffer.from(parts[3], "hex");
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let actual;
  try {
    actual = pbkdf2Sync(String(password), saltHex, iterations, expected.length, DIGEST);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// 비밀번호 형식 검증: 4~64자. (너무 짧거나 비면 거부)
export function isValidPassword(password) {
  return typeof password === "string" && password.length >= 4 && password.length <= 64;
}
