# BYPP — Milestone 2-A: Local Calendar / Canonical Calendar Layer (plan_base_calendar.md)

> 상태: **M2-A 구현 완료 (2026-09-19).** §13 DoD 점검 결과는 문서 끝 "구현 결과" 참고. M2-B는 시작하지 않았다.
> 개정: v2 (2026-09-18) — `BYPP_M2A_Local_Calendar_ClaudeCode_Instructions.md` 검토 반영. 바뀐 점은 §13 변경 이력 참고.

## 0. Context

- 지금 앱은 `업로드 → 일정 후보 검토(Approve / Ignore)`에서 끝난다. 승인해도 상태값만 바뀌고 승인된 일정을 "일정답게" 볼 곳이 없다.
- **M2-A 목표**: M1에서 승인된 `ScheduleCandidate`를 BYPP 내부 `CalendarEvent`로 변환하고, 사용자가 내부 월간 캘린더에서 보고 / 수정 / 제거할 수 있게 한다. 상단 탭은 **업로드 · 일정 후보 · 캘린더**.
- **다음 단계 M2-B**: Google Calendar Sync. 이번에는 구현하지 않고 경계만 문서화한다(§11).
- 확정된 결정:
  1. 앱 내부 캘린더만. Google Calendar API·OAuth·외부 전송 없음.
  2. UPDATE / CANCEL 후보는 "변경 공지" / "취소 공지" 표시가 붙은 **별도 항목**으로 추가. 기존 일정을 자동으로 고치거나 지우지 않는다.
  3. 캘린더에서 보기 + 수정 + 제거까지. 사용자 직접 일정 추가 UI는 범위 밖(단, 모델은 막지 않는다).
- 실제 데이터로 본 설계 제약(건수만): 후보 602건(CREATE 593 / UPDATE 9), 날짜 미확정 5건, 같은 시작시각+분류를 공유하는 후보 106그룹 259건(반복 공지), PERIOD 최대 364일, 하루 최대 12건. → 중복 안내, 긴 기간 처리, `+N개 더`가 필수.

## 1. Architecture

```text
KakaoTalk
   ↓
ScheduleCandidate        추출 기록 — AI/rule extractor의 원본 해석과 근거. 캘린더에서 고쳐도 절대 바뀌지 않는다.
   ↓ Approve
Local CalendarEvent      사용자 일정 — BYPP 안에서 사용자가 실제로 관리하는 canonical entity. 수정 가능. (M2-A)
   ↓
External Calendar Sync   외부 provider와의 연결 정보 (calendar_syncs). (M2-B)
   ↓
Google Calendar Event
```

**강제하는 규칙**
- Google Calendar는 미래에도 `ScheduleCandidate`를 직접 읽지 않는다. 항상 `CalendarEvent`가 source다. 개념적 API: `syncToGoogle(event: CalendarEvent)`.
- `ScheduleCandidate → Google Calendar` 직결 구조는 만들지 않는다. Google adapter는 extraction layer를 몰라야 한다.
- 캘린더/Google 때문에 M1의 parser / detector / extractor / candidate schema를 수정하지 않는다.
- `calendar_events`는 월간 UI용 cache가 아니라 **사용자 일정 entity**다. 예: 후보가 18:00이고 사용자가 캘린더에서 17:30으로 고치면 후보는 18:00 그대로, M2-B가 Google에 보내는 값은 17:30이다.
- `calendar_events`는 provider-agnostic하게 유지한다. `google_event_id`, sync status, token 류는 어떤 형태로도 넣지 않는다.

## 2. Invariant (후보에서 파생된 이벤트 기준, 단방향)

```text
Candidate.status == APPROVED  →  그 후보에서 파생된 CalendarEvent가 정확히 1개 존재
Candidate.status != APPROVED  →  그 후보에서 파생된 CalendarEvent는 존재하지 않음
```

"CalendarEvent가 있으면 반드시 Candidate가 있다"는 **강제하지 않는다**(미래의 `origin = MANUAL`, `candidate_id = NULL` 허용).

