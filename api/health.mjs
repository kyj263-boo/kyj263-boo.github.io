// Netlify 서버리스 함수 (예시 / 상태 확인용)
//
// 이 폴더(netlify/functions)의 코드는 서버에서 실행되며,
// 공개 출력 폴더(public/)에는 복사되지 않는다. 즉 브라우저로 소스가 노출되지 않는다.
//
// 지금 사이트는 Supabase를 브라우저에서 anon key로 직접 호출하므로 서버 함수가 필수는 아니다.
// 나중에 service_role key를 숨기거나 삭제 권한을 서버에서 통제하고 싶을 때
// 이 폴더에 함수를 추가하고, 비밀값은 Netlify 대시보드의 환경변수로만 주입한다.
//
// 호출 경로: /.netlify/functions/health

export default async function handler() {
  return new Response(
    JSON.stringify({ ok: true, service: "food-picker", time: new Date().toISOString() }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
