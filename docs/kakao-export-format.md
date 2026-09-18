# KakaoTalk export format — observations (Step 1)

Observed on the real export (kept only in gitignored `data/private/`, never committed). Numbers only, no chat content.

## Container

- The file is named `*.eml` but it is **not a MIME email**. It is Kakao plaintext: UTF-8 **with BOM**, mixed `CRLF` / `LF` line endings.
- So the decoder's content sniffing picks `kakao-plaintext` and postal-mime is never invoked for it.

## Header

```text
{room title} 카카오톡 대화          ← no "님과" in a group room; title ends with the member count
저장한 날짜 : 2026년 9월 18일 오후 7:25
(blank lines)
```

## Lines

| Kind | Shape | Count |
|---|---|---|
| message start | `YYYY년 M월 D일 오전/오후 h:mm, {sender} : {first line}` | 1207 |
| date separator | `YYYY년 M월 D일 오전/오후 h:mm` (whole line) | 335 |
| system line | `{timestamp}, X님이 Y님을 초대했습니다.` / `X님이 나갔습니다.` (no ` : `) | 35 |
| deleted placeholder | `메시지가 삭제되었습니다.` — **a bare line with no timestamp and no sender** | 96 |

- Senders may contain spaces and digits (`학과 25 이름`). The sender ends at the first ` : `.
- Deleted placeholders appear right after a message or a date separator, several in a row. They must end the current message instead of being appended to it, and they cannot be stored as messages (no sender/time) — they are only counted.
- Media placeholders seen: `사진`, `사진 N장` (≈41% of all messages). No OCR in Milestone 1.
- 631 of 1207 messages are multiline.
- Timestamps are strictly non-decreasing; no body line in this file imitates a message start.

## Parser consequences

- Matches the plan's assumed (Android-style) format; only the header regex and the bare deleted line needed adjusting.
- Parser result on the real file equals independent `grep` counts: 1207 messages / 335 separators / 35 system / 96 deleted, 0 fingerprint collisions.
