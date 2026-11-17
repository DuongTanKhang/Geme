"use client";

import { useEffect, useRef, useState } from "react";

type DeliveryDistrict = { key: string; name: string; orderCount: number; paidAmount: number; latitude: number; longitude: number };
type DeliveryPoint = { code: string; latitude: number; longitude: number; districtKey: string };
type GeoFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number | boolean>;
};
type GeoCollection = { type: "FeatureCollection"; features: GeoFeature[] };
type MapClickEvent = { features?: GeoFeature[]; point: unknown };
type GeoJsonSource = {
  setData(data: GeoCollection): void;
  getClusterExpansionZoom(clusterId: number, callback: (error: Error | null, zoom?: number) => void): void;
};
type VietMapInstance = {
  on(event: string, listener: (event: MapClickEvent) => void): VietMapInstance;
  on(event: string, layer: string, listener: (event: MapClickEvent) => void): VietMapInstance;
  addSource(id: string, source: Record<string, unknown>): void;
  addLayer(layer: Record<string, unknown>): void;
  getSource(id: string): GeoJsonSource | undefined;
  queryRenderedFeatures(point: unknown, options: { layers: string[] }): GeoFeature[];
  addControl(control: unknown, position?: string): void;
  easeTo(options: { center: [number, number]; zoom: number; duration?: number }): void;
  getCanvas(): HTMLCanvasElement;
  remove(): void;
};
type VietMapSdk = {
  Map: new (options: Record<string, unknown>) => VietMapInstance;
  NavigationControl: new () => unknown;
};
declare global { interface Window { vietmapgl?: VietMapSdk } }

const SDK_JS = "https://unpkg.com/@vietmap/vietmap-gl-js@6.0.1/dist/vietmap-gl.js";
const SDK_CSS = "https://unpkg.com/@vietmap/vietmap-gl-js@6.0.1/dist/vietmap-gl.css";
const SOURCE_ID = "geme-delivery-districts";
const DELIVERY_SOURCE_ID = "geme-exact-delivery-points";
const CLUSTER_LAYER = "geme-delivery-clusters";
const DISTRICT_LAYER = "geme-delivery-points";
const DELIVERY_CLUSTER_LAYER = "geme-exact-delivery-clusters";
const DELIVERY_PIN_LAYER = "geme-exact-delivery-pins";
const DELIVERY_CODE_LAYER = "geme-exact-delivery-codes";

let sdkPromise: Promise<VietMapSdk> | undefined;
function loadVietMapSdk(): Promise<VietMapSdk> {
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
    const finish = () => window.vietmapgl ? resolve(window.vietmapgl) : reject(new Error("VietMap SDK tải xong nhưng không khởi tạo được."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Không tải được VietMap SDK. Kiểm tra kết nối mạng và thử tải lại.")), { once: true });
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

function makeFeatures(districts: DeliveryDistrict[], selectedKey: string): GeoCollection {
  return {
    type: "FeatureCollection",
    features: districts.flatMap((district, index) => {
      const latitude = Number(district.latitude);
      const longitude = Number(district.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [longitude, latitude] as [number, number] },
        properties: {
          key: district.key,
          name: district.name,
          orderCount: Math.max(0, Number(district.orderCount) || 0),
          rank: index + 1,
          selected: district.key === selectedKey,
        },
      }];
    }),
  };
}

function makeDeliveryFeatures(points: DeliveryPoint[]): GeoCollection {
  return {
    type: "FeatureCollection",
    features: points.flatMap((point) => {
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [longitude, latitude] as [number, number] },
        properties: { code: point.code, districtKey: point.districtKey },
      }];
    }),
  };
}

