// 식당 저장 (서버 전용)
// 비밀번호(숫자 4자리)를 서버에서 해시해 저장한다. 평문은 저장하지 않는다.
// 브라우저는 비밀번호를 여기로 보내고, 해시 생성/insert는 서버(service_role)가 수행한다.
//
// 호출: POST /.netlify/functions/create-restaurant
// body(JSON): {
//   password, restaurant_name, address,
//   menu_name, menu_emoji, category, cuisine, lat, lon
// }

import {
  getClientIp, checkLock, recordFailure, resetFailures,
  isValidPin, hashPassword, getServiceClient, json, TABLE
} from "./_shared.mjs";

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "POST만 허용됩니다." });
  }

  const ip = getClientIp(req);
  const lockedFor = checkLock(ip);
  if (lockedFor != null) {
    return json(429, { ok: false, error: `요청이 너무 많아요. ${Math.ceil(lockedFor / 60)}분 후 다시 시도해주세요.` });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return json(400, { ok: false, error: "잘못된 요청입니다." }); }

  const {
    password, restaurant_name, address,
    menu_name, menu_emoji, category, cuisine, lat, lon
  } = payload || {};

  const name = typeof restaurant_name === "string" ? restaurant_name.trim() : "";
  if (!name) return json(400, { ok: false, error: "식당 이름을 입력해주세요." });
  if (!menu_name) return json(400, { ok: false, error: "먼저 메뉴를 추천받아 주세요." });

  // 비밀번호 형식 오류는 무차별 대입이 아니라 입력 실수이므로 잠금 카운트에 넣지 않는다.
  if (!isValidPin(password)) {
    return json(400, { ok: false, error: "비밀번호는 숫자 4자리입니다." });
  }

  const sb = getServiceClient();
  if (!sb) return json(500, { ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });

  resetFailures(ip);

  const record = {
    restaurant_name: name,
    menu_name,
    menu_emoji: menu_emoji || null,
    category: category || null,
    cuisine: cuisine || null,
    address: (typeof address === "string" && address.trim()) ? address.trim() : null,
    lat: lat != null ? lat : null,
    lon: lon != null ? lon : null,
    password_hash: hashPassword(password)
  };

  const { error } = await sb.from(TABLE).insert(record);
  if (error) return json(500, { ok: false, error: "저장에 실패했어요. 잠시 후 다시 시도해주세요." });

  return json(200, { ok: true });
}
