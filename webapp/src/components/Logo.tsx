export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#27272a" />
      <path
        d="M9 8h7.2c4.6 0 7.8 3.3 7.8 8s-3.2 8-7.8 8H9V8zm4 3.5v9h3c2.5 0 4.2-1.8 4.2-4.5s-1.7-4.5-4.2-4.5h-3z"
        fill="#fafafa"
      />
    </svg>
  );
}
