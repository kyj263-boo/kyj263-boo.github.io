-- 추천 맛집 게시판: 글별 비밀번호로 수정/삭제 기능을 위한 스키마 변경
-- Supabase 대시보드 → SQL Editor 에서 아래를 실행하세요.
--
-- password_hash: 글 작성자가 정한 비밀번호의 해시(scrypt) 문자열.
--   - 평문 비밀번호는 저장하지 않습니다. 서버(Netlify 함수)에서 해시로 만들어 저장합니다.
--   - 수정/삭제 시 입력한 비밀번호를 서버가 해시와 비교해 일치할 때만 허용합니다.
--   - 이 컬럼은 공개 조회(SELECT)에 포함하지 않습니다. (노출돼도 평문은 아니지만, 굳이 내려보내지 않음)

alter table public.recommended_restaurants
  add column if not exists password_hash text;

-- 참고:
-- 1) 삭제/수정은 서버(Netlify 함수)에서 Secret 키로만 수행합니다.
--    공개 anon 키에는 DELETE/UPDATE 권한을 주지 마세요 (RLS 정책 유지).
-- 2) 기존에 비밀번호 없이 등록된 글은 password_hash 가 NULL 입니다.
--    이런 글은 비밀번호로 수정/삭제할 수 없습니다(수정/삭제 버튼을 보여주지 않음).
