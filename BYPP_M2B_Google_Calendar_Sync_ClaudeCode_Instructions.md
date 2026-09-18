# BYPP M2-B — Google Calendar CREATE Sync 구현 지시서

이 문서를 구현 요청으로 취급하고, 현재 저장소를 확인한 뒤 코드·테스트·문서까지 완성하라. 계획만 제안하고 종료하지 않는다. 이번 작업은 이미 구현된 M2-A Local Calendar에 Google 연결과 명시적인 일정별 CREATE 동기화를 추가하는 것이다.

## 1. 전제와 절대 지켜야 할 경계

```text
ScheduleCandidate → Local CalendarEvent → Google Event Mapper → Google Calendar API
                                                ↓
                                          calendar_syncs
```

- **Local CalendarEvent가 source of truth다.** Google 연동 모듈은 ScheduleCandidate, 원본 메시지, 후보 repository를 직접 읽거나 import하지 않는다.
- `calendar_events` repository에서 ID로 조회한 현재 로컬 값만 전송한다. 브라우저가 보낸 제목·일시·장소를 신뢰해 전송하지 않는다.
- 로컬에서 수정한 값이 후보 추출값보다 우선한다. `candidateId = null`인 일정도 동일한 조건으로 동기화할 수 있어야 한다.
- 후보 승인, 업로드, 추출, 페이지 렌더, OAuth 연결 완료만으로 일정을 Google에 생성하지 않는다. 사용자가 로컬 일정의 전송 버튼을 누를 때만 실행한다.
- 단일 로컬 사용자, 단일 Google 계정, 해당 계정의 기본 캘린더를 대상으로 한다. Google OAuth는 앱의 다중 사용자 로그인 구현이 아니다.
- `calendar_events`에는 Google 전용 필드를 추가하지 않는다. 외부 연결 상태는 별도 테이블에 둔다.
- 기존 작업 트리 변경을 보존한다. DB 초기화·실제 데이터 삭제·무관한 리팩터링·자동 커밋을 하지 않는다.

## 2. 환경 및 구현 전 조사

