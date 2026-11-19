// 상태 확인용 (Vercel Node 서버리스 함수 형식)
// 호출: GET /api/health
export default function handler(req, res) {
  res.status(200).json({ ok: true, service: "food-picker", time: new Date().toISOString() });
}
