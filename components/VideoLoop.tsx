"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  mobileSrc?: string; // versión liviana para mobile (opcional, agregar cuando exista)
  poster?: string;    // imagen de portada mientras carga
  className?: string;
};

export default function VideoLoop({ src, mobileSrc, poster, className = "" }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detectar mobile
  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
  }, []);

  // Intersection Observer: solo carga el video cuando entra en viewport
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "200px" } // empieza a cargar 200px antes de entrar
    );

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Reproducción y loop garantizado
  useEffect(() => {
    const video = ref.current;
    if (!video || !visible) return;

    // faststart: cargar solo metadatos hasta que empiece a reproducirse
    video.load();
    video.play().catch(() => {});

    function onEnded() {
      if (!video) return;
      video.currentTime = 0;
      video.play().catch(() => {});
    }

    // Reintentar si se pausa por buffering
    function onStalled() {
      if (!video) return;
      setTimeout(() => video.play().catch(() => {}), 300);
    }

    function onWaiting() {
      if (!video) return;
      // No forzar reproducción durante buffering — dejar que el browser maneje
    }

    video.addEventListener("ended", onEnded);
    video.addEventListener("stalled", onStalled);

    return () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("stalled", onStalled);
    };
  }, [visible]);

  // Fuente según dispositivo
  const videoSrc = isMobile && mobileSrc ? mobileSrc : src;

  return (
    <div ref={wrapperRef} className={className} style={{ position: "relative" }}>
      {visible ? (
        <video
          ref={ref}
          // preload="metadata": descarga solo los primeros bytes para saber duración/dimensiones
          // No descarga el video entero hasta que el usuario llega a la sección
          preload="metadata"
          muted
          loop
          playsInline
          poster={poster}
          className="h-full w-full object-cover"
          style={{ display: "block" }}
        >
          <source src={videoSrc} type="video/mp4" />
          {/* Cuando tengas la versión WebM (mejor compresión), agregala acá:
          <source src={videoSrc.replace(".mp4", ".webm")} type="video/webm" />
          */}
        </video>
      ) : (
        // Mientras no entra en viewport: muestra el poster (carga instantánea, sin salto)
        <div className="h-full w-full bg-zinc-950" style={{ minHeight: "inherit" }}>
          {poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      )}
    </div>
  );
}
