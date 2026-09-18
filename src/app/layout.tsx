import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Sans_KR } from "next/font/google";
import { AppFrame } from "@/components/AppFrame";
import { AppHeader } from "@/components/AppHeader";
import { ExtractionProvider } from "@/components/ExtractionProvider";
import { getReadDb } from "@/lib/db/client";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { getConnectionView } from "@/lib/google/connection";
import { isGoogleConfigured } from "@/lib/google/runtime";
import "./globals.css";

// Self-hosted at build time. Only Latin is preloaded; the Korean glyph ranges load on demand.
const plex = IBM_Plex_Sans_KR({ weight: ["300", "400", "500", "600", "700"], subsets: ["latin"], variable: "--font-plex", display: "swap" });
const chakra = Chakra_Petch({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-chakra", display: "swap" });

export const metadata: Metadata = {
  title: "ARK:U — 카카오톡 공지 일정 정리",
  description: "카카오톡 대화 내보내기에서 일정 후보를 찾아 검토하고, 내 캘린더와 Google 캘린더로 정리합니다.",
};

// The header shows live counts from the local database: never prerender (a build must not open the DB).
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read-only: two cheap queries for the header. Nothing here writes or calls Google.
  const db = await getReadDb();
  const pendingCount = candidatesRepo(db).countByStatus({}).PENDING;
  const google = getConnectionView(db, isGoogleConfigured()).state;

  return (
    <html lang="ko" className={`h-full antialiased ${plex.variable} ${chakra.variable}`}>
      <body className="min-h-full font-sans">
        <ExtractionProvider>
          <AppFrame header={<AppHeader pendingCount={pendingCount} google={google} />}>{children}</AppFrame>
        </ExtractionProvider>
      </body>
    </html>
  );
}
