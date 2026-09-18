"use client";

import { usePathname } from "next/navigation";
import { ExtractionBanner } from "./ExtractionBanner";

/**
 * The app chrome (header + content column + extraction banner) around every page — except the landing page
 * (/), which is a full-bleed page with its own header and footer.
 */
export function AppFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return <>{children}</>;
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
