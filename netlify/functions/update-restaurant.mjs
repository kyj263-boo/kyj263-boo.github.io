// 저장된 식당 수정 (서버 전용) - 식당 이름/주소만, 개별 비밀번호 검증
// 해당 행의 password_hash와 입력 비밀번호를 서버에서 비교한다.
// 비밀번호가 없는 기존 데이터(password_hash is null)는 수정을 거부한다.
//
// 호출: POST /.netlify/functions/update-restaurant
// body(JSON): { id, password, restaurant_name, address }

import {
  getClientIp, checkLock, recordFailure, resetFailures,
  isValidPin, verifyHash, getServiceClient, json, TABLE
} from "./_shared.mjs";

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "POST만 허용됩니다." });
  }

  const ip = getClientIp(req);
  const lockedFor = checkLock(ip);
  if (lockedFor != null) {
    return json(429, { ok: false, error: `비밀번호를 여러 번 틀렸어요. ${Math.ceil(lockedFor / 60)}분 후 다시 시도해주세요.` });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return json(400, { ok: false, error: "잘못된 요청입니다." }); }

  const { id, password, restaurant_name, address } = payload || {};
  if (!id) return json(400, { ok: false, error: "수정할 항목이 없습니다." });

  const name = typeof restaurant_name === "string" ? restaurant_name.trim() : "";
  if (!name) return json(400, { ok: false, error: "식당 이름을 입력해주세요." });
  if (!isValidPin(password)) return json(400, { ok: false, error: "비밀번호는 숫자 4자리입니다." });

  const sb = getServiceClient();
  if (!sb) return json(500, { ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });

  const { data: row, error: selErr } = await sb
    .from(TABLE).select("id, password_hash").eq("id", id).single();
  if (selErr || !row) return json(404, { ok: false, error: "해당 식당을 찾을 수 없어요." });

  if (!row.password_hash) {
    return json(403, { ok: false, error: "이 식당은 비밀번호가 없어 수정·삭제할 수 없어요." });
  }

  if (!verifyHash(password, row.password_hash)) {
    const { remaining } = recordFailure(ip);
    return json(401, {
      ok: false,
      error: remaining > 0
        ? `비밀번호가 올바르지 않아요. (남은 시도 ${remaining}회)`
        : "비밀번호를 여러 번 틀려 잠시 잠겼어요. 나중에 다시 시도해주세요."
    });
  }

  resetFailures(ip);

  const patch = {
    restaurant_name: name,
    address: (typeof address === "string" && address.trim()) ? address.trim() : null
  };

  const { error } = await sb.from(TABLE).update(patch).eq("id", id);
  if (error) return json(500, { ok: false, error: "수정에 실패했어요. 잠시 후 다시 시도해주세요." });

  return json(200, { ok: true });
}
