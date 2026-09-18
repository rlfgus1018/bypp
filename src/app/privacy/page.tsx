import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "ARK:U — 개인정보처리방침",
  description: "ARK:U가 카카오톡 대화 파일, 추출한 일정, Google 계정 정보를 어떻게 처리하는지 설명합니다.",
};

const link = "text-ark-700 underline";

// Static and public: linked from the Google OAuth consent screen. No database access.
export default function PrivacyPage() {
  return (
    <LegalPage eyebrow="PRIVACY POLICY" title="개인정보처리방침" updated="2026-09-19">
      <LegalSection title="1. 서비스 개요">
        <p>
          ARK:U는 사용자가 올린 카카오톡 대화 내보내기 파일에서 일정 후보를 찾아 검토하고, 승인한 일정을 서비스 안의 캘린더에서 관리하며, 사용자가 원할 때만 Google
          Calendar에 일정을 생성하는 개인용 도구입니다. 현재 <strong>개발/해커톤 단계</strong>의 서비스입니다.
        </p>
      </LegalSection>

      <LegalSection title="2. 처리하는 정보">
        <ul>
          <li>
            <strong>카카오톡 대화 파일</strong>: 사용자가 직접 올린 .txt / .eml 파일의 메시지(보낸 사람, 보낸 시각, 본문)와 파일명·채팅방 이름.
          </li>
          <li>
            <strong>추출한 일정 정보</strong>: 메시지에서 추출한 일정 후보(제목, 일시, 장소, 분류, 추출 근거)와 사용자가 승인·수정한 캘린더 일정.
          </li>
          <li>
            <strong>Google 계정 정보</strong>: Google 연결 시 받은 계정 식별자와 이메일 주소, 그리고 일정 생성을 위한 OAuth 토큰.
          </li>
        </ul>
        <p>이 정보는 일정 추출·검토·캘린더 관리와 사용자가 요청한 Google Calendar 일정 생성에만 사용하며, 서비스가 운영되는 서버의 데이터베이스에 저장됩니다.</p>
      </LegalSection>

      <LegalSection title="3. Google OAuth 및 Calendar 권한">
        <ul>
          <li>
            요청하는 권한은 <strong>내 소유 캘린더의 일정 생성·조회</strong>(calendar.events.owned)와 계정 식별용 <strong>openid, email</strong>뿐입니다.
          </li>
          <li>
            <strong>사용자가 직접 전송을 요청한 경우에만</strong> Google Calendar에 일정을 생성합니다. 업로드·추출·승인·Google 연결만으로는 아무것도 전송되지 않으며, 자동
            전송이나 양방향 동기화는 없습니다.
          </li>
          <li>Google로 보내는 내용은 일정의 제목, 시작·종료 시각, 장소와 중복 생성을 막기 위한 비공개 식별자입니다. 원본 메시지나 보낸 사람 정보는 보내지 않습니다.</li>
          <li>서비스는 Google Calendar의 기존 일정을 읽어 분석하거나 수정·삭제하지 않습니다(자신이 만든 일정의 생성 여부 확인만 수행).</li>
          <li>OAuth 토큰은 서버에만 저장되며 브라우저나 제3자에게 전달되지 않습니다.</li>
        </ul>
        <p>
          ARK:U의 Google API 사용은 제한적 사용(Limited Use) 요건을 포함한{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className={link}>
            Google API 서비스 사용자 데이터 정책
          </a>
          을 따릅니다.
        </p>
      </LegalSection>

      <LegalSection title="4. 제3자 제공">
        <ul>
          <li>
            사용자의 데이터를 <strong>판매하지 않으며</strong>, 광고 목적으로 사용하거나 제공하지 않습니다.
          </li>
          <li>
            운영자가 외부 LLM 추출 기능을 켠 경우에 한해, 일정 해석이 필요한 일부 메시지의 본문(전화번호·이메일·URL을 가린 상태, 보낸 사람 제외)이 일정 추출을 위해 외부 LLM
            API 제공자에게 전송될 수 있습니다. 이 기능의 사용 여부는 업로드 화면에 표시됩니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. 보관, 삭제 및 권한 철회">
        <ul>
          <li>설정 화면의 &ldquo;채팅방 데이터 삭제&rdquo;로 채팅방 단위의 메시지·일정 후보·캘린더 일정을 언제든 삭제할 수 있습니다.</li>
          <li>설정 화면의 &ldquo;연결 해제&rdquo;로 Google 권한을 취소하고 저장된 토큰을 삭제할 수 있습니다.</li>
          <li>
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className={link}>
              Google 계정의 권한 관리
            </a>
            에서도 언제든 이 서비스의 접근 권한을 철회할 수 있습니다.
          </li>
          <li>이미 Google Calendar에 생성된 일정은 서비스에서 삭제되지 않으므로, 필요하면 Google Calendar에서 직접 삭제해 주세요.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. 개발 단계 안내">
        <p>
          ARK:U는 개발/해커톤 단계의 서비스로 기능과 데이터 처리 방식이 바뀔 수 있고, 예고 없이 데이터가 초기화될 수 있습니다. 민감한 대화는 올리지 않는 것을 권장합니다.
          변경 사항은 이 페이지에 반영합니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 문의">
        <p>
          개인정보 관련 문의: <strong>TODO — 연락처(이메일) 입력 예정</strong>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