| 동작 | 후보 | 캘린더 |
|---|---|---|
| Approve | → APPROVED | 이벤트 없으면 생성(§4 mapping) |
| Ignore / Pending으로 되돌리기 | → IGNORED / PENDING | 파생 이벤트 삭제 |
| 캘린더에서 "제거" | → IGNORED (후보 화면에서 되돌릴 수 있음) | 이벤트 삭제. `candidate_id`가 NULL인 이벤트면 이벤트만 삭제 |
| 캘린더에서 수정 | 변화 없음 | 이벤트만 변경, `edited_at` 갱신 |
| 같은 파일 재업로드 | 변화 없음 | 변화 없음 |

- 상태 변경과 이벤트 변경은 항상 **하나의 DB 트랜잭션**. `candidate_id UNIQUE`가 idempotency의 최종 방어선.
- **re-Approve 정책**: 수정 → 제거 → 다시 Approve하면 후보 원본 값으로 새 이벤트가 만들어지고 이전 수정은 복원되지 않는다. 제거 확인 문구에 그대로 안내한다: "다시 승인하면 추출된 후보 원본 값으로 일정이 새로 생성되며, 캘린더에서 직접 수정했던 내용은 복원되지 않습니다."

## 3. 데이터 모델 (schema v3)

현재 DB 확인 결과: `user_version = 2`, 테이블은 `imports / messages / schedule_candidates`뿐 — 실험용 `calendar_events`는 없다. 새 테이블 추가만으로 끝나며 기존 데이터를 건드리지 않는다.

```sql
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  candidate_id TEXT UNIQUE REFERENCES schedule_candidates(id) ON DELETE SET NULL,  -- nullable
  origin TEXT NOT NULL DEFAULT 'CANDIDATE',   -- M2-A는 CANDIDATE만 생성. 미래: MANUAL
  kind TEXT NOT NULL,                         -- EVENT | UPDATE_NOTICE | CANCEL_NOTICE
  title TEXT NOT NULL,
  start_at TEXT,                              -- canonical KST ISO. NULL = 날짜 미확정
  end_at TEXT,                                -- exclusive end (§5). NULL = 시작 시각만 아는 일정
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  category TEXT NOT NULL,
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);
```

- **provider / external_event_id / synced_at 컬럼은 제거**했다(v1 계획에 있던 것). 외부 연동 메타데이터는 M2-B의 `calendar_syncs`가 갖는다(§11).
- **`candidate_id` nullable + UNIQUE**: SQLite의 UNIQUE는 NULL을 여러 개 허용하므로 "파생 이벤트는 후보당 1개, 수동 이벤트는 NULL"이 한 테이블에서 성립한다.
- **FK 삭제 정책 = `ON DELETE SET NULL`** (명시적 결정). 이유: CalendarEvent는 사용자 일정이므로 추출 기록이 지워졌다고 사용자 일정(수정했을 수도 있는)이 함께 사라지면 안 된다. 이때 `origin`은 'CANDIDATE'로 남아 "원래 후보에서 왔다"는 이력을 뜻하고, 상세 패널은 원본 메시지 대신 "원본 후보가 삭제됨"을 보여 준다. 현재 앱에는 후보 hard delete 경로가 없어 실제 흐름에서는 status 변경이 lifecycle을 제어한다. (`foreign_keys = ON`은 `createDb`에서 이미 켜져 있다.)
- `schedule_candidates`는 건드리지 않는다.
- 마이그레이션: `SCHEMA_VERSION = 3`. 새 테이블이라 `CREATE TABLE IF NOT EXISTS`로 새 DB·기존 v2 DB 모두 처리된다. **버전이 3 미만에서 올라올 때 1회**, 이미 APPROVED인 후보의 이벤트를 backfill한다(그렇지 않으면 업그레이드 전에 승인한 일정이 캘린더에서 조용히 빠진다). 이것은 스키마 마이그레이션의 일부로 1회만 실행되며, 평상시 조회 경로와 무관하다(§6).

## 4. Candidate → CalendarEvent mapping

| Candidate | CalendarEvent |
|---|---|
| `title` (없으면 `"(제목 없음)"`) | `title` |
| `action` CREATE / UPDATE / CANCEL | `kind` EVENT / UPDATE_NOTICE / CANCEL_NOTICE |
| `location`, `category` | 그대로 |
| `start_at`, `end_at`, `all_day` | **§5 규칙으로 normalize** |