현재 `.env.local`에는 다음 **대문자 이름 세 개가 이미 존재한다.** 재입력을 요청하거나 파일을 덮어쓰지 않는다.

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...
```

- 실제 값은 출력·복사·로그·문서·테스트 fixture에 넣지 않는다. `NEXT_PUBLIC_` 변수를 만들지 않는다.
- `.env.example`에는 이름과 가짜 예시만 기재한다. URI는 기존 설정을 사용하고 Google Console 등록 URI와 정확히 일치해야 함을 문서화한다.
- 먼저 `AGENTS.md`, `CLAUDE.md`, `README.md`, `plan_base_calendar.md`를 읽는다. M2-A 문서의 “M2-B 범위 밖”은 이전 단계의 경계이며, 이번 구현의 금지가 아니다.
- Next.js 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 Route Handlers, cookies, Server Actions, 캐시 관련 가이드를 읽는다.
- 실제 구조를 우선한다. 현재 주요 파일은 다음과 같다.

| 영역 | 확인할 파일 |
|---|---|
| 로컬 이벤트 타입·시간 규칙 | `src/lib/calendar/types.ts`, `normalize.ts`, `event-input.ts` |
| DB·마이그레이션 | `src/lib/db/schema.ts`, `client.ts` |
| 로컬 이벤트 저장 | `src/lib/db/repositories/calendar-events.ts` |
| 후보와 로컬 일정 생명주기 | `src/lib/calendar/candidate-event-link.ts` |
| 화면·액션 | `src/app/calendar/page.tsx`, `actions.ts` |
| 상세·수정 UI | `src/components/CalendarEventPanel.tsx`, `CalendarEventForm.tsx` |
| 기존 회귀 테스트 | `src/lib/calendar/calendar.test.ts` |

### 공식 문서 확인 필수

OAuth/API 구현 직전에 아래 Google 공식 문서를 직접 열어 최신 내용을 확인하라. 접근이 안 되면 확인했다고 주장하지 말고 한계를 보고한다. 사용한 문서, 확인 날짜, 선택한 scope와 SDK를 구현 문서에 남긴다. 이 지시서 작성 시 확인일은 2026-09-19다.

- [Web Server OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/web-server): Authorization Code Flow, offline access, state, 토큰 갱신.
- [OAuth 보안 권고](https://developers.google.com/identity/protocols/oauth2/resources/best-practices): 자격 증명 보관과 오류 처리.
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth): 필요한 최소 권한 선택.
- [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert): 생성 요청, 필수 필드와 허용 scope.
- [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events): 날짜·시간, 배타적 종료일, 사용자 지정 ID.
- [events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get): 생성 결과가 불확실할 때 같은 ID의 존재 확인.
- [Google APIs Node.js client](https://github.com/googleapis/google-api-nodejs-client): 공식 SDK 사용법.

## 3. 이번 단계의 범위

구현한다:

- Google OAuth Authorization Code Flow와 서버 측 토큰 영속 저장·갱신.
- `GET /api/auth/google`, `GET /api/auth/google/callback`.
- Google Calendar API adapter와 Local CalendarEvent → Google Event 순수 mapper.
- 일정별 명시적 CREATE 요청, 재시도, 중복 생성 방지.
- `calendar_syncs` 테이블 및 repository.
- `/calendar`의 Google 연결 상태와 일정별 동기화 상태.

구현하지 않는다:

- 양방향 sync, Google 일정 목록 가져오기, webhook, 주기적 백그라운드 sync.
- UPDATE/CANCEL reconciliation, Google 이벤트 patch/update/delete.
- 다중 provider, 다중 계정, 캘린더 선택 UI, 별도 캘린더 생성.
- 반복 일정, 참석자 초대, 회의 링크 생성, 후보에서 Google로 직접 보내기.

## 4. OAuth와 토큰 관리

### 시작·콜백

1. 서버에서 환경설정 존재 여부를 검사하고 미설정이면 안전한 설정 오류를 표시한다.
2. `response_type=code`, `access_type=offline`을 사용한다. 최초 연결 및 refresh token 재확보 흐름에서는 `prompt=consent`를 사용한다.
3. 기본 캘린더의 이벤트 생성에 필요한 최소 scope를 공식 문서에 따라 선택한다. `calendar.events.owned`를 우선 검토하고, `calendar.events`가 필요하다면 이유를 기록한다. 전체 Calendar 관리 권한을 편의상 요청하지 않는다.
4. 암호학적으로 안전한 일회용 `state`를 생성하고 브라우저 세션과 묶어 서버에서 검증한다. 짧은 만료시간, HttpOnly·SameSite=Lax 쿠키, HTTPS에서 Secure를 적용한다. 재사용·누락·불일치·만료를 거부하고 토큰 교환 전에 state를 소비한다.
5. 콜백은 code 교환을 서버에서만 수행한다. 승인 거부, code 누락, scope 부족, 교환 실패를 처리한다. 성공·실패 후 code가 없는 고정된 로컬 `/calendar` 경로로 이동한다. 임의 redirect URL을 허용하지 않는다.
6. 토큰·code·state를 응답 본문이나 오류 메시지에 포함하지 않는다. 콜백 URL query를 애플리케이션/access log에 남기지 않도록 실행환경의 로깅도 확인하고, 남는 제약은 문서화한다.

### 영속 저장·갱신

- 서버 전용 SQLite connection repository 등 명확한 저장 계층에 refresh token, 필요 시 access token, 만료시각, 허용 scope, 연결 상태를 저장한다. 서버 재시작 후에도 연결을 사용할 수 있어야 한다.
- 토큰은 UI props, RSC payload, Client Component, localStorage, 브라우저 쿠키, API 상태 응답에 넣지 않는다. UI에는 안전한 상태 DTO만 보낸다.
- 저장소는 public 디렉터리 밖에 두고 gitignore를 확인한다. 저장 데이터의 접근 통제 및 암호화 여부를 문서화한다. 암호화한다면 키를 같은 DB나 client secret에서 만들지 않는다.
- access token이 만료되기 전에 refresh token으로 갱신한다. 회전된 refresh token이 있으면 원자적으로 반영한다.
- **토큰 응답에 refresh token이 없다고 기존 값을 null로 덮어쓰지 않는다.** 단, 기존 토큰의 재사용은 동일 계정임을 검증한 경우에만 허용한다.
- 최초 연결에 refresh token이 없으면 지속 연결 성공으로 표시하지 말고 재동의가 필요함을 표시한다.
- 기존 계정과 새 계정을 구별할 안정적인 식별 방식을 정한다. 필요하면 최소 OIDC scope와 검증된 `sub`를 사용하고 근거를 기록한다. 동기화 이력이 있는 연결을 다른 계정으로 조용히 교체하지 않는다.
- `invalid_grant`·철회·필수 권한 부족은 재연결 필요 상태로 전환한다. 일반 네트워크 오류를 계정 철회로 단정하지 않는다.
- OAuth SDK/HTTP 오류 객체를 그대로 로그에 찍지 않는다. 토큰 응답과 요청 헤더가 포함될 수 있다. 내부 오류 코드를 안전한 한국어 메시지로 매핑한다.

## 5. DB와 상태 모델

기존 schema version과 마이그레이션 방식에 맞춰 증가시키고 기존 데이터가 보존되도록 적용한다. 새 DB와 기존 v3 DB 모두 지원한다.

`calendar_syncs` 필수 필드:

```text
id                    TEXT PRIMARY KEY
calendar_event_id     TEXT NOT NULL, FK → calendar_events(id)
provider              TEXT NOT NULL, CHECK(provider = 'google')
external_event_id     TEXT NULL
sync_status           TEXT NOT NULL
synced_at             TEXT NULL
last_error            TEXT NULL
created_at            TEXT NOT NULL
updated_at            TEXT NOT NULL
UNIQUE(calendar_event_id, provider)
```

- 상태는 `PENDING`, `SYNCING`, `SYNCED`, `FAILED`를 기본으로 한다. 행 없음은 미동기화다. 필요하다면 불확실한 결과를 구분하는 상태를 추가하되 의미를 문서화한다.
- `SYNCED`는 실제 생성 또는 기존 동일 이벤트 확인에 성공한 상태다. 성공 시 `external_event_id`, `synced_at`을 저장하고 `last_error`를 지운다.
- 실패 시 안전한 오류만 저장한다. 실패했다고 이미 확보한 외부 ID나 성공 이력을 무조건 삭제하지 않는다.
- 연결 식별자, 대상 캘린더 식별자, 전송한 로컬 버전/해시, lease 정보 등 안전한 재시도에 필요한 최소 필드는 추가할 수 있다.
- `primary`는 계정에 종속된 별칭이다. 어떤 연결의 어느 캘린더에 생성했는지 재시도 시 일관되게 식별할 수 있어야 한다.
- `calendar_syncs`는 후보 ID를 FK로 사용하지 않는다. SQL은 repository에 모은다.

## 6. CREATE와 중복 방지

- 공식 SDK의 `calendar.events.insert` 또는 동등한 서버 API client를 사용한다. OAuth, API adapter, mapper, orchestration을 나눠 mock 주입이 가능하게 한다.
- 요청은 Local CalendarEvent ID만 받아 서버에서 재조회·검증한다. 쓰기는 Server Action 또는 POST Route Handler로 수행하고 same-origin/CSRF 보호를 유지한다. GET으로 이벤트를 생성하지 않는다.
- 이미 `SYNCED`인 동일 이벤트는 성공 상태를 반환하고 Google insert를 다시 호출하지 않는다.
- DB의 UNIQUE 제약만으로 원격 중복이 막힌다고 가정하지 않는다. 동시 클릭을 막는 UI와 별도로 DB의 원자적인 claim/상태 전이로 경쟁을 제어한다.
- 네트워크 호출 중 SQLite transaction을 열어 둔 채 기다리지 않는다. 프로세스 종료 후 만료된 `SYNCING` 작업을 복구할 수 있도록 lease/timeout 정책을 둔다.
- **원격 생성 성공 후 응답 유실 또는 로컬 DB 기록 실패**를 처리한다. 같은 로컬 이벤트에는 재시도해도 동일한 Google event ID를 사용한다. Google ID 규칙에 맞는 충돌 가능성이 낮은 값을 만들고 요청 전에 영속화하거나 안정적으로 재계산한다.
- `external_event_id`를 성공 전 예약 ID로 쓸지 별도 요청 ID를 둘지 명시한다. 예약만 된 ID를 생성 성공으로 표시하지 않는다.
- timeout/409 등 결과가 불확실하면 동일 ID를 조회하고 앱·로컬 이벤트 식별 metadata를 확인해 성공 여부를 복구한다. 409만 보고 성공 처리하거나 새 ID를 생성하지 않는다.
- private extended properties에는 앱 식별자와 로컬 이벤트 식별자를 넣을 수 있다. 후보 원문·발신자·대화방은 넣지 않는다.
- 일시 오류·429·5xx는 제한된 재시도 또는 명시적 사용자 재시도를 제공한다. 401 갱신 재시도도 유한하게 제한한다. 무한 재시도하지 않는다.
- 생성 중 로컬 일정이 수정되면 전송 시점 snapshot과 현재 값을 구분한다. 나중 값까지 반영되었다고 표시하지 않는다.

## 7. Mapper와 동기화 대상

입력은 `CalendarEvent`다. 상세 화면용 `CalendarEventWithSource.source`를 전달하지 않는다.

| 로컬 | Google |
|---|---|
| `title` | `summary` |
| `location` | `location` — null이면 생략 |
| 시간 일정의 `startAt`, `endAt` | `start.dateTime`, `end.dateTime`, `Asia/Seoul` |
| 종일 일정의 `startAt`, `endAt` | KST 날짜의 `start.date`, `end.date` |

- 기존 M2-A는 KST ISO와 `[start, end)` 규칙을 사용한다. 종일 종료일은 이미 배타적이므로 하루를 다시 더하지 않는다. UTC 변환으로 날짜를 하루 앞당기지 않는다.
- `kind = EVENT`만 CREATE 대상이다. `UPDATE_NOTICE`, `CANCEL_NOTICE`는 “변경·취소 공지는 전송 대상이 아닙니다”로 표시하고 요청을 막는다.
- 시작 날짜 미확정은 전송하지 않는다.
- **이번 단계에서는 종료 시각이 없는 시간 일정도 전송을 막고 종료 시각 입력을 안내한다.** Google 요청을 맞추기 위해 임의의 30분/1시간을 더하거나 로컬 데이터를 수정하지 않는다. 이는 `DEADLINE`에도 동일하다.
- 비정상 날짜, 종료 ≤ 시작, 잘못된 종일 구간은 API 호출 전에 거부한다.
- 일정을 생성할 때 후보 설명·원문 메시지·발신자 정보를 description에 넣지 않는다. 참석자·반복·회의·알림 설정은 추가하지 않는다.
- 검증 실패는 사용자가 수정할 수 있는 사유로 표시하고, 존재하지 않는 ID에는 적절한 not-found 결과를 반환한다.

## 8. 기존 수정·삭제 흐름과의 관계

- 이미 전송한 일정을 로컬에서 수정해도 Google UPDATE를 호출하지 않는다. UI에는 “Google에 생성됨”과 “이후 로컬 변경은 미반영”을 구분한다. 전송한 snapshot/hash 기준으로 판별할 수 있다.
- `SYNCED` 행을 삭제하거나 PENDING으로 되돌려 재생성하는 방식으로 수정 동기화를 흉내 내지 않는다.
- 로컬 삭제는 Google 삭제를 의미하지 않는다. 기존 로컬 제거 확인 UI와 후보 상태 변경 경로 모두에서 이 의미를 일관되게 안내한다.
- M2-A의 `ON DELETE CASCADE` 제안은 로컬 이력도 지워진다는 뜻이다. 이를 채택하면 원격 일정은 남고, 제거 후 재승인으로 만들어진 **새 Local CalendarEvent**는 별도 일정이라는 한계를 문서화한다. 제목·날짜·후보 ID로 원격 일정을 자동 병합하지 않는다.
- 진행 중인 sync의 로컬 삭제를 허용해 성공 기록이 사라지지 않도록 보호한다. 후보 ignore/승인 취소, 캘린더 제거, repair 등 동일 이벤트를 삭제하는 모든 경로를 확인하고 필요한 최소 guard를 공유한다.
- 기존 M2-A 생명주기를 크게 바꾸는 soft-delete/reconciliation 시스템을 이번에 도입하지 않는다.

## 9. UI

- `/calendar`에 미연결 / 연결됨 / 재연결 필요 / 설정 미완료 상태와 “Google 연결” 동작을 제공한다.
- OAuth 성공 직후 자동으로 전체 일정을 보내지 않는다.
- 이벤트 상세에 미동기화 / 전송 중 / Google에 생성됨 / 실패 / 전송 불가 사유를 표시한다. 성공 시 동기화 시각을 표시한다.
- 가능한 이벤트에는 “Google에 일정 생성” 버튼을, 실패한 이벤트에는 안전한 재시도 버튼을 제공한다. 진행 중·이미 생성됨·미연결·대상 아님 상태에서는 중복 실행을 막는다.
- 연결 필요 사유, 날짜/종료 시각 보완 필요 사유를 사용자에게 구체적으로 안내한다.
- 목록이나 월간 칩에도 가벼운 상태 표시를 추가하되 기존 일정보기를 방해하지 않는다. 상태 조회는 묶어서 수행하고 이벤트마다 Google API를 호출하지 않는다.
- UI에 “양방향 동기화 완료”처럼 이번 범위를 넘는 표현을 사용하지 않는다.

## 10. 테스트와 검증

테스트는 임시 DB와 mock OAuth/Calendar client만 사용한다. 실제 `.env.local`의 자격 증명, 실제 DB, 실제 Google API에 의존하지 않는다. 예상하지 못한 네트워크 요청은 테스트 실패가 되도록 막는다.

필수 검증:

1. OAuth URL의 code/offline/scope/state, state 불일치·만료·재사용 차단, 승인 거부, code 누락.
2. refresh token 최초 저장, 동일 계정 재승인 시 미반환 토큰 보존, 다른 계정 토큰 혼합 차단, 서버 재시작 후 복원.
3. access token 만료 갱신, refresh token 회전, `invalid_grant`, scope 부족, 재시도 상한.
4. 토큰·client secret·authorization code가 UI DTO·응답·로그·오류 저장값에 포함되지 않음. 가짜 비밀값을 써서 검증한다.
5. 기존 DB 마이그레이션과 재실행, UNIQUE 제약, FK 삭제 정책, 기존 데이터 보존.
6. 종일 하루·여러 날, 월/연 경계, KST 자정, 시간 일정 mapper. 기존 exclusive end를 이중 보정하지 않음.
7. 날짜 미확정·종료 미확정·잘못된 구간·UPDATE/CANCEL_NOTICE는 API 호출 0회.
8. 후보와 값이 다른 로컬 수정 일정은 로컬 값으로 전송. `candidateId=null`도 성공. sync 코드에 후보 repository 의존 없음.
9. 최초 성공 후 `external_event_id`, `SYNCED`, `synced_at` 저장. 재호출·동시 호출 시 원격 중복 생성 방지.
10. 원격 성공 후 timeout/DB 실패, 동일 ID 재시도·409 확인, metadata 불일치, stale lease 복구.
11. 실패 후 재시도 성공 시 오류 제거. 이미 생성된 일정은 로컬 수정 후에도 insert/update/delete를 호출하지 않음.
12. 생성 중 로컬 수정/삭제 경쟁 및 후보 상태 변경 경로. 렌더·연결 콜백만으로 원격 생성되지 않음.
13. 기존 M1/M2-A 테스트 회귀 통과와 UI 상태·버튼 동작 확인.

실행할 검사:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

build·import·페이지 렌더 시 외부 API가 호출되지 않아야 한다. 실제 Google 연결·이벤트 생성 smoke test는 자동 테스트와 분리하고, 사용자가 직접 실행할 절차를 README에 제공한다. 이번 구현 검증을 위해 실제 사용자 캘린더에 테스트 일정을 임의 생성하지 않는다.

## 11. 구현 순서와 완료 보고

1. 저장소·Next.js 가이드·Google 공식 문서 확인, 결정 사항을 짧게 정리한다.
2. 마이그레이션, 토큰/동기화 repository, 순수 mapper와 테스트를 구현한다.
3. OAuth route와 토큰 갱신, mock 테스트를 구현한다.
4. Calendar adapter, CREATE orchestration, 동시성·재시도 복구를 구현한다.
5. UI와 기존 삭제/수정 경계 보호를 연결한다.
6. 전체 검사 후 README 및 M2-B 구현 문서를 갱신한다.

최종 보고에는 변경 파일, 데이터 흐름, scope·토큰 보관 방식, 중복 방지 방식, 검사 결과, 수동 연결 절차, 실제 API 검증 여부, 남은 한계를 포함한다. Google API 활성화·동의 화면 테스트 사용자·등록 redirect URI 등 Console 설정이 필요한 경우에만 구체적인 설정 항목을 안내하고, 이미 있는 환경변수의 비밀값을 다시 요청하지 않는다.

완료 기준: **기존 Local CalendarEvent를 사용자가 선택해 Google 기본 캘린더에 한 번 생성하고, 연결/전송 상태를 확인하며, 재시도·동시 요청에도 같은 이벤트를 중복 생성하지 않는다. ScheduleCandidate는 Google 연동 계층에서 직접 참조하지 않는다.**
