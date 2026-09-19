export function ShadowDeskMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M28.62 31.03 A14 14 0 0 1 9.28 29.00"
        stroke="#875CFF"
        strokeWidth="5.5"
        strokeLinecap="butt"
      />
      <path
        d="M9.28 29.00 A14 14 0 0 1 9.28 11.00"
        stroke="#F3FF97"
        strokeWidth="5.5"
        strokeLinecap="butt"
      />
      <path
        d="M9.28 11.00 A14 14 0 0 1 27.00 7.88"
        stroke="#D5A5E3"
        strokeWidth="5.5"
        strokeLinecap="butt"
      />
      <path
        d="M27.00 7.88 A14 14 0 0 1 33.69 17.09"
        stroke="#FFFFFC"
        strokeWidth="5.5"
        strokeLinecap="butt"
      />
    </svg>
  );
}