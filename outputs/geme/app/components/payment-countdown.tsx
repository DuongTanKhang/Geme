"use client";

import { useEffect, useRef, useState } from "react";

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PaymentCountdown({ expiresAt, onExpire }: { expiresAt: string | null | undefined; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);

  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline)) {
      setRemaining(null);
      return;
    }
    let notified = false;
    const update = () => {
      const next = Math.max(0, deadline - Date.now());
      setRemaining(next);
      if (next === 0 && !notified) {
        notified = true;
        onExpireRef.current?.();
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt || remaining === null) return null;
  return remaining > 0
    ? <p className="payment-countdown" role="timer" aria-label={`Còn ${formatRemaining(remaining)} để thanh toán QR`}>Thời gian thanh toán còn <strong>{formatRemaining(remaining)}</strong></p>
    : <p className="payment-countdown is-expired" role="status">Đã hết 15 phút thanh toán QR. Đơn đang được tự hủy và hoàn tồn kho.</p>;
}
