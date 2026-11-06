"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Point = { latitude: number; longitude: number };
type Suggestion = { refId: string; label: string };
type VietMapInstance = {
  on(event: string, listener: (event: { lngLat?: { lat: number; lng: number } }) => void): VietMapInstance;
  addSource(id: string, source: Record<string, unknown>): void;
  addLayer(layer: Record<string, unknown>): void;
  getSource(id: string): { setData(data: Record<string, unknown>): void } | undefined;
  easeTo(options: { center: [number, number]; zoom: number; duration?: number }): void;
  remove(): void;
};
type VietMapSdk = { Map: new (options: Record<string, unknown>) => VietMapInstance };
declare global { interface Window { vietmapgl?: VietMapSdk } }

const SDK_JS = "https://unpkg.com/@vietmap/vietmap-gl-js@6.0.1/dist/vietmap-gl.js";
const SDK_CSS = "https://unpkg.com/@vietmap/vietmap-gl-js@6.0.1/dist/vietmap-gl.css";
const SOURCE_ID = "geme-checkout-address-pin";
let sdkPromise: Promise<VietMapSdk> | undefined;

function loadSdk() {
  if (window.vietmapgl) return Promise.resolve(window.vietmapgl);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<VietMapSdk>((resolve, reject) => {
    if (!document.getElementById("vietmap-gl-css")) {
      const style = document.createElement("link");
      style.id = "vietmap-gl-css";
      style.rel = "stylesheet";
      style.href = SDK_CSS;
      document.head.appendChild(style);
    }
    const existing = document.getElementById("vietmap-gl-js") as HTMLScriptElement | null;
    const script = existing || document.createElement("script");
    const onLoad = () => window.vietmapgl ? resolve(window.vietmapgl) : reject(new Error("Không khởi tạo được bản đồ VietMap."));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", () => reject(new Error("Không tải được bản đồ VietMap. Hãy kiểm tra kết nối rồi thử lại.")), { once: true });
    if (!existing) {
      script.id = "vietmap-gl-js";
      script.src = SDK_JS;
      script.async = true;
      const nonce = Array.from(document.querySelectorAll<HTMLScriptElement>("script[nonce]"))
        .map((item) => item.nonce || item.getAttribute("nonce") || "").find(Boolean);
      if (nonce) script.nonce = nonce;
      document.head.appendChild(script);
    }
  }).catch((error) => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

function pointFeature(point: Point) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [point.longitude, point.latitude] }, properties: {} }],
  };
}

