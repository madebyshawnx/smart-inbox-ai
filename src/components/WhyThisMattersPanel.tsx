type WhyThisMattersPanelProps = {
  text: string;
};

/**
 * Small labeled panel explaining why an email matters. Visually distinct via a
 * left accent border so it reads as the card's "reasoning" zone.
 */
export function WhyThisMattersPanel({ text }: WhyThisMattersPanelProps) {
  return (
    <div className="rounded-r-lg border-l-2 border-[var(--accent)] bg-[var(--accent-soft)] py-2 pr-3 pl-3">
      <p className="text-[0.7rem] font-semibold tracking-wide text-[var(--accent)] uppercase">
        Why this matters
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ink-700)]">{text}</p>
    </div>
  );
}
