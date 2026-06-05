"use client";

import { useEffect, useRef } from "react";

type Props = {
  src: string;
  className?: string;
};

export default function VideoLoop({ src, className = "" }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    // Forzar reproducción
    video.play().catch(() => {});

    // Reiniciar manualmente cuando termina (fallback del loop nativo)
    function onEnded() {
      if (!video) return;
      video.currentTime = 0;
      video.play().catch(() => {});
    }

    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      className={className}
    />
  );
}
