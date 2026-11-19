// 식당 삭제 (Netlify 서버 함수) — 비밀번호 확인 방식
// 브라우저 → 이 함수 → Supabase REST API 순서로 처리한다.
//
// - 글마다 등록 시 정한 비밀번호가 있다. 삭제하려면 같은 비밀번호를 입력해야 한다.
// - 이 함수가 그 글의 password_hash 를 조회해 입력 비번과 비교하고, 맞을 때만 삭제한다.
// - Supabase 서버용 Secret 키를 사용한다 (브라우저에 노출하지 않음, 환경변수로만 읽음).
//
// 호출: POST /.netlify/functions/delete-restaurant
// body(JSON): { id, password }

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
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다.", debug: `bodyType=${typeof req.body}` });
  }

  const idNum = Number(payload.id);
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return res.status(400).json({ ok: false, error: "잘못된 요청입니다.", debug: `id=${JSON.stringify(payload.id)} bodyType=${typeof req.body} keys=${Object.keys(payload).join(",")}` });
  }
  if (!password) {
    return res.status(400).json({ ok: false, error: "비밀번호를 입력해주세요." });
  }

  const headers = {
    "apikey": key,
    "authorization": `Bearer ${key}`
  };

  try {
    // 1) 해당 글의 password_hash 조회
    const getRes = await fetch(
      `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(idNum)}&select=id,password_hash`,
      { headers }
    );
    if (!getRes.ok) {
      return res.status(502).json({ ok: false, error: "삭제에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    let rows = [];
    try { rows = await getRes.json(); } catch {}
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return res.status(404).json({ ok: false, error: "이미 삭제되었거나 없는 글이에요." });
    }
    if (!row.password_hash) {
      return res.status(403).json({ ok: false, error: "이 글은 비밀번호가 없어 삭제할 수 없어요." });
    }
    if (!verifyPassword(password, row.password_hash)) {
      return res.status(403).json({ ok: false, error: "비밀번호가 일치하지 않아요." });
    }

    // 2) 비번 확인됨 → 삭제
    const delRes = await fetch(
      `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(idNum)}`,
      { method: "DELETE", headers }
    );
    if (!delRes.ok) {
      return res.status(502).json({ ok: false, error: "삭제에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "삭제 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
