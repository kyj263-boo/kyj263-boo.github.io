// 식당 저장 (Netlify 서버 함수)
// 브라우저 → 이 함수 → Supabase REST API 순서로 저장한다.
//
// - Supabase Publishable(anon) 키만 사용한다. service_role/secret 키는 사용하지 않는다.
// - 키와 URL은 Netlify 환경변수(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)로만 읽는다.
// - 외부 패키지 없이 Node 내장 fetch로 REST API를 호출한다.
// - INSERT만 수행한다. DELETE/UPDATE는 하지 않는다 (RLS의 기존 insert 정책만 사용).
//
// 호출: POST /.netlify/functions/save-restaurant
// body(JSON): { restaurant_name, menu_name, menu_emoji, category, cuisine, address, lat, lon }

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
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return json(500, { ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return json(400, { ok: false, error: "잘못된 요청입니다." }); }

  const name = typeof payload?.restaurant_name === "string" ? payload.restaurant_name.trim() : "";
  const menuName = typeof payload?.menu_name === "string" ? payload.menu_name.trim() : "";
  if (!name) return json(400, { ok: false, error: "식당 이름을 입력해주세요." });
  if (!menuName) return json(400, { ok: false, error: "먼저 메뉴를 추천받아 주세요." });

  // 저장할 레코드 (허용된 컬럼만; 클라이언트가 보낸 값은 신뢰하지 않고 선별)
  const record = {
    restaurant_name: name,
    menu_name: menuName,
    menu_emoji: typeof payload.menu_emoji === "string" ? payload.menu_emoji : null,
    category: typeof payload.category === "string" ? payload.category : null,
    cuisine: typeof payload.cuisine === "string" ? payload.cuisine : null,
    address: (typeof payload.address === "string" && payload.address.trim()) ? payload.address.trim() : null,
    lat: typeof payload.lat === "number" ? payload.lat : null,
    lon: typeof payload.lon === "number" ? payload.lon : null
  };

  try {
    const res = await fetch(`${url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        "apikey": key,
        "authorization": `Bearer ${key}`,
        "content-type": "application/json",
        "prefer": "return=minimal"
      },
      body: JSON.stringify(record)
    });

    if (!res.ok) {
      // RLS 거부나 기타 오류. 상세 메시지는 서버 로그로만, 사용자에겐 일반 안내.
      return json(502, { ok: false, error: "저장에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { ok: false, error: "저장 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
