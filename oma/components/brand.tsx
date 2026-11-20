import Link from "next/link";
export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="OMA home">
      <svg
        viewBox="0 0 32 32"
        width="30"
        height="30"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 22V11l11-6 11 6v11l-11 6-11-6Z"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <path
          d="m5 11 11 6 11-6M16 17v11M10.5 8l11 6v11"
          stroke="currentColor"
          strokeWidth="2.2"
        />
      </svg>
      <span>OMA</span>
    </Link>
  );
}
