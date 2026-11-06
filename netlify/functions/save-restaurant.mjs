// 식당 저장 (Netlify 서버 함수)
// 브라우저 → 이 함수 → Supabase REST API 순서로 저장한다.
//
// - Supabase 서버용 Secret 키를 사용한다. 이 키는 서버(이 함수)에서만 쓰며 브라우저에 노출하지 않는다.
// - 키와 URL은 Netlify 환경변수(SUPABASE_URL, SUPABASE_SECRET_KEY)로만 읽는다 (코드/Git/공개 빌드에 값 없음).
// - 외부 패키지 없이 Node 내장 fetch로 REST API를 호출한다.
// - INSERT만 수행한다. DELETE/UPDATE는 하지 않는다.
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

  // 문자열 필드를 안전하게 정리: 문자열이 아니면 "", 트림, 길이 제한
  const str = (v, max) => {
    if (typeof v !== "string") return "";
    const t = v.trim();
    return t.length > max ? t.slice(0, max) : t;
  };
  // 좌표: 숫자이고 유효 범위일 때만 사용
  const coord = (v, min, max) =>
    (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) ? v : null;

  const name = str(payload.restaurant_name, 80);
  const menuName = str(payload.menu_name, 80);
  const emoji = str(payload.menu_emoji, 8);
  const category = str(payload.category, 20);
  const cuisine = str(payload.cuisine, 40);
  const address = str(payload.address, 120);

  // 필수값 검사 (빈 값 거부)
  if (!name) return json(400, { ok: false, error: "식당 이름을 입력해주세요." });
  if (!menuName) return json(400, { ok: false, error: "추천 메뉴를 입력해주세요." });
  // 과도한 길이는 자르기 전 원본이 너무 길면 거부 (악의적 대용량 방지)
  if (typeof payload.restaurant_name === "string" && payload.restaurant_name.length > 200) {
    return json(400, { ok: false, error: "식당 이름이 너무 깁니다." });
  }
  if (typeof payload.address === "string" && payload.address.length > 300) {
    return json(400, { ok: false, error: "주소가 너무 깁니다." });
  }

  // 저장할 레코드 (허용된 컬럼만; 클라이언트가 보낸 값은 신뢰하지 않고 선별·정규화)
  const record = {
    restaurant_name: name,
    menu_name: menuName,
    menu_emoji: emoji || null,
    category: category || null,
    cuisine: cuisine || null,
    address: address || null,
    lat: coord(payload.lat, -90, 90),
    lon: coord(payload.lon, -180, 180)
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