function CheckoutAddressMap({ point, tilemapKey, onAddressChange, onPointChange }: {
  point: Point;
  tilemapKey: string;
  onAddressChange: (address: string) => void;
  onPointChange: (point: Point) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<VietMapInstance | null>(null);
  const addressChangeRef = useRef(onAddressChange);
  const pointChangeRef = useRef(onPointChange);
  const pointRef = useRef(point);
  const [mapStatus, setMapStatus] = useState("loading");
  const [mapError, setMapError] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  const reverseBusyRef = useRef(false);
  addressChangeRef.current = onAddressChange;
  pointChangeRef.current = onPointChange;
  pointRef.current = point;

  useEffect(() => {
    let disposed = false;
    let currentMap: VietMapInstance | null = null;
    void loadSdk().then((sdk) => {
      if (disposed || !containerRef.current) return;
      const map = new sdk.Map({
        container: containerRef.current,
        style: `https://maps.vietmap.vn/maps/styles/lm/style.json?apikey=${encodeURIComponent(tilemapKey)}`,
        center: [point.longitude, point.latitude],
        zoom: 16,
        minZoom: 5,
        maxZoom: 19,
        attributionControl: true,
      });
      currentMap = map;
      mapRef.current = map;
      map.on("load", () => {
        if (disposed) return;
        map.addSource(SOURCE_ID, { type: "geojson", data: pointFeature(pointRef.current) });
        map.addLayer({
          id: "geme-checkout-address-pin-circle",
          type: "circle",
          source: SOURCE_ID,
          paint: { "circle-radius": 10, "circle-color": "#087b68", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
        });
        setMapStatus("ready");
      });
      map.on("click", async (event) => {
        const latitude = Number(event.lngLat?.lat);
        const longitude = Number(event.lngLat?.lng);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || reverseBusyRef.current) return;
        reverseBusyRef.current = true;
        setReverseBusy(true);
        setMapError("");
        try {
          const response = await fetch(`/api/maps/vietmap?action=reverse&lat=${latitude}&lng=${longitude}`, { cache: "no-store", signal: AbortSignal.timeout(9000) });
          const result = await response.json() as { address?: string; latitude?: number; longitude?: number; message?: string };
          if (!response.ok || !result.address) throw new Error(result.message || "Không xác định được địa chỉ tại vị trí đã chọn.");
          const selected = { latitude: Number(result.latitude), longitude: Number(result.longitude) };
          pointChangeRef.current(selected);
          addressChangeRef.current(result.address);
        } catch (error) {
          setMapError(error instanceof Error ? error.message : "Không thể xác nhận vị trí này.");
        } finally {
          reverseBusyRef.current = false;
          setReverseBusy(false);
        }
      });
    }).catch((error) => {
      if (!disposed) { setMapStatus("error"); setMapError(error instanceof Error ? error.message : "Không thể tải bản đồ VietMap."); }
    });
    return () => { disposed = true; currentMap?.remove(); mapRef.current = null; };
  }, [tilemapKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getSource(SOURCE_ID)?.setData(pointFeature(point));
    map.easeTo({ center: [point.longitude, point.latitude], zoom: 16, duration: 400 });
  }, [point.latitude, point.longitude]);

  return <div className="checkout-address-map-card">
    <div className="checkout-address-map-heading"><strong>Vị trí giao hàng</strong><span>Chạm vào bản đồ để chỉnh lại ghim</span></div>
    <div className="checkout-address-map" ref={containerRef} aria-label="Bản đồ chọn vị trí giao hàng" />
    {(mapStatus === "loading" || reverseBusy) && <p className="checkout-address-map-status" role="status">{reverseBusy ? "Đang nhận diện địa chỉ tại vị trí mới…" : "Đang tải bản đồ VietMap…"}</p>}
    {mapError && <p className="checkout-address-map-error" role="alert">{mapError}</p>}
    {mapStatus === "ready" && !reverseBusy && !mapError && <p className="checkout-address-map-help">Nếu ghim chưa đúng cửa/điểm nhận, chạm đúng vị trí trên bản đồ. Địa chỉ sẽ được cập nhật theo vị trí mới.</p>}
  </div>;
}

export default function CheckoutAddressPicker({ value, point, onAddressChange, onPointChange }: {
  value: string;
  point: Point | null;
  onAddressChange: (address: string) => void;
  onPointChange: (point: Point | null) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [tilemapKey, setTilemapKey] = useState("");
  const [apiReady, setApiReady] = useState<boolean | null>(null);
  const skipSearch = useRef(false);
  const onAddressChangeRef = useRef(onAddressChange);
  const onPointChangeRef = useRef(onPointChange);
  onAddressChangeRef.current = onAddressChange;
  onPointChangeRef.current = onPointChange;

  useEffect(() => {
    let alive = true;
    void fetch("/api/maps/vietmap-config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config: { tilemapKey?: string | null; apiConfigured?: boolean }) => {
        if (!alive) return;
        setTilemapKey(String(config.tilemapKey || ""));
        setApiReady(config.apiConfigured === true);
      })
      .catch(() => { if (alive) setApiReady(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (skipSearch.current) { skipSearch.current = false; setSuggestions([]); return; }
    const query = value.trim();
    if (query.length < 3 || point || apiReady === false) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetch(`/api/maps/vietmap?action=autocomplete&text=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const result = await response.json() as { suggestions?: Suggestion[]; message?: string };
          if (!response.ok) throw new Error(result.message || "Không tìm được gợi ý địa chỉ.");
          setSuggestions(Array.isArray(result.suggestions) ? result.suggestions : []);
          setNotice("");
        })
        .catch((error) => {
          if (!controller.signal.aborted) { setSuggestions([]); setNotice(error instanceof Error ? error.message : "Không tìm được gợi ý địa chỉ."); }
        })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiReady, point, value]);

  const selectSuggestion = useCallback(async (suggestion: Suggestion) => {
    setSelecting(true);
    setNotice("");
    setSuggestions([]);
    try {
      const response = await fetch(`/api/maps/vietmap?action=place&refid=${encodeURIComponent(suggestion.refId)}`, { cache: "no-store", signal: AbortSignal.timeout(9000) });
      const result = await response.json() as { latitude?: number; longitude?: number; address?: string; message?: string };
      if (!response.ok || !result.address || !Number.isFinite(Number(result.latitude)) || !Number.isFinite(Number(result.longitude))) throw new Error(result.message || "Không lấy được tọa độ địa chỉ đã chọn.");
      skipSearch.current = true;
      onAddressChangeRef.current(result.address);
      onPointChangeRef.current({ latitude: Number(result.latitude), longitude: Number(result.longitude) });
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không lấy được vị trí. Hãy chọn lại địa chỉ.");
    } finally {
      setSelecting(false);
    }
  }, []);

  return <div className="checkout-address-picker">
    <label htmlFor="checkout-shipping-address">Địa chỉ giao hàng <span aria-hidden="true">*</span></label>
    <div className="checkout-address-search-wrap">
      <input
        id="checkout-shipping-address"
        required
        value={value}
        autoComplete="street-address"
        aria-autocomplete="list"
        aria-controls="checkout-address-suggestions"
        aria-expanded={suggestions.length > 0}
        placeholder="Nhập số nhà, tên đường, phường/xã, quận/huyện…"
        onChange={(event) => { onAddressChange(event.target.value); onPointChange(null); setNotice(""); }}
      />
      {(searching || selecting) && <span className="checkout-address-progress" role="status">{selecting ? "Đang xác định vị trí…" : "Đang tìm…"}</span>}
      {suggestions.length > 0 && <ul id="checkout-address-suggestions" className="checkout-address-suggestions" role="listbox" aria-label="Gợi ý địa chỉ VietMap">
        {suggestions.map((suggestion) => <li key={suggestion.refId}><button type="button" role="option" onClick={() => void selectSuggestion(suggestion)}>{suggestion.label}</button></li>)}
      </ul>}
    </div>
    <small className="checkout-address-instruction">Chọn một địa chỉ trong gợi ý của VietMap. Bản đồ sẽ hiện ra để bạn xác nhận hoặc chỉnh chính xác điểm giao.</small>
    {apiReady === false && <p className="checkout-address-map-error" role="alert">VietMap chưa được cấu hình đầy đủ trên máy chủ. Không thể xác nhận địa chỉ để đặt hàng.</p>}
    {notice && <p className="checkout-address-map-error" role="alert">{notice}</p>}
    {point && tilemapKey && <CheckoutAddressMap point={point} tilemapKey={tilemapKey} onAddressChange={(address) => { skipSearch.current = true; onAddressChange(address); }} onPointChange={onPointChange}/>}
    {point && !tilemapKey && <p className="checkout-address-map-error" role="alert">Chưa có VietMap Tilemap key để hiển thị bản đồ xác nhận vị trí.</p>}
  </div>;
}
