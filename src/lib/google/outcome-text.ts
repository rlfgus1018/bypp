import type { SyncOutcome } from "./sync-service";

// What the user is told about one event's send attempt. Shared by the single button and the bulk send.
// Plain Korean, no provider text, nothing secret.

export const OUTCOME_TEXT: Record<SyncOutcome["result"], string> = {
  synced: "Google 캘린더에 일정을 만들었습니다.",
  "already-synced": "이미 Google 캘린더에 만들어진 일정입니다. 다시 만들지 않았습니다.",
  "in-progress": "이미 전송 중입니다. 잠시 후 상태를 확인해 주세요.",
  "not-found": "일정을 찾을 수 없습니다. 이미 제거되었을 수 있습니다.",
  "not-syncable": "이 일정은 지금 상태로는 전송할 수 없습니다.",
  "not-connected": "먼저 Google 계정을 연결해 주세요.",
  "needs-reconnect": "Google 계정을 다시 연결해야 합니다.",
  "other-account": "이 일정의 이전 전송 시도는 다른 Google 계정으로 이루어졌습니다. 중복을 막기 위해 전송하지 않았습니다.",
  failed: "Google 캘린더에 만들지 못했습니다. 아래 사유를 확인하고 다시 시도해 주세요.",
  uncertain: "요청은 보냈지만 결과를 확인하지 못했습니다. 다시 시도하면 먼저 이미 만들어졌는지 확인합니다.",
};

export const RECOVERED_TEXT = "이전 시도에서 이미 Google 캘린더에 만들어진 것을 확인했습니다. 새로 만들지 않았습니다.";
