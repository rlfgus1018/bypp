# BYPP — Milestone 1 + 2-A + 2-B

KakaoTalk 대화 내보내기 파일 → 메시지 파싱 → 중복 제거 → 일정 후보 탐지 → 구조화 추출 → 검토 UI(Approve / Ignore) → **BYPP 내부 캘린더**.

```text
ScheduleCandidate   추출 기록 (캘린더에서 고쳐도 바뀌지 않음)
   ↓ Approve
CalendarEvent       사용자 일정 — BYPP 안에서 보고 / 수정 / 제거 (M2-A)
   ↓ 일정별 "Google에 일정 생성" 버튼 (자동 전송 없음)
Google Calendar     항상 CalendarEvent에서, 생성(CREATE)만 (M2-B)
```

**승인·업로드·추출·페이지 열기·Google 연결만으로는 Google에 아무것도 생성되지 않습니다.** 사용자가 로컬 일정의 버튼을 누를 때만, 그 일정 하나가 한 번 생성됩니다. 양방향 sync, Google 쪽 수정·삭제, Android 알림 수집, 로그인/다중 사용자는 범위 밖입니다. 설계와 결정 근거는 [`plan.md`](plan.md)(M1)와 [`plan_base_calendar.md`](plan_base_calendar.md)(M2-A: 불변식, `[start, end)` 날짜 규칙), [`docs/google-calendar-sync.md`](docs/google-calendar-sync.md)(M2-B: scope, 토큰 보관, 중복 방지, 수동 확인 절차).

## 실행

```powershell
npm install
npm run dev            # http://localhost:3000  → 업로드 → 일정 후보 검토
```

