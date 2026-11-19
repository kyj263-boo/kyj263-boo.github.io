// 비밀번호 해시 유틸 (Netlify 함수 공용)
// - Node 내장 crypto 의 scrypt 를 사용한다 (외부 패키지 없음).
// - 저장 형식: "scrypt$<saltHex>$<hashHex>"  (평문은 절대 저장하지 않음)
// - 비교는 timingSafeEqual 로 타이밍 공격을 피한다.

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

// 비밀번호 → 해시 문자열
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// 입력한 비밀번호가 저장된 해시와 일치하는지
export function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let actual;
  try {
    actual = scryptSync(String(password), salt, expected.length);
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