UPDATE / CANCEL은 기존 이벤트를 자동 변경하지 않는다. "어떤 이전 일정의 변경/취소인지"를 안정적으로 식별하는 layer가 아직 없기 때문이다. Logical event 연결은 이후 milestone.

## 5. 날짜 / 시간 semantics (구현 전에 테스트로 먼저 고정)

**원칙: CalendarEvent의 interval은 `[start, end)` — start 포함, end 제외.** Google Calendar의 all-day semantics(`end.date` = 마지막 날 다음 날)와 그대로 맞는다.

### 5-1. 먼저 확인한 사실 — 후보의 endAt 의미는 섞여 있다
실제 DB와 `rule-extractor.ts`를 확인한 결과(건수만):
- rule extractor: 날짜만 있는 끝은 **그날 포함**이고 `T23:59`로 저장(`END_OF_DAY`). all-day PERIOD/EVENT 58건.
- LLM: all-day 끝을 `T23:59`(22건) 또는 **`T00:00`(22건)**으로 저장. 후자도 프롬프트 규칙("날짜만 알면 T00:00 + allDay")상 **그날 포함**이라는 뜻이다(예: 월~금 개방 공지가 금요일 `T00:00`으로 끝남). 즉 `T00:00`을 exclusive 자정으로 읽으면 하루가 잘린다.
- all-day인데 끝에 실제 시각이 있는 후보 10건(`9/10 ~ 9/13 18:00` 형태).
- all-day인데 end가 NULL 148건, timed인데 end가 NULL 233건(DEADLINE 101 / MEETING 94 / EVENT 34 / PERIOD 4).
- LLM 출력은 스키마상 `Z`나 다른 offset, 초 생략도 허용된다.

→ 그래서 "1분 더하기" 같은 산술이 아니라 **KST 날짜 기준으로 normalize**한다. 후보 layer는 고치지 않고, mapping 단계에서만 처리한다.

### 5-2. normalize 규칙 (`candidate → event`)
0. 모든 시각은 `parseIsoToKst → toIsoKst`로 **canonical 형식(`YYYY-MM-DDTHH:mm:00+09:00`)**으로 다시 쓴다. 이벤트 테이블의 문자열 비교·정렬이 항상 시간순과 일치하게 하기 위함이다.
1. `start_at = NULL` → 날짜 미확정. `end_at = NULL`, 그리드에 올리지 않는다.
2. **all-day이고 끝이 없거나, 끝 시각이 `00:00` 또는 `23:59`** → `start = 시작일 00:00`, `end = (끝 날짜 또는 시작일) + 1일 00:00`, `all_day = 1`. 예: `9/1 ~ 9/3` → `[9/1 00:00, 9/4 00:00)`. 하루짜리 → `[9/22 00:00, 9/23 00:00)`. **all-day 이벤트는 항상 end가 있다.** (날짜만 있는 DEADLINE도 그날의 all-day 항목이 된다.)
3. **all-day인데 끝에 실제 시각이 있음**(10건) → 시각 정보를 버리지 않도록 timed로 바꾼다: `start = 시작일 00:00`, `end = 그 시각 그대로`, `all_day = 0`.
4. **timed** → start/end 그대로(canonical화만). `end = NULL`이면 "시작 시각만 알려진 일정"으로 NULL 유지. `end <= start`도 시점 일정으로 취급. **Google용 default duration 때문에 로컬 값을 바꾸지 않는다** — 그 정책은 M2-B mapper가 정한다.
5. **timed DEADLINE** → `start = 마감 시각`, `end = NULL` 유지. UI에서 "마감" 표시.

### 5-3. 화면·입력에서의 의미
- 이벤트가 차지하는 마지막 날 = `end`가 있으면 `(end − 1분)`의 KST 날짜, 없으면 시작일. 그래서 `22:00 ~ 다음 날 00:00` 일정은 다음 날 칸에 나타나지 않는다.
- "7일 이하 / 7일 초과"는 차지하는 **날 수**(마지막 날 − 시작일 + 1)로 판단한다.
- 수정 폼에서 all-day의 끝은 사람이 읽는 **포함 날짜**(9/3)로 보여 주고 입력받으며, 저장할 때 exclusive(9/4 00:00)로 바꾼다.