- **추출 기간**: 파일을 고르면 먼저 월별 건수(추출 대상 / LLM 필요)만 미리 보여 주고, 메시지를 **보낸 날짜** 기준으로 추출할 기간을 고릅니다. 기간 밖의 일정성 메시지는 `OUT_OF_RANGE`로 저장만 되고, 같은 파일을 더 넓은 기간으로 다시 올리면 그때 추출됩니다.
- **캘린더** (`/calendar`): 후보를 Approve하면 같은 트랜잭션에서 캘린더 일정이 생기고, Ignore / 되돌리기 / 캘린더에서 제거하면 사라집니다. UPDATE·CANCEL 후보는 기존 일정을 고치지 않고 "변경 공지"·"취소 공지" 항목으로 들어갑니다. 페이지를 여는 것만으로는 DB에 쓰지 않습니다. 불변식 점검·복구는 `npm run repair:calendar`(기본 dry-run, `-- --apply`로 수정).
- **Google 캘린더 (선택)**: `/calendar`에서 Google 계정을 연결하면, 일정을 열어 **"Google에 일정 생성"**을 누른 일정만 기본 캘린더에 만들어집니다. 변경/취소 공지와 날짜 미확정 일정은 사유를 보여 주고 막습니다. **종료 시각이 없는 시간 일정**(회의·마감 등)도 보낼 수 있습니다: Google에는 **시작 ~ 시작 + 1시간**의 일반 일정으로 만듭니다(Google은 종료 시각을 요구하며, `endTimeUnspecified`를 붙인 요청은 400으로 거부했습니다). BYPP의 로컬 일정은 종료 시각 없이 그대로 두고, 사용자가 종료 시각을 입력한 일정은 그 값을 씁니다. 같은 일정은 재시도·동시 클릭·응답 유실에도 두 번 만들어지지 않습니다. **생성 이후의 로컬 수정·제거는 Google에 반영되지 않습니다.** 여러 건은 캘린더의 **"Google로 한꺼번에 보내기"**(`/calendar/google`)에서 보냅니다: 아직 보내지 않은 일정이 월별 체크리스트로 나오고, 보내지 않을 일정은 체크를 해제합니다(월 단위·전체 선택/해제, 일정 날짜 기간 필터). 같은 시각·분류의 일정이 여러 개면 배지로 알려 주고, 보낼 수 없는 일정은 사유와 함께 따로 보여 줍니다. 계정·건수를 한 번 더 확인한 뒤 3건씩 나눠 보내며 진행 상황·일시정지·실패 사유를 표시합니다. 일정마다 단건 전송과 **같은 경로**를 타므로 두 번 누르거나 두 탭에서 눌러도 중복 생성되지 않습니다. 제외는 그 전송에만 적용되고 저장되지 않습니다.
- **채팅방별 검토**: 일정 후보는 추출한 **채팅방 제목** 아래로 나뉩니다. 카카오톡 내보내기 파일명 `[채팅방 제목] [인원수] 카카오톡 대화.[확장자]`에서 확장자·` 카카오톡 대화`·끝의 인원수를 뗀 것이 제목입니다(`PULSE 집행위원회 공지방 31 카카오톡 대화.eml` → `PULSE 집행위원회 공지방`). 상단의 "채팅방" 선택으로 한 채팅방만 볼 수 있고(`?source=…`), 탭 건수·검색 조건·**일괄 승인/무시도 선택한 채팅방 안에서만** 적용됩니다. 주소의 채팅방 값이 잘못되면 전체로 넓히지 않고 아무것도 표시·변경하지 않습니다. 전체 채팅방 보기에서는 채팅방마다 20건씩, 한 채팅방을 고르면 100건씩 보여 주며 제목 옆에 `20 / 150건 표시`처럼 전체 건수를 함께 씁니다.
- **같은 채팅방을 다시 올리면**: 인원수가 바뀌어 파일명이 달라져도 같은 채팅방으로 묶입니다. 이미 저장된 메시지는 기존 중복 판정(보낸 시각·보낸 사람·본문)대로 건너뛰고 **새 메시지만** 추가·추출되며, 기존 후보와 검토 상태·캘린더 일정·Google 전송 기록은 그대로입니다. 업로드 전 미리보기가 "이미 등록된 채팅방 — 새 메시지 N건만 추가"를 알려 줍니다.
- **중요 일정**: `/settings`에서 **중요 단어**(예: `운영위원회`)를 등록하면, 제목에 그 단어가 들어간 후보·캘린더 일정이 ★ 중요로 표시됩니다. 비교는 공백·대소문자를 무시하고 **제목만** 봅니다(메시지 본문은 보지 않음). 단어는 공백 제외 2~50자, 최대 50개이며, 등록 전에 "제목 일치: 후보 N건 · 캘린더 M건"을 미리 보여 줍니다. 카드·일정마다 **중요로 / 중요 아님 / 자동으로 되돌리기**로 직접 지정할 수 있고, 직접 지정이 단어보다 우선합니다. 후보와 그 후보에서 만든 캘린더 일정은 직접 지정을 함께 바꿉니다(한 트랜잭션). 일정 후보 화면의 **[전체] [★ 중요]** 범위와 캘린더의 **[일정] [★ 중요] [제휴]** 탭은 항상 보이며, 중요 범위에서도 검색·채팅방·일괄 처리가 같은 조건으로 동작합니다. 달력에서는 중요 일정 칩에 ★가 붙습니다(숨기지 않고 강조만). 업로드 미리보기의 "중요 키워드 포함 메시지 N건"은 추출 전 **원문 기준 예상치**이고, 추출 패널의 "이번에 생성된 중요 일정 후보 N건"이 실제 제목 기준 결과입니다. Google 한꺼번에 보내기는 기본이 **중요만**이며, 보내기 직전에 서버가 중요 여부를 다시 확인해 그 사이 빠진 일정은 보내지 않습니다. 중요에서 빠져도 이미 Google에 만든 일정은 지우지 않습니다.
- **후보 필터**: 검토 화면에서 action(CREATE/UPDATE/CANCEL) · category · 기간(일정 날짜 또는 메시지 날짜) · 정렬로 걸러 볼 수 있고, 필터는 URL에 남습니다.
- **일괄 처리**: 현재 탭 + 필터에 맞는 후보 **전체**(화면의 100건만이 아니라)를 한 번에 승인 / 무시 / 검토 대기로 바꿉니다. 건수를 확인하는 2단계이고, 한 트랜잭션으로 처리되며, 확인한 건수와 서버가 다시 센 건수가 다르면 아무것도 바꾸지 않습니다. **전체 승인** 때 같은 시각·분류의 일정이 이미 캘린더에 있거나 목록 안에서 서로 겹치는 후보가 있으면, 그 후보들을 *무시 처리 / 별도 일정으로 추가 / 그대로 두기* 중 어떻게 할지 먼저 묻습니다(목록 안의 반복은 가장 최근 메시지의 후보를 남깁니다).

