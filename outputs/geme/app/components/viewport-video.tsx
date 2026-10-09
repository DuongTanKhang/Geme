"use client";

import { useEffect, useRef } from "react";

type Props = {
  src: string;
  poster?: string;
  className?: string;
  ariaLabel?: string;
};

export default function ViewportVideo({ src, poster, className = "", ariaLabel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.2) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }, { threshold: [0, 0.2, 0.5] });

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [src]);

  return <video
    ref={videoRef}
    className={className}
    src={src}
    poster={poster}
    muted
    loop
    playsInline
    preload="none"
    aria-label={ariaLabel}
    aria-hidden={ariaLabel ? undefined : true}
    tabIndex={-1}
  />;
}
