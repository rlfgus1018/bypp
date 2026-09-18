import Image from "next/image";
import Link from "next/link";

/**
 * The guide character on a blue gradient, with a short message. `variant="bubble"` puts the message in a
 * speech bubble (settings); the default is a heading-style note (upload page). Decorative: the message is text.
 */
export function AssistantCard({
  eyebrow = "ASSISTANT",
  message,
  href,
  linkLabel,
  variant = "note",
}: {
  eyebrow?: string;
  message: React.ReactNode;
  href?: string;
  linkLabel?: string;
  variant?: "note" | "bubble";
}) {
  return (
    <div className="relative min-h-[214px] overflow-hidden rounded-lg bg-gradient-to-br from-navy-700 to-ark-500 px-4 pt-3.5">
      {variant === "bubble" ? (
        <div className="relative z-10 w-[186px] rounded-xl bg-white px-3.5 py-2.5 text-[13.5px] font-medium leading-relaxed text-slate-900 shadow-[0_4px_12px_rgb(10_25_50/0.25)]">
          {message}
          <span className="absolute -bottom-[7px] right-4 h-3.5 w-3.5 rotate-45 bg-white" aria-hidden />
        </div>
      ) : (
        <div className="relative z-10 flex max-w-[60%] flex-col gap-1.5">
          <span className="font-display text-[10.5px] font-medium tracking-[0.18em] text-[#cdeaff]">{eyebrow}</span>
          <span className="text-[15px] font-semibold leading-normal text-white">{message}</span>
          {href && linkLabel && (
            <Link href={href} className="mt-1 self-start rounded-[3px] border border-white/60 px-2.5 py-1 text-xs text-white hover:bg-white/10">
              {linkLabel}
            </Link>
          )}
        </div>
      )}
      <Image
        src="/assets/upperbody1.png"
        alt=""
        width={1254}
        height={1254}
        sizes="200px"
        className="pointer-events-none absolute -bottom-3.5 -right-3 w-[180px] select-none"
      />
    </div>
  );
}
