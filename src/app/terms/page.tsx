import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "ARK:U — 이용약관",
  description: "ARK:U 서비스 이용 조건: 추출 결과의 한계, Google 전송 전 확인, 업로드 데이터에 대한 책임.",
};

// Static and public: linked from the Google OAuth consent screen. No database access.
export default function TermsPage() {
  return (
    <LegalPage eyebrow="TERMS OF SERVICE" title="이용약관" updated="2026-09-19">
      <LegalSection title="1. 서비스 내용">
        <p>
          ARK:U는 카카오톡 대화 내보내기 파일에서 일정 후보를 추출해 검토하고, 승인한 일정을 서비스 안의 캘린더에서 관리하며, 사용자가 선택한 일정을
          Google Calendar에 생성할 수 있게 돕는 개인용 도구입니다.
        </p>
      </LegalSection>

      <LegalSection title="2. 추출 결과의 한계">
        <ul>
          <li>
            일정 추출은 규칙과 자동 해석에 기반하므로 <strong>날짜·시간·장소·제목이 틀리거나 일정이 누락될 수 있습니다.</strong>
          </li>
          <li>추출 결과는 참고용이며, 중요한 일정은 반드시 원본 공지를 직접 확인해 주세요.</li>
          <li>추출 오류나 누락으로 인한 불이익에 대해 서비스는 책임을 지지 않습니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Google Calendar 전송">
        <ul>
          <li>
            <strong>자동 전송은 없습니다.</strong> 업로드·추출·승인·Google 연결만으로는 Google Calendar에 아무것도 생성되지 않습니다.
          </li>
          <li>
            일정은 사용자가 직접 전송을 요청하고 <strong>내용을 확인한 경우에만</strong> 생성됩니다. 전송 전에 제목·일시·장소가 맞는지 확인할 책임은
            사용자에게 있습니다.
          </li>
          <li>
            생성 이후 서비스에서 일정을 수정·삭제해도 Google Calendar에는 반영되지 않으며, Google에 생성된 일정은 Google Calendar에서 직접 관리해야
            합니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. 업로드하는 데이터">
        <ul>
          <li>
            <strong>사용 권한이 있는 데이터만 업로드해 주세요.</strong> 대화 파일에는 다른 참여자의 메시지가 포함되므로, 업로드와 이용에 따른 책임은
            사용자에게 있습니다.
          </li>
          <li>민감한 개인정보가 담긴 대화는 올리지 않는 것을 권장합니다.</li>
          <li>
            데이터 처리 방식은{" "}
            <Link href="/privacy" className="text-ark-700 underline">
              개인정보처리방침
            </Link>
            을 따릅니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. 개발 단계 및 변경">
        <p>
          ARK:U는 <strong>개발/해커톤 단계</strong>의 서비스로 &ldquo;있는 그대로&rdquo; 제공됩니다. 기능이 예고 없이 변경·중단될 수 있고 저장된
          데이터가 초기화될 수 있으며, 가용성과 정확성을 보증하지 않습니다. 이 약관도 기능 변경에 따라 수정될 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="6. 문의">
        <p>
          서비스 관련 문의: <strong>TODO — 연락처(이메일) 입력 예정</strong>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
