/**
 * A coach's face.
 *
 * The image itself is generated once at creation on 0G Compute and served as
 * bytes from /api/coach/<tokenId>/avatar. Whether one exists is decided by the
 * caller (a boolean read from the index — never by fetching a 120KB image to
 * find out), so a coach without one draws a typographic monogram instead of a
 * broken-image icon.
 *
 * Deliberately not a <next/image>: these are same-origin, already-square,
 * already-small PNGs served with an immutable cache header, so the optimizer
 * would add a round trip and a resize for nothing.
 */
export function CoachAvatar({
  tokenId,
  name,
  hasAvatar,
  className = "",
  size = 96,
}: {
  tokenId: string;
  name: string;
  hasAvatar: boolean;
  className?: string;
  size?: number;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "0";

  if (!hasAvatar) {
    return (
      <div
        aria-hidden
        style={{ width: size, height: size }}
        className={`flex shrink-0 items-center justify-center border border-navy/15 bg-peach/30 font-serif italic text-navy ${className}`}
      >
        <span style={{ fontSize: size * 0.42 }}>{initial}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/coach/${tokenId}/avatar`}
      alt={`${name}, portrait generated when the coach was created`}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
      className={`shrink-0 border border-navy/15 object-cover ${className}`}
    />
  );
}
