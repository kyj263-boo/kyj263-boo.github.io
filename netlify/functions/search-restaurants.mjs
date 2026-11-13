// 가까운 식당 검색 (Netlify 서버 함수) - 카카오 로컬 API 사용
// 브라우저 → 이 함수 → 카카오 로컬 API 순서로 호출한다.
//
// - 카카오 REST API 키는 서버 환경변수(KAKAO_REST_KEY)로만 읽는다. 브라우저에 노출하지 않는다.
// - 브라우저가 카카오를 직접 부르면 CORS/키 노출 문제가 있어 서버 함수를 거친다.
// - 외부 패키지 없이 Node 내장 fetch로 호출한다.
//
// 호출: POST /.netlify/functions/search-restaurants
// body(JSON) 두 가지 방식:
//   1) 지역명 기반: { regionName: "서울 강남구", keyword: "김치찌개" }
//   2) 좌표 기반(현재 위치): { lat, lon, keyword: "김치찌개" }
// 응답: { ok: true, results: [{ name, address, cuisine, lat, lon, dist }] }

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// 카카오 주소/지역명 -> 좌표 (키워드 검색의 첫 결과 좌표를 중심으로 사용)
async function geocodeRegion(regionName, key) {
  const url = "https://dapi.kakao.com/v2/local/search/address.json?query="
    + encodeURIComponent(regionName);
  const res = await fetchWithTimeout(url, {
    headers: { "Authorization": `KakaoAK ${key}` }
  }, 8000);
  if (!res.ok) {
    console.error(`[search-restaurants] kakao address status=${res.status}`);
    return null;
  }
  const data = await res.json();
  if (data.documents && data.documents.length) {
    const d = data.documents[0];
    return { lat: parseFloat(d.y), lon: parseFloat(d.x) };
  }
  return null;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "POST만 허용됩니다." });
  }

  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return json(500, { ok: false, error: "서버 설정 오류입니다. (환경변수 확인 필요)" });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return json(400, { ok: false, error: "잘못된 요청입니다." }); }

  const keyword = typeof payload?.keyword === "string" ? payload.keyword.trim().slice(0, 40) : "";
  if (!keyword) return json(400, { ok: false, error: "검색할 메뉴가 없습니다." });

  // 중심 좌표 결정: 좌표가 오면 그대로, 아니면 지역명을 지오코딩
  let centerLat = (typeof payload.lat === "number" && Number.isFinite(payload.lat)) ? payload.lat : null;
  let centerLon = (typeof payload.lon === "number" && Number.isFinite(payload.lon)) ? payload.lon : null;

  try {
    if (centerLat == null || centerLon == null) {
      const region = typeof payload.regionName === "string" ? payload.regionName.trim().slice(0, 60) : "";
      if (!region) return json(400, { ok: false, error: "위치 정보가 없습니다." });
      const geo = await geocodeRegion(region, key);
      if (!geo) return json(422, { ok: false, error: "위치를 찾지 못했어요. 다른 지역으로 시도해보세요." });
      centerLat = geo.lat; centerLon = geo.lon;
    }

    // 카카오 키워드 장소 검색: 중심 좌표(x=lon, y=lat) 기준 거리순, 반경 5km
    const params = new URLSearchParams({
      query: keyword,
      x: String(centerLon),
      y: String(centerLat),
      radius: "5000",
      sort: "distance",
      size: "15"
    });
    const url = "https://dapi.kakao.com/v2/local/search/keyword.json?" + params.toString();
    const res = await fetchWithTimeout(url, {
      headers: { "Authorization": `KakaoAK ${key}` }
    }, 8000);

    if (!res.ok) {
      // [임시 진단] 카카오 키워드 검색 응답 상태 코드만 로깅 (키·본문 미포함)
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch {}
      console.error(`[search-restaurants] kakao keyword failed: status=${res.status} body=${detail}`);
      return json(502, { ok: false, error: "식당 검색에 실패했어요. 잠시 후 다시 시도해주세요." });
    }
    const data = await res.json();
    const docs = Array.isArray(data.documents) ? data.documents : [];

    const results = docs.map(d => ({
      name: d.place_name || "",
      address: d.road_address_name || d.address_name || "",
      cuisine: (d.category_name || "").split(">").pop().trim(),
      lat: parseFloat(d.y),
      lon: parseFloat(d.x),
      dist: d.distance ? Number(d.distance) : null
    })).filter(r => r.name).slice(0, 10);

    return json(200, { ok: true, results });
  } catch (e) {
    // [임시 진단] 예외 종류·메시지만 로깅 (키·요청 본문 미포함)
    console.error(`[search-restaurants] request error: ${e && e.name ? e.name : "Error"}: ${e && e.message ? e.message : String(e)}`);
    return json(502, { ok: false, error: "식당 검색 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요." });
  }
}