export default function VietMapDeliveryMap({ districts, deliveryPoints, selectedKey, onSelect }: {
  districts: DeliveryDistrict[];
  deliveryPoints: DeliveryPoint[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<VietMapInstance | null>(null);
  const onSelectRef = useRef(onSelect);
  const districtsRef = useRef(districts);
  const deliveryPointsRef = useRef(deliveryPoints);
  const selectedKeyRef = useRef(selectedKey);
  const [state, setState] = useState<{ status: "loading" | "missing-key" | "ready" | "error"; message?: string }>({ status: "loading" });
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  onSelectRef.current = onSelect;
  districtsRef.current = districts;
  deliveryPointsRef.current = deliveryPoints;
  selectedKeyRef.current = selectedKey;

  useEffect(() => {
    let disposed = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let currentMap: VietMapInstance | null = null;
    let mapLoaded = false;
    const start = async () => {
      try {
        const response = await fetch("/api/maps/vietmap-config", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("Không đọc được cấu hình VietMap từ Admin.");
        const config = await response.json() as { configured?: boolean; tilemapKey?: string; apiConfigured?: boolean };
        if (!disposed) setApiKeyConfigured(Boolean(config.apiConfigured));
        if (!config.configured || !config.tilemapKey?.trim()) {
          if (!disposed) setState({ status: "missing-key" });
          return;
        }
        const sdk = await loadVietMapSdk();
        if (disposed || !containerRef.current) return;
        const key = config.tilemapKey.trim();
        const map = new sdk.Map({
          container: containerRef.current,
          style: `https://maps.vietmap.vn/maps/styles/lm/style.json?apikey=${encodeURIComponent(key)}`,
          center: [105.8, 17.5],
          zoom: 4.5,
          minZoom: 3.5,
          maxZoom: 16,
          attributionControl: true,
        });
        currentMap = map;
        mapRef.current = map;
        map.addControl(new sdk.NavigationControl(), "top-right");
        readyTimer = setTimeout(() => {
          if (!disposed) setState({ status: "error", message: "Bản đồ chưa tải xong. Hãy kiểm tra key VietMap, giới hạn domain/IP và kết nối mạng." });
        }, 18000);
        map.on("load", () => {
          if (disposed) return;
          mapLoaded = true;
          if (readyTimer) clearTimeout(readyTimer);
          readyTimer = undefined;
          map.addSource(SOURCE_ID, {
            type: "geojson",
            data: makeFeatures(districtsRef.current, selectedKeyRef.current),
            cluster: true,
            clusterRadius: 52,
            clusterMaxZoom: 10,
            clusterProperties: { orderCount: ["+", ["get", "orderCount"]] },
          });
          map.addLayer({
            id: CLUSTER_LAYER,
            type: "circle",
            source: SOURCE_ID,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": ["step", ["get", "orderCount"], "#b5cbbb", 1, "#76a988", 5, "#43825c", 20, "#155c39"],
              "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 19, 8, 25, 18, 32],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          });
          map.addLayer({
            id: "geme-delivery-cluster-count",
            type: "symbol",
            source: SOURCE_ID,
            filter: ["has", "point_count"],
            layout: { "text-field": ["concat", ["to-string", ["get", "orderCount"]], " đơn"], "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-size": 11 },
            paint: { "text-color": "#ffffff" },
          });
          map.addLayer({
            id: DISTRICT_LAYER,
            type: "circle",
            source: SOURCE_ID,
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": ["step", ["get", "rank"], "#155c39", 2, "#276c45", 5, "#5a976e", 11, "#9fc5aa", 21, "#dce9df"],
              "circle-radius": ["interpolate", ["linear"], ["get", "rank"], 1, 22, 5, 19, 10, 16, 20, 12, 40, 9],
              "circle-stroke-color": ["case", ["get", "selected"], "#073d26", "#ffffff"],
              "circle-stroke-width": ["case", ["get", "selected"], 4, 2],
              "circle-opacity": 0.92,
            },
          });
          map.addLayer({
            id: "geme-delivery-district-count",
            type: "symbol",
            source: SOURCE_ID,
            filter: ["!", ["has", "point_count"]],
            layout: { "text-field": ["to-string", ["get", "orderCount"]], "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-size": 11 },
            paint: { "text-color": ["case", ["<", ["get", "rank"], 11], "#ffffff", "#214d34"] },
          });
          map.addLayer({
            id: "geme-delivery-district-name",
            type: "symbol",
            source: SOURCE_ID,
            filter: ["!", ["has", "point_count"]],
            minzoom: 10.2,
            layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-size": 11, "text-offset": [0, 1.65], "text-anchor": "top", "text-allow-overlap": false },
            paint: { "text-color": "#30453a", "text-halo-color": "#ffffff", "text-halo-width": 1.3 },
          });

          map.addSource(DELIVERY_SOURCE_ID, {
            type: "geojson",
            data: makeDeliveryFeatures(deliveryPointsRef.current),
            cluster: true,
            clusterRadius: 42,
            clusterMaxZoom: 13,
          });
          map.addLayer({
            id: DELIVERY_CLUSTER_LAYER,
            type: "circle",
            source: DELIVERY_SOURCE_ID,
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#155c39",
              "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 15, 10, 22, 40, 30],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
              "circle-opacity": 0.94,
            },
          });
          map.addLayer({
            id: "geme-exact-delivery-cluster-count",
            type: "symbol",
            source: DELIVERY_SOURCE_ID,
            filter: ["has", "point_count"],
            layout: { "text-field": ["concat", ["to-string", ["get", "point_count"]], " đơn"], "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-size": 10 },
            paint: { "text-color": "#ffffff" },
          });
          map.addLayer({
            id: DELIVERY_PIN_LAYER,
            type: "circle",
            source: DELIVERY_SOURCE_ID,
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": "#087b68",
              "circle-radius": 6,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            },
          });
          map.addLayer({
            id: DELIVERY_CODE_LAYER,
            type: "symbol",
            source: DELIVERY_SOURCE_ID,
            filter: ["!", ["has", "point_count"]],
            minzoom: 13,
            layout: { "text-field": ["get", "code"], "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"], "text-size": 10, "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": false },
            paint: { "text-color": "#173b30", "text-halo-color": "#ffffff", "text-halo-width": 1.3 },
          });

          map.on("click", CLUSTER_LAYER, (event) => {
            const feature = event.features?.[0];
            const clusterId = Number(feature?.properties?.cluster_id);
            const coordinates = feature?.geometry?.coordinates;
            if (!Number.isFinite(clusterId) || !coordinates) return;
            map.getSource(SOURCE_ID)?.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (!error && typeof zoom === "number") map.easeTo({ center: coordinates, zoom, duration: 450 });
            });
          });
          map.on("click", DISTRICT_LAYER, (event) => {
            const key = String(event.features?.[0]?.properties?.key || "");
            if (key) onSelectRef.current(key);
          });
          map.on("click", DELIVERY_CLUSTER_LAYER, (event) => {
            const feature = event.features?.[0];
            const clusterId = Number(feature?.properties?.cluster_id);
            const coordinates = feature?.geometry?.coordinates;
            if (!Number.isFinite(clusterId) || !coordinates) return;
            map.getSource(DELIVERY_SOURCE_ID)?.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (!error && typeof zoom === "number") map.easeTo({ center: coordinates, zoom, duration: 450 });
            });
          });
          map.on("click", DELIVERY_PIN_LAYER, (event) => {
            const key = String(event.features?.[0]?.properties?.districtKey || "");
            if (key && key !== "unknown-district") onSelectRef.current(key);
          });
          for (const layer of [CLUSTER_LAYER, DISTRICT_LAYER, DELIVERY_CLUSTER_LAYER, DELIVERY_PIN_LAYER, DELIVERY_CODE_LAYER]) {
            map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
          }
          setState({ status: "ready" });
        });
        map.on("error", () => {
          // Let the initial timeout report a persistent style/key/network failure;
          // individual tile retries should not flip a successfully loaded map.
          if (disposed || mapLoaded) return;
        });
      } catch (error) {
        if (!disposed) setState({ status: "error", message: error instanceof Error ? error.message : "Không thể khởi tạo bản đồ VietMap." });
      }
    };
    void start();
    return () => {
      disposed = true;
      if (readyTimer) clearTimeout(readyTimer);
      currentMap?.remove();
      mapRef.current = null;
    };
    // Initialize the SDK once per mounted map. Data updates use setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.status === "ready") mapRef.current?.getSource(SOURCE_ID)?.setData(makeFeatures(districts, selectedKey));
  }, [districts, selectedKey, state.status]);

  useEffect(() => {
    if (state.status === "ready") mapRef.current?.getSource(DELIVERY_SOURCE_ID)?.setData(makeDeliveryFeatures(deliveryPoints));
  }, [deliveryPoints, state.status]);

  if (state.status === "missing-key") return <div className="shipping-vietmap-message" role="status">
    <strong>Chưa cấu hình đủ key VietMap</strong>
    <span>Nhập <code>VIETMAP_TILEMAP_KEY</code> để tải nền bản đồ và <code>VIETMAP_API_KEY</code> cho các API Search/Route vào <code>.env.docker</code>. Tilemap key được dùng trên trình duyệt; API key chỉ giữ ở máy chủ. Sau đó tạo lại riêng container Admin.</span>
  </div>;
  return <div className="shipping-vietmap-shell" aria-label="Bản đồ VietMap giao hàng toàn quốc">
    <div ref={containerRef} className="shipping-vietmap-canvas" />
    {state.status === "loading" && <div className="shipping-vietmap-overlay" role="status">Đang tải bản đồ VietMap…</div>}
    {state.status === "error" && <div className="shipping-vietmap-overlay is-error" role="alert">{state.message || "Không tải được bản đồ VietMap."}</div>}
    {state.status === "ready" && !apiKeyConfigured && <div className="shipping-vietmap-api-note" role="status">Bản đồ nền đã sẵn sàng. Chưa cấu hình VietMap API key cho Search/Route.</div>}
  </div>;
}
