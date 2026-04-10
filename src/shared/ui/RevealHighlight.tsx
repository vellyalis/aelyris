import { useEffect, useRef } from "react";

/**
 * Fluent Design Reveal Highlight effect.
 * Wraps children with a mouse-following radial glow on hover.
 */
export function RevealHighlight({
  children,
  className,
  borderRadius = 6,
}: {
  children: React.ReactNode;
  className?: string;
  borderRadius?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      el.style.setProperty("--reveal-x", `${x}px`);
      el.style.setProperty("--reveal-y", `${y}px`);
    };

    el.addEventListener("mousemove", handleMouseMove);
    return () => el.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(150px circle at var(--reveal-x, -100px) var(--reveal-y, -100px), rgba(255,255,255,0.09), transparent 60%)",
          pointerEvents: "none",
          borderRadius,
          transition: "opacity 0.2s ease",
        }}
      />
      {children}
    </div>
  );
}
