// 식당 수정 (Netlify 서버 함수) — 비밀번호 확인 방식
// 브라우저 → 이 함수 → Supabase REST API 순서로 처리한다.
//
// - 글마다 등록 시 정한 비밀번호가 있다. 수정하려면 같은 비밀번호를 입력해야 한다.
// - 이 함수가 그 글의 password_hash 를 조회해 입력 비번과 비교하고, 맞을 때만 수정한다.
// - save-restaurant 와 동일한 입력 검증/정규화 규칙을 쓴다.
// - 수정 대상 컬럼만 PATCH 한다 (password_hash / id / created_at 은 바꾸지 않음).
//
// 호출: POST /.netlify/functions/update-restaurant
// body(JSON): { id, password, restaurant_name, menu_name, address, price_range, features, occasion }

import { pbkdf2Sync, timingSafeEqual } from "node:crypto";

// 비밀번호 검증 (PBKDF2-SHA256). import 의존을 없애려 각 함수에 직접 둔다.
function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const expected = Buffer.from(parts[3], "hex");
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let actual;
  try { actual = pbkdf2Sync(String(password), saltHex, iterations, expected.length, "sha256"); }
  catch { return false; }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const TABLE = "recommended_restaurants";

function readBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return null; } }
  return req.body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST만 허용됩니다." });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });
  }

  const payload = readBody(req);

  if (typeof payload !== "object" || payload === null) {
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다." });
  }

  // id 는 UUID 문자열. 안전한 문자(영숫자/하이픈)만 허용.
  const idStr = typeof payload.id === "string" ? payload.id.trim() : String(payload.id ?? "");
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!idStr || !/^[0-9a-zA-Z-]{1,64}$/.test(idStr)) {
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다." });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: "비밀번호를 입력해주세요." });
  }

  // 문자열 필드 정리 (save-restaurant 와 동일 규칙)
  const str = (v, max) => {
    if (typeof v !== "string") return "";
    const t = v.trim();
    return t.length > max ? t.slice(0, max) : t;
  };

  const name = str(payload.restaurant_name, 80);
  const menuName = str(payload.menu_name, 80);
  const address = str(payload.address, 120);
  const priceRange = str(payload.price_range, 20);
  const features = str(payload.features, 100);
  const occasion = str(payload.occasion, 20);

  if (!name) return res.status(400).json({ ok: false, error: "식당 이름을 입력해주세요." });
  if (!menuName) return res.status(400).json({ ok: false, error: "추천 메뉴를 입력해주세요." });
  if (typeof payload.restaurant_name === "string" && payload.restaurant_name.length > 200) {
    return res.status(400).json({ ok: false, error: "식당 이름이 너무 깁니다." });
  }
  if (typeof payload.address === "string" && payload.address.length > 300) {
    return res.status(400).json({ ok: false, error: "주소가 너무 깁니다." });
  }

  const ALLOWED_PRICES = new Set([
    "1만원 이하", "1~2만원", "2~3만원", "3~4만원", "4~5만원",
    "5~6만원", "6~7만원", "7~8만원", "8~9만원", "9~10만원", "10만원 이상"
  ]);
  const priceSafe = ALLOWED_PRICES.has(priceRange) ? priceRange : null;
  const occasionSafe = occasion || null;

  const headers = {
    "apikey": key,
    "authorization": `Bearer ${key}`,
    "content-type": "application/json"
  };

  try {
    // 1) 해당 글의 password_hash 조회
    const getRes = await fetch(
      `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(idStr)}&select=id,password_hash`,
      { headers: { "apikey": key, "authorization": `Bearer ${key}` } }
    );
    if (!getRes.ok) {
      return res.status(502).json({ ok: false, error: "수정에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    let rows = [];
    try { rows = await getRes.json(); } catch {}
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return res.status(404).json({ ok: false, error: "없는 글이에요." });
    }
    if (!row.password_hash) {
      return res.status(403).json({ ok: false, error: "이 글은 비밀번호가 없어 수정할 수 없어요." });
    }
    if (!verifyPassword(password, row.password_hash)) {
      return res.status(403).json({ ok: false, error: "비밀번호가 일치하지 않아요." });
    }

    // 2) 비번 확인됨 → 수정
    const patch = {
      restaurant_name: name,
      menu_name: menuName,
      address: address || null,
      price_range: priceSafe,
      features: features || null,
      occasion: occasionSafe
    };
    const patchRes = await fetch(
      `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(idStr)}`,
      { method: "PATCH", headers, body: JSON.stringify(patch) }
    );
    if (!patchRes.ok) {
      return res.status(502).json({ ok: false, error: "수정에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "수정 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