Node 22+ (개발은 Node 24). DB는 `./data/bypp.db`(SQLite)에 자동 생성됩니다. `data/`는 gitignore 대상입니다.

| 명령 | 용도 |
|---|---|
| `npm test` | 단위/통합 테스트 (외부 API 호출 없음, `MockLlmClient`만 사용) |
| `npm run typecheck` / `npm run lint` | 타입 / lint (SDK import 위치 제한 포함) |
| `npm run inspect:export -- "<file>"` | decode + parse만 하는 dry run |
| `npm run verify:pipeline -- "<file>"` | 실제 export로 전체 pipeline을 2회 돌려 불변식을 검사. **외부 요청 0회** |
| `npm run verify:pipeline -- "<file>" --llm --limit 30 [--show-payload] [--batch-size 5] [--concurrency 1]` | 선택한 실제 LLM 사용(명시적 opt-in). `--limit` = 외부 요청 수의 절대 상한 |
| `npm run verify:pipeline -- "<file>" --llm --limit 60 --compare-batch 5 [--sample 20]` | 같은 메시지를 1건/요청과 N건/요청으로 각각 추출해 **일치율만** 출력. `--compare-batch 1`은 기준선(1건 방식끼리의 흔들림) |

실제 대화 파일은 `data/private/`에 두세요. 절대 commit하지 않습니다. 테스트 fixture(`tests/fixtures/`)는 전부 가상 데이터입니다.

## 입력 파일

`.txt` / `.eml`을 받지만 **확장자는 믿지 않고 내용으로 판별**합니다. Kakao plaintext면 그대로 parser로 보내고, 파일이 실제 MIME header block으로 시작할 때만 email로 풀어냅니다. (실제 export는 이름만 `.eml`인 plaintext였습니다 — [`docs/kakao-export-format.md`](docs/kakao-export-format.md))

## Google 캘린더 연결 (선택)

```env
# .env.local — 서버 전용. NEXT_PUBLIC_ 접두사를 붙이지 마세요.
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback   # Console에 등록한 값과 글자 하나까지 같아야 함
GOOGLE_TOKEN_ENCRYPTION_KEY=                                          # 선택: 32바이트 base64. 있으면 토큰을 AES-256-GCM으로 암호화
```

1. Google Cloud Console: **Google Calendar API 사용 설정** → OAuth 동의 화면(테스트 상태라면 본인 계정을 테스트 사용자로 추가) → OAuth 클라이언트(웹 애플리케이션)의 승인된 리디렉션 URI에 위 URI 등록.
2. `npm run dev` → `/calendar` → **Google 연결** → 동의(캘린더 권한 체크 유지). 연결만으로는 아무것도 전송되지 않습니다.
3. 시작·끝이 있는 일정을 열어 **Google에 일정 생성** → "Google에 생성됨". Google 캘린더에서 제목·시간·장소만 들어갔는지(설명·참석자 없음) 확인.
4. 연결 해제는 <https://myaccount.google.com/permissions> 에서 합니다(앱 안의 해제 UI는 없음).

- 요청 권한은 `calendar.events.owned`(내 소유 캘린더의 일정) + `openid email`(계정 식별·표시)뿐입니다.
- 토큰은 `data/`의 SQLite(git-ignore, `public/` 밖)에만 저장되고 브라우저로 나가지 않습니다. **`GOOGLE_TOKEN_ENCRYPTION_KEY`가 없으면 암호화되지 않은 채** 파일 접근 권한으로만 보호됩니다.
- 자동 테스트는 mock만 사용하며 실제 Google을 호출하지 않습니다. 위 절차는 사람이 직접 확인하는 smoke test입니다.
- Google에 보내는 것: 제목, 시작/끝(Asia/Seoul), 장소, 그리고 중복 방지용 비공개 식별자(앱 표식 + 로컬 일정 ID). 원본 메시지·보낸 사람·후보 설명은 보내지 않습니다.

## LLM (선택)

