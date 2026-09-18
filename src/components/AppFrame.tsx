"use client";

import { usePathname } from "next/navigation";
import { ExtractionBanner } from "./ExtractionBanner";

/**
 * The app chrome (header + content column + extraction banner) around every page — except the public pages
 * (the landing page and the legal documents), which are full-bleed with their own header and footer.
 */
const PUBLIC_PAGES = new Set(["/", "/privacy", "/terms"]);

export function AppFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_PAGES.has(pathname)) return <>{children}</>;
  return (
    <>
      {header}
      <main className="mx-auto max-w-[1280px] px-4 py-5 sm:px-7">
        <ExtractionBanner />
        {children}
      </main>
    </>
  );
}
