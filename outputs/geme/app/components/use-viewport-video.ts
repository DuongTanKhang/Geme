"use client";

import { useEffect, type RefObject } from "react";

export function useViewportAutoplayVideo(videoRef: RefObject<HTMLVideoElement | null>, enabled = true) {
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video || typeof IntersectionObserver === "undefined") return;

    video.muted = true;
    video.loop = true;
    video.playsInline = true;

    let inView = false;
    let startedAutomatically = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPlayback = () => {
      if (inView && document.visibilityState === "visible") {
        if (reducedMotion.matches) {
          if (startedAutomatically) video.pause();
          return;
        }
        startedAutomatically = true;
        void video.play().catch(() => undefined);
      } else {
        video.pause();
        startedAutomatically = false;
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      const nextInView = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.08);
      if (nextInView === inView) return;
      inView = nextInView;
      syncPlayback();
    }, { threshold: [0, 0.08] });

    observer.observe(video);
    document.addEventListener("visibilitychange", syncPlayback);
    reducedMotion.addEventListener("change", syncPlayback);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
      reducedMotion.removeEventListener("change", syncPlayback);
      video.pause();
    };
  }, [enabled, videoRef]);
}
