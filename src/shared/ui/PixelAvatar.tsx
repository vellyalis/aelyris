import { memo } from "react";

/**
 * Procedural pixel robot avatar generator.
 * Generates a unique robot from a seed string.
 */

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const BG_COLORS = ["#182132", "#17283a", "#1f2435", "#162b2b", "#2a251c", "#281f31", "#142b35", "#20263a"];
const BODY_COLORS = ["#b7c4d1", "#92a6b8", "#7b8fa2", "#c9b37a", "#8fbd9d", "#c39098", "#a895c6", "#80b6c8"];

interface PixelAvatarProps {
  seed: string;
  size?: number;
}

export const PixelAvatar = memo(function PixelAvatar({ seed, size = 32 }: PixelAvatarProps) {
  const h = hashSeed(seed);
  const bgColor = BG_COLORS[h % BG_COLORS.length];
  const bodyColor = BODY_COLORS[(h >> 3) % BODY_COLORS.length];
  const hasAntenna = (h >> 6) % 3 !== 0;
  const eyeStyle = (h >> 8) % 3; // 0=mono, 1=double, 2=angry
  const mouthStyle = (h >> 10) % 3; // 0=grill, 1=line, 2=dot

  const s = size;
  const u = s / 16; // unit

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{
        borderRadius: s * 0.22,
        boxShadow: "inset 0 0 0 1px rgba(158, 226, 241, 0.08), 0 6px 16px rgba(0, 0, 0, 0.18)",
      }}
    >
      {/* Background */}
      <rect width={s} height={s} rx={s * 0.15} fill={bgColor} />
      <rect width={s} height={s} rx={s * 0.15} fill="rgba(255,255,255,0.04)" />

      {/* Antenna */}
      {hasAntenna && (
        <>
          <line x1={s / 2} y1={u * 2} x2={s / 2} y2={u * 4} stroke={bodyColor} strokeWidth={u} />
          <circle cx={s / 2} cy={u * 2} r={u} fill="rgba(230,244,248,0.78)" />
        </>
      )}

      {/* Head */}
      <rect x={u * 4} y={u * 4} width={u * 8} height={u * 6} rx={u} fill={bodyColor} />

      {/* Eyes */}
      {eyeStyle === 0 && <rect x={u * 5.5} y={u * 5.5} width={u * 5} height={u * 1.5} rx={u * 0.5} fill={bgColor} />}
      {eyeStyle === 1 && (
        <>
          <circle cx={u * 6.5} cy={u * 6.5} r={u} fill={bgColor} />
          <circle cx={u * 9.5} cy={u * 6.5} r={u} fill={bgColor} />
        </>
      )}
      {eyeStyle === 2 && (
        <>
          <rect
            x={u * 5}
            y={u * 6}
            width={u * 2.5}
            height={u * 1}
            fill={bgColor}
            transform={`rotate(-10 ${u * 6.25} ${u * 6.5})`}
          />
          <rect
            x={u * 8.5}
            y={u * 6}
            width={u * 2.5}
            height={u * 1}
            fill={bgColor}
            transform={`rotate(10 ${u * 9.75} ${u * 6.5})`}
          />
        </>
      )}

      {/* Mouth */}
      {mouthStyle === 0 && <rect x={u * 6} y={u * 8.5} width={u * 4} height={u * 0.8} rx={u * 0.3} fill={bgColor} />}
      {mouthStyle === 1 && (
        <line x1={u * 6} y1={u * 8.8} x2={u * 10} y2={u * 8.8} stroke={bgColor} strokeWidth={u * 0.5} />
      )}
      {mouthStyle === 2 && <circle cx={s / 2} cy={u * 8.8} r={u * 0.6} fill={bgColor} />}

      {/* Body */}
      <rect x={u * 3} y={u * 11} width={u * 10} height={u * 4} rx={u} fill={bodyColor} />
    </svg>
  );
});
