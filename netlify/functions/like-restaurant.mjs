// 추천 맛집 좋아요 +1 (Netlify 서버 함수)
// 브라우저 → 이 함수 → Supabase RPC(increment_like) 순서로 처리한다.
//
// - Supabase Publishable(anon) 키만 사용한다. service_role/secret 키는 사용하지 않는다.
// - 키와 URL은 Netlify 환경변수(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)로만 읽는다.
// - 외부 패키지 없이 Node 내장 fetch로 호출한다.
// - 좋아요 증가는 DB 함수 increment_like(row_id uuid)로만 수행한다 (임의 update 불가).
//
// 호출: POST /.netlify/functions/like-restaurant
// body(JSON): { id: "<uuid>" }

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
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return json(500, { ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return json(400, { ok: false, error: "잘못된 요청입니다." }); }

  const id = typeof payload?.id === "string" ? payload.id : "";
  if (!id) return json(400, { ok: false, error: "대상이 없습니다." });

  try {
    const res = await fetch(`${url}/rest/v1/rpc/increment_like`, {
      method: "POST",
      headers: {
        "apikey": key,
        "authorization": `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ row_id: id })
    });
    if (!res.ok) {
      return json(502, { ok: false, error: "좋아요 처리에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { ok: false, error: "좋아요 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
