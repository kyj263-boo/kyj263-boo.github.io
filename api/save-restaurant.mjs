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

import { hashPassword, isValidPassword } from "./_password.mjs";

const TABLE = "recommended_restaurants";

// Vercel Node 형식: req.body 는 자동 파싱(문자열이면 직접 파싱), 응답은 res.status().json()
function readBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
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
  const priceRange = str(payload.price_range, 20);
  const features = str(payload.features, 100);
  const occasion = str(payload.occasion, 20);
  // 수정/삭제용 비밀번호 (글마다 작성자가 정함). 해시로만 저장한다.
  const password = typeof payload.password === "string" ? payload.password : "";

  // 필수값 검사 (빈 값 거부)
  if (!name) return res.status(400).json({ ok: false, error: "식당 이름을 입력해주세요." });
  if (!menuName) return res.status(400).json({ ok: false, error: "추천 메뉴를 입력해주세요." });
  if (!isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: "비밀번호를 4자 이상 입력해주세요. (수정·삭제에 필요해요)" });
  }
  // 과도한 길이는 자르기 전 원본이 너무 길면 거부 (악의적 대용량 방지)
  if (typeof payload.restaurant_name === "string" && payload.restaurant_name.length > 200) {
    return res.status(400).json({ ok: false, error: "식당 이름이 너무 깁니다." });
  }
  if (typeof payload.address === "string" && payload.address.length > 300) {
    return res.status(400).json({ ok: false, error: "주소가 너무 깁니다." });
  }

  // 가격대는 허용된 값만 저장 (임의 문자열 거부). 목록에 없으면 null.
  const ALLOWED_PRICES = new Set([
    "1만원 이하", "1~2만원", "2~3만원", "3~4만원", "4~5만원",
    "5~6만원", "6~7만원", "7~8만원", "8~9만원", "9~10만원", "10만원 이상"
  ]);
  const priceSafe = ALLOWED_PRICES.has(priceRange) ? priceRange : null;

  // 상황은 자유 입력 허용(콤보 박스). 길이만 제한하고 트림 (위의 str()에서 20자 제한 적용됨).
  const occasionSafe = occasion || null;

  // 저장할 레코드 (허용된 컬럼만; 클라이언트가 보낸 값은 신뢰하지 않고 선별·정규화)
  const record = {
    restaurant_name: name,
    menu_name: menuName,
    menu_emoji: emoji || null,
    category: category || null,
    cuisine: cuisine || null,
    address: address || null,
    price_range: priceSafe,
    features: features || null,
    occasion: occasionSafe,
    lat: coord(payload.lat, -90, 90),
    lon: coord(payload.lon, -180, 180),
    password_hash: hashPassword(password)
  };

  try {
    const apiRes = await fetch(`${url}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        "apikey": key,
        "authorization": `Bearer ${key}`,
        "content-type": "application/json",
        "prefer": "return=representation"
      },
      body: JSON.stringify(record)
    });

    if (!apiRes.ok) {
      // RLS 거부나 기타 오류. 상세 메시지는 서버 로그로만, 사용자에겐 일반 안내.
      let detail = "";
      try { detail = await apiRes.text(); } catch {}
      console.error("save-restaurant insert failed:", apiRes.status, detail);
      return res.status(502).json({ ok: false, error: "저장에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    // 저장된 행의 id 를 응답에 포함 (password_hash 는 돌려주지 않음)
    let saved = [];
    try { saved = await apiRes.json(); } catch {}
    const newId = (Array.isArray(saved) && saved[0] && saved[0].id != null) ? saved[0].id : null;
    return res.status(200).json({ ok: true, id: newId });
  } catch (e) {
    console.error("save-restaurant error:", e);
    return res.status(502).json({ ok: false, error: "저장 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