기본값은 **LLM off** — 모든 처리가 로컬에서 끝납니다.

Gemini를 사용할 때의 `.env.local` 설정입니다.

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
LLM_MODEL=gemini-3.8-flash
LLM_RPM=14
LLM_BATCH_SIZE=1
LLM_CONCURRENCY=1
```

OpenRouter의 DeepSeek를 한 메시지씩 병렬로 시험할 때는 다음처럼 바꿉니다. 모델 ID는 결과 비교가 가능하도록 고정 버전을 사용합니다.

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
LLM_MODEL=deepseek/deepseek-v4-flash-0731
LLM_RPM=0
LLM_BATCH_SIZE=1
LLM_CONCURRENCY=12
```

`LLM_BATCH_SIZE=1`은 각 메시지를 따로 검토하고, `LLM_CONCURRENCY=12`는 최대 12개 요청을 동시에 처리합니다(허용 범위 1–16). 가상 메시지 32건 실측에서는 8/12/16 중 12가 가장 빨랐습니다. `LLM_RPM=0`은 앱 내부의 분당 속도 제한만 끄며 OpenRouter 자체 한도는 그대로 적용됩니다. OpenRouter 요청은 Structured Output과 Response Healing을 함께 사용하고, 결과는 다시 Zod로 검증합니다. 값 변경 후 개발 서버를 다시 시작하세요. PowerShell 세션에만 임시로 넣으려면 `export` 대신 `$env:OPENROUTER_API_KEY = "sk-or-v1-..."`를 사용합니다. 키가 존재해도 `LLM_PROVIDER=openrouter`가 없으면 외부 요청은 발생하지 않습니다.

- 명확한 일정(라벨 필드 + 절대 날짜)은 rule-based로 끝나고 **LLM을 호출하지 않습니다.** 상대 날짜 / 변경·연장·취소 / 산문 속 날짜 / rule 실패만 선택한 LLM으로 갑니다. key가 없으면 같은 메시지를 저신뢰 heuristic이 처리합니다.
- LLM에 보내는 것: 메시지의 텍스트(전화번호·이메일·URL 마스킹) + 보낸 시각 + timezone. 보낸 사람, 방 이름, 파일 전체는 보내지 않습니다. DB와 검토 화면에는 원본이 그대로 남습니다. 기본은 **한 요청에 메시지 1건**이고, `LLM_BATCH_SIZE`를 올리면 **같은 방의** 메시지를 한 요청에 최대 N건(합계 4,000자 이내) 담습니다 — 이때도 메시지마다 따로 마스킹하고, 서로 독립으로 해석하라고 지시하며, 응답은 메시지별로 검증합니다.
- **속도**: 규칙으로 끝나는 메시지는 LLM을 기다리지 않고 먼저 처리됩니다. 요청은 균등 간격이 아니라 **분당 창**(`LLM_RPM`)으로 제한해서, 몇 건만 올리면 대기 없이 끝납니다. 묶음(`LLM_BATCH_SIZE=5`)은 같은 분당 한도에서 처리량을 약 5배로 올리지만(실측: 15건 63초 → 10초, 요청 15회 → 4회) 추출 결과가 1건 방식과 조금 달라질 수 있어 **기본값은 1**입니다 — 실측과 판단 기준은 [`docs/llm-api-decision.md`](docs/llm-api-decision.md). 묶음 응답에서 index 누락·검증 실패·다른 메시지의 문장을 근거로 든 경우는 해당 메시지만 1건 방식으로 다시 추출합니다(요청 상한: 묶음 1회 + 메시지당 2회).
- Gemini는 Interactions API, OpenRouter는 OpenAI 호환 Chat Completions API를 사용하며 둘 다 Structured Output을 요청합니다. 응답은 다시 Zod로 검증합니다(실패 시 1회 재시도 후 `FAILED`). tool/검색/URL context는 사용하지 않습니다 — [`docs/llm-api-decision.md`](docs/llm-api-decision.md).
- 메시지는 untrusted data로 취급합니다(JSON.stringify된 data object로 전달, 내부 지시 무시).