### 5-4. overlap query (`listOverlapping(rangeStart, rangeEnd)`, range도 `[start, end)`)
```sql
start_at IS NOT NULL AND start_at < :rangeEnd
AND CASE WHEN end_at IS NULL OR end_at <= start_at
         THEN start_at >= :rangeStart        -- 시점 일정
         ELSE end_at > :rangeStart END       -- 구간 일정
```
월 그리드의 range는 `[그리드 첫날 00:00, 그리드 마지막 날 + 1일 00:00)`.

## 6. 서버 로직 (framework-free)

| 파일 | 내용 |
|---|---|
| `src/lib/db/repositories/calendar-events.ts` | `insertFromCandidate`, `deleteByCandidate`, `findByCandidateId`, `getWithSource(id)`, `listOverlapping`, `listUndated`, `update`, `deleteById`, `countSameSlot(startAt, category)`. SQL은 기존 원칙대로 repositories에만. |
| `src/lib/calendar/types.ts` | `CalendarEvent` 타입. M2-B mapper가 의존할 유일한 입력 타입. |
| `src/lib/calendar/normalize.ts` | §5-2의 순수 함수 `candidateToEventFields(candidate)`. `src/lib/schedule/kst.ts`의 `parseIsoToKst / toIsoKst / addDays` 재사용. |
| `src/lib/calendar/candidate-event-link.ts` | (v1의 `sync.ts`에서 이름 변경 — Google sync와 혼동 방지.) `applyCandidateStatus(db, candidateId, status)`, `removeEventFromCalendar(db, eventId)`, `backfillApprovedCandidates(db)`(마이그레이션 전용), `reconcileCalendar(db, { apply })`. |
| `src/lib/calendar/month-grid.ts` | 순수 함수 `buildMonthGrid("YYYY-MM")`(일요일 시작 6주×7일), `placeEvents(events, grid)` → 날짜별 칩 + "긴 기간" 목록. `kst.ts`의 `addDays / weekdayOf / daysBetween` 재사용, 새 날짜 라이브러리 없음. |
| `src/lib/calendar/load-month.ts` | 캘린더 페이지가 쓰는 **읽기 전용** 로더 `loadCalendarMonth(db, month, { day?, eventId? })`. 페이지는 이것만 호출한다. |
| `src/lib/calendar/event-input.ts` | 수정 폼 검증(zod): 제목 1~200자, 날짜 `YYYY-MM-DD`, 시간 `HH:mm`, 종일 여부, 끝 ≥ 시작, 장소 ≤ 200자 → §5 규칙대로 canonical ISO로 변환. |

`src/app/candidates/actions.ts`의 `setCandidateStatus`는 `candidatesRepo.updateStatus` 직접 호출 대신 **`applyCandidateStatus`**를 호출하고 `revalidatePath("/calendar")`를 추가한다. 이것이 "승인하면 자동으로 캘린더에 들어감"의 전부다.

### `reconcileCalendar()`의 역할 = repair / maintenance (평상시 경로 아님)
- **`GET /calendar` 렌더에서 실행하지 않는다.** Server Component의 조회는 read-only다: 페이지를 읽는 것만으로 DB write가 일어나지 않는다. (v1 계획의 "페이지 로드 시 reconcile"은 삭제.) 정상 경로는 트랜잭션이 원자성을 보장하므로 조회 시 복구가 필요 없어야 한다.
- 수동 도구로만 제공: `npm run repair:calendar`(`scripts/repair-calendar.ts`). **기본은 dry-run 리포트**, `--apply`를 줘야 고친다. 검사: APPROVED인데 파생 이벤트 없음 / APPROVED가 아닌데 파생 이벤트 있음 / `origin='CANDIDATE'`인데 `candidate_id` NULL(후보 삭제 흔적, 보고만). 함수 자체는 테스트한다.
- 유일한 예외는 §3의 **v3 마이그레이션 1회 backfill**이다. 실행 조건: `user_version < 3`일 때만, 스키마 생성과 같은 트랜잭션에서. (참고: dev 서버의 hot-reload 연결은 첫 `getDb()` 호출 때 마이그레이션이 돌 수 있는데, 이는 v2 컬럼 추가와 동일한 기존 동작이며 버전이 바뀌는 그 1회뿐이다.)

