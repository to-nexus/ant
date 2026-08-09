/**
 * The Ant character — the single agent mark across the product.
 *
 * Agents used to be signposted by per-agent emoji in the chat chips and by
 * per-agent watermark art on the empty chat. Both predate the universal
 * runtime, where an agent is user-authored and has no built-in identity to
 * theme, so every agent surface now shows this one mark instead.
 */

const SRC = `${import.meta.env.BASE_URL}logo.png`;

export function AgentLogo({
  size = 14,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={SRC}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, flexShrink: 0, objectFit: 'contain', ...style }}
    />
  );
}
