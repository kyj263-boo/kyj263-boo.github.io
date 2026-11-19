// 식당 삭제 (Netlify 서버 함수) — 비밀번호 확인 방식
// 브라우저 → 이 함수 → Supabase REST API 순서로 처리한다.
//
// - 글마다 등록 시 정한 비밀번호가 있다. 삭제하려면 같은 비밀번호를 입력해야 한다.
// - 이 함수가 그 글의 password_hash 를 조회해 입력 비번과 비교하고, 맞을 때만 삭제한다.
// - Supabase 서버용 Secret 키를 사용한다 (브라우저에 노출하지 않음, 환경변수로만 읽음).
//
// 호출: POST /.netlify/functions/delete-restaurant
// body(JSON): { id, password }

import { verifyPassword } from "./_password.mjs";

const TABLE = "recommended_restaurants";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "POST만 허용됩니다." });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return json(500, { ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return json(400, { ok: false, error: "잘못된 요청입니다." }); }

  if (typeof payload !== "object" || payload === null) {
    return json(400, { ok: false, error: "잘못된 요청입니다." });
  }

  const idNum = Number(payload.id);
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return json(400, { ok: false, error: "잘못된 요청입니다." });
  }
  if (!password) {
    return json(400, { ok: false, error: "비밀번호를 입력해주세요." });
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
      return json(502, { ok: false, error: "삭제에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    let rows = [];
    try { rows = await getRes.json(); } catch {}
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return json(404, { ok: false, error: "이미 삭제되었거나 없는 글이에요." });
    }
    if (!row.password_hash) {
      return json(403, { ok: false, error: "이 글은 비밀번호가 없어 삭제할 수 없어요." });
    }
    if (!verifyPassword(password, row.password_hash)) {
      return json(403, { ok: false, error: "비밀번호가 일치하지 않아요." });
    }

    // 2) 비번 확인됨 → 삭제
    const delRes = await fetch(
      `${url}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(idNum)}`,
      { method: "DELETE", headers }
    );
    if (!delRes.ok) {
      return json(502, { ok: false, error: "삭제에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { ok: false, error: "삭제 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