## 7. 화면

### 7-1. 탭
`src/app/layout.tsx` 내비게이션에 `캘린더`(`/calendar`) 추가. `ExtractionBanner`는 `/`가 아닌 모든 페이지에 이미 뜨므로 그대로 동작.

### 7-2. `/calendar` (`src/app/calendar/page.tsx`, server component, `force-dynamic`, **read-only**)
상태는 전부 URL에(후보 필터와 같은 방식): `?month=YYYY-MM`(기본 = KST 이번 달) · `?day=YYYY-MM-DD` · `?event=<id>`.

- **헤더**: `‹ 이전 달` · `2026년 9월` · `다음 달 ›` · `오늘` · 이번 달 일정 수.
- **월 그리드** (`src/components/CalendarMonth.tsx`, 직접 구현 — 라이브러리 없음, Tailwind만):
  - 7열(일~토), 오늘 강조, 다른 달 날짜는 흐리게.
  - 하루 칸에 칩 최대 3개 + **`+N개 더`**(→ `?day=`로 그날 전체 목록).
  - 칩: 시간(종일이면 생략, end 없으면 시작 시각만) + 제목, 분류별 색, DEADLINE은 "마감" 표시.
  - **UPDATE_NOTICE = 주황 "변경 공지", CANCEL_NOTICE = 빨강 + 취소선 "취소 공지"** (`CandidateCard`의 `ACTION_STYLE` 색과 통일).
  - 여러 날 일정: **7일 이하**는 차지하는 날마다 칩 반복(첫날만 제목 전체, 이후 "↳ 계속"). **7일 초과**는 시작일·마지막 날에만 "시작"/"종료" 칩 + 그리드 위 **"진행 중인 기간" 줄**에 목록.
- **날짜 미확정 (N)**: 그리드 아래 목록. 수정으로 날짜를 넣으면 그리드로 올라간다.
- **상세/수정 패널** (`src/components/CalendarEventPanel.tsx`, `?event=`일 때):
  - 제목·일시·장소·분류·kind, `edited_at` 있으면 "캘린더에서 수정됨"(후보 원본 값도 함께 보여 줌).
  - **원본 메시지 보기**(`CandidateCard`의 `<details>` 패턴 재사용) + 해당 후보로 가는 링크. `candidate_id`가 NULL이면 "원본 후보 없음".
  - **중복 안내**: 같은 시작시각+분류의 다른 이벤트가 있으면 "같은 시각의 일정이 N건 더 있습니다" + 링크.
  - **수정 폼** → server action `updateCalendarEvent`. **제거** → `<details>`로 한 번 더 확인(§2의 re-Approve 안내 문구 포함) 후 `removeCalendarEvent`. JS `confirm()` 미사용.
- server actions: `src/app/calendar/actions.ts`(`"use server"`, zod 검증, `revalidatePath("/calendar")` + `"/candidates"`). **DB write는 여기와 `candidates/actions.ts`에만 있다.**

### 7-3. 일정 후보 화면 보강 (`src/components/CandidateCard.tsx`, `src/app/candidates/page.tsx`)
- APPROVED 카드에 **"캘린더에서 보기"** 링크.
- PENDING 카드에 **중복 힌트**: 같은 시작시각+분류의 이벤트가 이미 캘린더에 있으면 "이미 캘린더에 같은 시각의 일정이 있습니다"(승인은 막지 않음).

### 7-4. 중복은 자동 병합하지 않는다
힌트만 보여 주고 자동 merge / delete / dedup은 하지 않는다. 반복 공지처럼 보여도 실제로 다른 일정일 수 있고, M2-A에서는 사용자 검토가 더 안전하다.

## 8. 테스트 (`src/lib/calendar/calendar.test.ts`, `createDb(":memory:")` + `tests/fixtures/kakao/schedules.txt`)