> ⚠ LLM API를 활성화하면 일정 해석이 필요한 일부 카카오톡 메시지가 선택한 외부 공급자(Google Gemini 또는 OpenRouter/DeepSeek)로 전송될 수 있습니다. 실제 개인/타인의 대화를 전송하기 전에 해당 공급자의 최신 데이터 처리 정책을 확인하세요.

## 구조

```text
src/lib/messages/      source-agnostic message 타입, 정규화, fingerprint
src/lib/kakao-export/  decoder(내용 sniffing) · parser · 줄 형식 · 분류
src/lib/schedule/      detector · 날짜/시간 parser · rule/heuristic/hybrid extractor · Zod schema
src/lib/ai/            LlmClient 경계 · Gemini/OpenRouter 어댑터 · sanitize · budget
src/lib/db/            SQLite client + repositories (SQL은 여기에만)
src/lib/pipeline/      ingest / extract — route handler와 CLI가 같은 함수를 호출
src/lib/google/        OAuth · 토큰 보관/갱신 · CalendarEvent→Google mapper · CREATE orchestration (후보/메시지 계층을 import하지 않음)
src/lib/calendar/      후보↔일정 lifecycle · [start,end) normalize · 월 그리드 · 수정 입력 검증 (framework-free)
src/app, src/components  업로드 · 추출 진행 · 후보 검토 · 캘린더 UI
```

## 알려진 한계

- 실제 Gemini 경로는 무료 티어 key로 확인했습니다([`docs/pipeline-verification.md`](docs/pipeline-verification.md)). OpenRouter 경로는 자동 테스트에서 mock으로 검증했으며, 실제 key로 품질·지연·한도를 비교한 뒤 기본 공급자 변경 여부를 결정해야 합니다.
- heuristic fallback은 품질이 낮습니다(confidence ≤ 0.5, "검토 필요"). 예: 공지 작성일을 행사일로 잡는 경우가 있습니다.
- UPDATE / CANCEL은 라벨과 원문만 보존합니다. 기존 후보·일정과 연결하거나 자동 반영하지 않고, 캘린더에는 "변경 공지"·"취소 공지" 항목으로만 들어갑니다.
- 후보(추출 기록) 자체는 편집할 수 없습니다(Approve / Ignore / 되돌리기만). 고치려면 승인한 뒤 캘린더에서 일정을 수정합니다. 캘린더에 일정을 직접 추가하는 기능은 없습니다.
- 중복 제거는 메시지 단위 exact match입니다. 같은 행사를 다시 올린 공지는 별도 후보·별도 일정이 됩니다(같은 시각·분류면 안내만 하고 합치지 않습니다).
- Google 연동은 **생성 전용·단방향**입니다. 생성 후 로컬 수정/제거는 Google에 반영되지 않고, 로컬 일정을 제거하면 전송 이력도 함께 지워집니다(제거 → 재승인 → 재전송하면 Google에 일정이 하나 더 생김). Google에서 지운 일정은 같은 ID로 다시 만들 수 없습니다. 계정 1개, 기본 캘린더만 지원합니다.
- 채팅방 그룹은 카카오톡의 영구 방 ID가 아니라 **제목** 기준입니다. 제목이 같은 서로 다른 방은 한 그룹으로 합쳐지고, 방 이름을 바꾸면 그 뒤의 파일은 다른 그룹이 됩니다. 인원수는 "제목 끝의 숫자 하나"로 판단하므로 형식이 다른 파일명은 자르지 않고 그대로 씁니다. 메시지의 채팅방은 그 메시지를 **처음 저장한 업로드**로 정해지며, 중복 판정에 방이 포함되지 않아 서로 다른 방의 완전히 같은 메시지(같은 분·같은 사람·같은 본문)는 먼저 올린 쪽에만 남습니다.
- 단일 방 전제입니다. 여러 방을 지원하려면 fingerprint에 stable conversation scope가 필요합니다(`plan.md` §19).
- 메시지 1건만 보고 추출합니다. 여러 메시지에 걸친 일정 합의는 다루지 않습니다.
- sanitization은 전화번호/이메일/URL만 가립니다. 본문 속 이름·학번은 남습니다.
- 사진 공지(전체의 약 41%)는 건너뜁니다(OCR 없음). 검증한 export 형식은 Android 스타일 1종입니다.
