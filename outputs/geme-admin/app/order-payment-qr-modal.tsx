"use client";

import { useEffect, useRef, useState } from "react";
import { getVietQrImageUrl, getVietQrTransferInfo } from "./bank-qr";
import { canReopenOrderQr, qrRemainingMs, type OrderQrSnapshot } from "./order-payment-qr-state";

export function OrderQrButton({ order, onClick }: { order: Parameters<typeof canReopenOrderQr>[0]; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!canReopenOrderQr(order, now)) return null;
  return <button type="button" className="button order-view-qr" onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClick(); }}>Xem mã QR</button>;
}

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value)} ₫`;
const messages = {
  PAID: "Đã nhận đủ tiền thanh toán. Mã QR đã được đóng.",
  CANCELLED: "Đơn hàng đã hủy. Không tiếp tục chuyển khoản cho đơn này.",
  EXPIRED: "Đã hết hạn thanh toán. Mã QR đã được đóng; hệ thống sẽ xử lý hủy đơn chưa thanh toán.",
  UNAVAILABLE: "Đơn này chưa có thời hạn QR hợp lệ hoặc không còn đủ điều kiện thanh toán QR. Vui lòng kiểm tra hồ sơ đơn; mở lại mã không tạo thêm thời hạn.",
  PARTIAL: "Đơn đã ghi nhận một phần tiền. Vui lòng đối soát khoản đã nhận trước khi thu tiếp để tránh chuyển trùng.",
  REFUNDED: "Đơn đã ghi nhận hoàn tiền. Không tiếp tục thanh toán bằng mã này.",
};

export default function OrderPaymentQrModal({ orderId, onClose, onChange }: {
  orderId: string;
  onClose: () => void;
  onChange: (snapshot: OrderQrSnapshot) => void;
}) {
  const [snapshot, setSnapshot] = useState<OrderQrSnapshot | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const anchor = useRef<{ snapshot: OrderQrSnapshot; receivedAt: number } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | null = null;
    async function load() {
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 15_000);
      try {
        const response = await fetch(`/api/admin/admin/orders/${encodeURIComponent(orderId)}/payment-qr`, { cache: "no-store", signal: request.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "Không tải được trạng thái thanh toán.");
        if (data.id !== orderId || !data.qrState || !Number.isFinite(Date.parse(data.serverNow))) throw new Error("Phản hồi trạng thái QR không hợp lệ. Vui lòng thử lại.");
        if (disposed) return;
        anchor.current = { snapshot: data, receivedAt: performance.now() };
        setSnapshot(data);
        setRemaining(qrRemainingMs(data));
        setError("");
        onChangeRef.current(data);
        if (data.qrState === "READY") timer = setTimeout(load, 5_000);
      } catch (reason) {
        if (disposed) return;
        setError(reason instanceof Error ? reason.message : "Mất kết nối kiểm tra thanh toán. Vui lòng thử lại.");
        // Do not leave a stale QR visible when payment status cannot be verified.
        timer = setTimeout(load, 5_000);
      } finally { clearTimeout(timeout); }
    }
    void load();
    const tick = setInterval(() => {
      if (anchor.current) setRemaining(qrRemainingMs(anchor.current.snapshot, performance.now() - anchor.current.receivedAt));
    }, 1_000);
    return () => { disposed = true; request?.abort(); clearTimeout(timer); clearInterval(tick); };
  }, [orderId, retry]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  const ready = snapshot?.qrState === "READY" && remaining !== null && remaining > 0 && !error;
  const qrImage = ready && snapshot.bankQr ? getVietQrImageUrl(snapshot.bankQr, snapshot.totalAmount, snapshot.code) : null;
  const reference = snapshot ? getVietQrTransferInfo(snapshot.code, snapshot.bankQr?.bankCode) : "";
  const seconds = Math.ceil((remaining ?? 0) / 1_000);
  const countdown = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const message = snapshot?.qrState === "READY"
    ? remaining === null ? messages.UNAVAILABLE : remaining <= 0 ? messages.EXPIRED : ""
    : snapshot ? messages[snapshot.qrState] : "Đang kiểm tra mã và thời hạn thanh toán…";

  return <div className="order-receipt-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="orderQrTitle" className="order-receipt-dialog order-payment-qr-dialog" onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="order-receipt-heading">
        <div><span>{snapshot?.code || "GEME · THANH TOÁN"}</span><h2 id="orderQrTitle">{snapshot?.qrState === "PAID" ? "Thanh toán thành công" : "Thanh toán chuyển khoản"}</h2></div>
        <button type="button" className="order-receipt-close" aria-label="Đóng mã QR" onClick={onClose}>×</button>
      </header>
      <div className="order-payment-qr-body">
        {error && <p role="alert">Chưa kiểm tra được trạng thái thanh toán: {error}</p>}
        {!error && message && <p role="status">{message}</p>}
        {ready && <>
          <div className="pos-payment-qr-heading"><h2>{money(snapshot.totalAmount)}</h2><strong className="pos-payment-countdown" role="timer" aria-live="off">Còn {countdown}</strong></div>
          {qrImage && !imageFailed ? <div className="pos-payment-qr-grid">
            <img className="pos-payment-qr-image" src={qrImage} alt={`QR thanh toán đơn ${snapshot.code}`} onError={() => setImageFailed(true)} />
            <div className="pos-payment-qr-info"><dl>
              <div><dt>Ngân hàng</dt><dd>{snapshot.bankQr?.bankCode}</dd></div>
              <div><dt>Số tài khoản</dt><dd>{snapshot.bankQr?.accountNumber}</dd></div>
              <div><dt>Chủ tài khoản</dt><dd>{snapshot.bankQr?.accountName}</dd></div>
              <div><dt>Nội dung</dt><dd>{reference}</dd></div>
            </dl><button type="button" className="button" onClick={async () => {
              try { await navigator.clipboard.writeText(reference); setCopyMessage("Đã sao chép nội dung."); }
              catch { setCopyMessage("Không sao chép được. Hãy chọn và sao chép nội dung ở trên."); }
            }}>Sao chép nội dung</button><p role="status">{copyMessage}</p></div>
          </div> : <p role="alert">{imageFailed ? "Không tải được ảnh QR. Thử tải lại mã." : "Chưa lấy được tài khoản nhận tiền từ SePay. Kiểm tra cấu hình rồi thử lại."}</p>}
          <p className="pos-payment-qr-help">SePay tự xác nhận khi nhận đúng số tiền và nội dung. Mở lại mã giữ nguyên thời hạn 15 phút của đơn, không tạo đơn mới.</p>
        </>}
        <div className="pos-payment-qr-actions">
          {(error || (ready && (!qrImage || imageFailed))) && <button type="button" className="button" onClick={() => { setImageFailed(false); setRetry((value) => value + 1); }}>Thử lại</button>}
          <button type="button" className="button" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </section>
  </div>;
}