- **invariant**: APPROVED → 정확히 1개 / Approve 두 번 → 여전히 1개 / IGNORED·PENDING → 파생 이벤트 없음 / 캘린더 제거 → 후보 IGNORED / 캘린더 수정 → 후보 추출값 불변 + `edited_at` 기록 / 제거 → re-Approve → 후보 원본 값으로 재생성(이전 수정 미복원) / 재업로드 후 이벤트 불변.
- **transaction**: 이벤트 insert가 실패하도록 만들면 후보 status도 롤백되는지, 반대 방향도.
- **read side-effect 없음**: `loadCalendarMonth()` 호출 전후 `SELECT total_changes()`가 같은지.
- **FK**: 후보 행을 직접 지우면 이벤트는 남고 `candidate_id`만 NULL이 되는지. `candidate_id` NULL 이벤트가 여러 개 공존하는지.
- **migration**: 새 DB / 기존 v2 DB(파일 DB로 재오픈) 모두 테이블 생성, v2에 APPROVED 후보가 있던 경우 1회 backfill, 두 번째 오픈에서는 아무 변화 없음.
- **date semantics**(normalize + overlap + grid, 규칙을 구현보다 먼저 테스트로 고정): all-day single-day / all-day multi-day(`T23:59` 끝, `T00:00` 끝 둘 다 같은 결과) / all-day + 끝에 실제 시각 / timed end 없음 / DEADLINE end 없음 / PERIOD / 월 경계 / 연 경계 / 윤년 2월 / 정확히 자정에 끝나는 일정(다음 날 칸에 없음) / 7일 이하 / 7일 초과 / 날짜 미확정 / `Z`·초 없는 ISO의 canonical화.
- **repair**: `reconcileCalendar` dry-run은 write 없음, `apply`는 양방향 복구.
- **입력 검증**: 끝 < 시작, 잘못된 날짜·시간, 빈 제목 거부; all-day 포함 날짜 ↔ exclusive 변환.

## 9. 구현 순서와 완료 조건

| # | 단계 | 완료 조건 |
|---|---|---|
| 0 | 계획 승인. `node_modules/next/dist/docs/`에서 **server actions · searchParams · revalidatePath** 문서를 먼저 읽는다(AGENTS.md). | 사용자 승인 |
| 1 | schema v3 + `calendar-events` repository (provider 컬럼 없음, nullable UNIQUE `candidate_id`, `ON DELETE SET NULL`) | migration·FK 테스트 통과 |
| 2 | Candidate → Local Event lifecycle: `normalize.ts`는 3단계에서 채우되 여기서는 lifecycle(`candidate-event-link.ts`), `setCandidateStatus` 연결, backfill, repair CLI | invariant·transaction·repair 테스트 통과 |
| 3 | date semantics + month grid: **테스트를 먼저 작성**해 §5 규칙을 고정한 뒤 `normalize.ts`, `listOverlapping`, `month-grid.ts` 구현 | date semantics 테스트 통과 |
| 4 | read-only `/calendar`(그리드·월 이동·`+N개 더`·일자 목록·미확정 목록) + 탭 | read side-effect 테스트 통과. 브라우저에서 2025-03~2026-10 이동, 가장 붐비는 날 정상 표시 |
| 5 | 상세 패널 + 수정/제거 actions + `event-input.ts` | 입력 검증 테스트 통과. 브라우저: 수정 반영, 제거 시 후보 IGNORED |
| 6 | 후보 카드 보강(캘린더 링크, 중복 힌트) | 브라우저 확인 |
| 7 | 문서: README와 plan.md §19에 `ScheduleCandidate → Local CalendarEvent → Google Calendar` 구조와 M2-B boundary 명시. `npm test / typecheck / lint` | 전부 통과 |

각 단계는 독립적으로 커밋 가능한 크기다. 1~3은 UI 없이 테스트만으로 끝난다.

## 10. 범위 밖 (M2-A에서 하지 않음)

Google Calendar API · Google OAuth runtime · Google event create/update/delete · 사용자 직접 일정 추가 UI · 주간/일간 view · drag & drop · 반복 일정 · UPDATE/CANCEL 대상 일정 자동 연결 · semantic duplicate merge · 알림 · ICS export · multi-user · 양방향 external sync.
단, 사용자 직접 일정이 미래에 가능하도록 Local CalendarEvent 모델은 candidate가 반드시 있어야 하는 구조로 고정하지 않는다(§3).

## 11. M2-B boundary — Google Calendar Sync (이번에 구현하지 않음, 문서화만)

```text
CalendarEvent → Google Event Mapper → Google Calendar Adapter → Google Calendar API
                                                   ↓
                                            calendar_syncs
```

M2-B에서 추가할 테이블(이번에는 만들지 않는다):
```sql
calendar_syncs (
  id TEXT PRIMARY KEY,
  calendar_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- M2-B에서는 'google'
  external_event_id TEXT,
  sync_status TEXT NOT NULL,         -- PENDING | SYNCED | FAILED …
  synced_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (calendar_event_id, provider)
);
```

규칙:
1. Google Calendar는 `ScheduleCandidate`를 직접 읽지 않는다. 항상 Local `CalendarEvent`가 source.
2. external event id와 sync status는 `calendar_syncs`가 관리한다.
3. Google OAuth token은 별도 account/auth storage에서 server-only로 관리한다. (OAuth Web Client는 이미 만들어져 있지만 M2-A에서는 쓰지 않는다.)
4. 초기 범위는 CREATE sync부터. 양방향 sync 없음. UPDATE/CANCEL 자동 reconciliation 없음. 로컬 수정 → Google update는 단계적으로 추가.
5. `end_at = NULL`(시작 시각만 아는 일정·DEADLINE)의 Google duration(예: +1시간)은 **M2-B mapper**가 정한다. all-day는 `[start, end)`가 `start.date / end.date`에 그대로 대응한다.

> **M2-B 구현됨 (2026-09-19)** — `docs/google-calendar-sync.md`. 아래 열린 문제는 "로컬 hard delete + `calendar_syncs ON DELETE CASCADE`를 유지하고, 원격 일정은 지우지 않으며, 제거→재승인은 새 일정으로 취급"하는 것으로 정리하고 UI·문서에 한계를 명시했다. 전송 중에는 삭제를 막는 guard를 추가했다.

**M2-B에서 풀어야 할 열린 문제(이번 검토에서 발견)**: M2-A는 로컬 이벤트를 hard delete하고, `calendar_syncs`는 `ON DELETE CASCADE`다. 그러면 로컬에서 제거하는 순간 `external_event_id`가 같이 사라져 **Google 쪽 이벤트를 지울 방법이 없어지고**, 제거 → re-Approve는 새 `id`를 만들므로 Google에 중복 이벤트가 생길 수 있다. M2-B 설계 시 "원격 삭제를 먼저 수행" 또는 "tombstone/soft delete" 중 하나를 정해야 한다. M2-A의 스키마는 이 선택을 막지 않는다(컬럼 추가로 해결 가능).

## 12. 위험과 대응

| 위험 | 대응 |
|---|---|
| 후보 endAt 의미가 섞여 있어 하루가 잘리거나 늘어남 | §5-2의 날짜 기준 normalize + `T23:59`/`T00:00` 동치 테스트 |
| 반복 공지로 같은 일정이 여러 번 승인됨 | 승인 전 힌트 + 상세 패널 중복 안내. 병합하지 않아 데이터 손실 없음 |
| 364일짜리 PERIOD가 달력을 뒤덮음 | 7일 초과는 시작/종료 칩 + "진행 중인 기간" 줄 |
| 불변식이 깨짐(직접 DB 수정, 중간 크래시) | 단일 트랜잭션 + 수동 `repair:calendar`(dry-run 기본). 페이지 렌더는 고치지 않는다 |
| 업그레이드 전에 승인한 후보가 캘린더에서 빠짐 | v3 마이그레이션 1회 backfill |
| 수정 후 제거 → 재승인 시 수정 내용 소실 | 제거 확인 문구에 명시 |
| 날짜·시간대 버그 | 모든 계산을 `kst.ts`의 KstDate로, `Date`의 로컬 시간대 미사용. canonical ISO |
| 사용자의 실제 검토 데이터 훼손 | 테스트는 `:memory:`/임시 파일 DB만 사용. 브라우저 확인에 쓴 승인·수정은 끝난 뒤 원래대로 되돌린다 |
| Next 16 API 차이 | 0단계에서 문서 확인, 기존 `candidates` 페이지/액션 패턴을 따름 |

## 13. Definition of Done — M2-A

- [ ] `APPROVED` Candidate는 정확히 하나의 Local CalendarEvent를 가진다. 여러 번 Approve해도 중복 생성되지 않는다.
- [ ] PENDING / IGNORED로 바꾸면 파생 이벤트가 제거된다. 캘린더에서 제거하면 후보가 IGNORED가 된다.
- [ ] 캘린더에서 수정해도 ScheduleCandidate 추출 결과는 바뀌지 않는다. re-Approve 시 후보 원본에서 다시 생성된다.
- [ ] `/calendar` page render는 DB write side effect가 없다(테스트로 확인).
- [ ] 월간 캘린더에서 날짜 미확정 / 긴 PERIOD / 많은 이벤트가 정상 표시된다.
- [ ] all-day / timed / end-null / DEADLINE / PERIOD / exclusive-end semantics가 문서(§5)와 테스트로 고정되어 있다.
- [ ] `calendar_events`에 Google/provider-specific 필드가 없다. M2-B boundary가 문서화되어 있다. Google OAuth / Calendar API는 호출하지 않는다.
- [ ] FK 삭제 정책이 명시되어 있고 테스트된다.
- [ ] 기존 M1 parser / detector / extractor 동작과 candidate schema를 바꾸지 않았다. 기존 검토 데이터가 손상되지 않았다.
- [ ] `npm test`, `npm run typecheck`, `npm run lint` 통과.

### 변경 이력 (v1 → v2)
1. 단계 이름을 **M2-A Local Calendar**로 정의, `CalendarEvent`를 canonical local entity로 명시, 3-layer architecture 추가(§1).
2. invariant를 양방향(⇔)에서 **파생 이벤트 기준 단방향**으로 완화(§2).
3. `calendar_events`에서 `provider / external_event_id / synced_at` 제거, `origin` 추가, `candidate_id` nullable, **`ON DELETE SET NULL` 명시**(§3).
4. **`/calendar` 렌더의 `reconcileCalendar()` 제거** → 수동 repair CLI(dry-run 기본) + v3 마이그레이션 1회 backfill + read-only 테스트(§6).
5. **날짜 semantics 신설**: `[start, end)`, 실제 데이터 확인에 근거한 normalize 규칙, canonical ISO, overlap query(§5). — 지시서에 없던 추가: 후보 endAt이 `T23:59`/`T00:00`/실제 시각으로 섞여 있다는 발견과 그 처리.
6. `sync.ts` → `candidate-event-link.ts`, `types.ts`·`normalize.ts`·`load-month.ts` 추가, repository에 `findByCandidateId` 추가(§6).
7. M2-B boundary와 `calendar_syncs` 문서화, **로컬 hard delete ↔ 원격 삭제 문제**를 열린 문제로 기록(§11).
8. 테스트 계획·DoD 확장(§8, §13). UI·중복·UPDATE/CANCEL 정책은 v1 그대로 유지.

### 구현 결과 (2026-09-19)
- 순서 변경 1건: 승인 시 이벤트를 만들려면 §5의 normalize가 먼저 필요해서, 3단계의 `normalize.ts`와 그 테스트를 2단계보다 먼저 만들었다.
- 계획 대비 추가: `src/lib/calendar/format.ts`(표시용 문구), `CalendarEventForm.tsx`(수정 폼만 client component — `useActionState`로 검증 오류 표시), 공유 타입을 `src/lib/calendar/types.ts`로 모음(components는 `@/lib/db/*`를 import할 수 없다는 기존 ESLint 규칙 때문).
- 검증: `src/lib/calendar/calendar.test.ts` 24개 포함 전체 152개 테스트, typecheck, lint 통과. 실제 DB + 브라우저에서 승인 → 표시(`+N개 더`, 20건짜리 날, 긴 기간 줄, 변경 공지, 날짜 미확정) → 잘못된 수정 거부 → 수정(달 이동, "추출된 원래 값" 표시) → 제거(후보 IGNORED) 확인 후, 확인에 쓴 25건을 모두 PENDING으로 되돌렸다(이벤트 0건, `repair:calendar` dry-run 이상 없음).
- 확인하지 못한 것: CANCEL 공지의 실제 화면(실제 DB에 CANCEL 후보가 없음 — 테스트 fixture로만 검증).
