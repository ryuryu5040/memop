import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createTileMap, L } from "./leafletBase.js";
import { getMapInitialView, MAX_ZOOM, MIN_ZOOM } from "../lib/tileMaps.js";
import { PendingPinMarker, PinMarker } from "./PinMarker.jsx";
import Icon from "./Icon.jsx";

/**
 * 「地図」のマップの表示（国土地理院の地図＋ピン）．
 *
 * 画像のマップの MapView.jsx と同じ props を受け取るので，MapDetail.jsx からは同じように使える．
 * 違うのは位置の表し方だけ．
 *   MapView     … 画像に対する割合 { x, y }
 *   TileMapView … 緯度経度 { lat, lng }
 * onMapClick と onPinMove には { lat, lng } を1つ渡す．
 *
 * 仕組み：
 *   地図の操作（拡大・移動・2本指のピンチ）とピンの置き場所は Leaflet に任せる．
 *   ピンの見た目は React で描く．Leaflet のマーカーの中に空の <div> を入れておき，
 *   そこへ createPortal で PinMarker を描き込む．
 *
 * MapDetail.jsx から lazy() で読み込むので，地図のマップを開いたときだけ Leaflet が読み込まれる．
 */
const PENDING_KEY = "__pending__";
// 選んだピンが，上に重なる「絞り込み」「ピン」ボタンや画面の端に隠れないよう空ける余白（px）
// ピンの絵は位置の真上に描かれるので，上を多めに空ける．
const REVEAL_PADDING_TOP_LEFT = [56, 112];
const REVEAL_PADDING_BOTTOM_RIGHT = [56, 32];
// 広い画面では，ピンのパネル（幅 20rem）が地図の右側に重なって出るので，その分も空ける
const WIDE_SCREEN_QUERY = "(min-width: 640px)";
const PIN_PANEL_SPACE = 20 * 16 + 16 + 40;

export default function TileMapView({
  map,
  pins = [],
  pendingPin = null,
  selectedPinId = null,
  onPinClick,
  onMapClick,
  onPinDoubleClick,
  movablePinId,
  onPinMove,
  onPendingPinMove,
  dense = false,
  // ピンにマウスを重ねたときの吹き出し（画像のマップと同じ．マップ詳細では評価（#47）も足して渡す）
  pinLabel = (pin) => pin.title,
}) {
  const containerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(() => getMapInitialView(map).zoom);

  // Leaflet のイベントは一度だけ登録するので，その中から最新の関数・値を読めるよう ref に入れておく
  const callbacksRef = useRef({});
  callbacksRef.current = { onPinClick, onMapClick, onPinDoubleClick, onPinMove, onPendingPinMove, movablePinId };

  // ピンごとの Leaflet のマーカーと，React で中身を描き込む <div>．鍵はピンの id（追加中の仮のピンは PENDING_KEY）
  const markersRef = useRef(new Map());
  const elementsRef = useRef(new Map());
  function markerElement(key) {
    let element = elementsRef.current.get(key);
    if (!element) {
      element = document.createElement("div");
      elementsRef.current.set(key, element);
    }
    return element;
  }

  // 1. 地図を作る（このマップを開いている間は作り直さない）
  useEffect(() => {
    const leafletMap = createTileMap(containerRef.current, getMapInitialView(map), {
      // 右下は広い画面でピンのパネルが重なる場所なので，提供元の表記は左下に出す
      attributionPosition: "bottomleft",
    });
    leafletMapRef.current = leafletMap;

    leafletMap.on("click", (event) => {
      const { onMapClick: handleMapClick } = callbacksRef.current;
      if (!handleMapClick) return;
      const { lat, lng } = event.latlng.wrap();
      handleMapClick({ lat, lng });
    });
    leafletMap.on("zoomend", () => setZoom(leafletMap.getZoom()));

    // スマホでピンのパネルが開くと地図の領域が縮むので，大きさが変わったら Leaflet に知らせる．
    // 知らせないと，地図画像が欠けたり，押した場所と違う位置にピンが立ったりする．
    const observer = new ResizeObserver(() => leafletMap.invalidateSize());
    observer.observe(containerRef.current);

    const markers = markersRef.current;
    setReady(true);
    return () => {
      observer.disconnect();
      markers.clear();
      leafletMap.remove();
      leafletMapRef.current = null;
    };
    // 開いているマップが変わったときは，MapDetail.jsx が key を変えて作り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ピンを追加できるときは十字のカーソルにする（tileMap.css）
  useEffect(() => {
    containerRef.current?.classList.toggle("memop-can-add-pin", Boolean(onMapClick));
  }, [onMapClick]);

  // 2. ピンのマーカーを，pins の内容に合わせて作る・動かす・消す
  useEffect(() => {
    const leafletMap = leafletMapRef.current;
    if (!leafletMap) return;
    const markers = markersRef.current;
    const currentIds = new Set();

    for (const pin of pins) {
      if (pin.lat == null || pin.lng == null) continue;
      currentIds.add(pin.id);
      let entry = markers.get(pin.id);

      if (!entry) {
        const marker = L.marker([pin.lat, pin.lng], {
          icon: L.divIcon({ html: markerElement(pin.id), className: "memop-tile-pin", iconSize: [0, 0], iconAnchor: [0, 0] }),
          // キーボードでも選べるようにする（Tab で移動して Enter）
          keyboard: true,
          title: pin.title,
        });
        entry = { marker, pin, dragging: false };
        const current = entry;
        marker.on("click", () => {
          // 位置を編集中のピンは，ドラッグの終わりに届くクリックを無視する
          if (callbacksRef.current.movablePinId === current.pin.id) return;
          callbacksRef.current.onPinClick?.(current.pin);
        });
        marker.on("dblclick", () => {
          if (callbacksRef.current.movablePinId === current.pin.id) return;
          callbacksRef.current.onPinDoubleClick?.(current.pin);
        });
        marker.on("dragstart", () => { current.dragging = true; });
        marker.on("drag", () => {
          const { lat, lng } = marker.getLatLng().wrap();
          callbacksRef.current.onPinMove?.({ lat, lng });
        });
        marker.on("dragend", () => {
          current.dragging = false;
          const { lat, lng } = marker.getLatLng().wrap();
          callbacksRef.current.onPinMove?.({ lat, lng });
        });
        marker.addTo(leafletMap);
        markers.set(pin.id, entry);
      }

      entry.pin = pin;
      // タイトルを編集したら，マウスを重ねたときの表示も合わせる
      entry.marker.getElement()?.setAttribute("title", pin.title);
      // ドラッグ中は，指やマウスの位置を優先する（戻すとピンが震える）
      if (!entry.dragging) {
        const position = entry.marker.getLatLng();
        if (position.lat !== pin.lat || position.lng !== pin.lng) entry.marker.setLatLng([pin.lat, pin.lng]);
      }
      const isSelected = selectedPinId != null && pin.id === selectedPinId;
      // 選んだピンは，ほかのピンと重なっても手前に出す
      entry.marker.setZIndexOffset(isSelected ? 1000 : 0);
      const movable = movablePinId === pin.id;
      if (entry.marker.dragging) {
        if (movable) entry.marker.dragging.enable();
        else entry.marker.dragging.disable();
      }
    }

    for (const [id, entry] of markers) {
      if (id === PENDING_KEY || currentIds.has(id)) continue;
      entry.marker.remove();
      markers.delete(id);
      elementsRef.current.delete(id);
    }

    // 追加しようとしている場所の仮のピン．
    // ドラッグで位置を調整できる（住所から置いたときの微調整など．#25）．押しても何も起きない．
    const pendingEntry = markers.get(PENDING_KEY);
    if (pendingPin?.lat != null && pendingPin?.lng != null) {
      if (pendingEntry) {
        // ドラッグ中は，指やマウスの位置を優先する（既存ピンと同じ理由）
        if (!pendingEntry.dragging) pendingEntry.marker.setLatLng([pendingPin.lat, pendingPin.lng]);
      } else {
        const marker = L.marker([pendingPin.lat, pendingPin.lng], {
          icon: L.divIcon({ html: markerElement(PENDING_KEY), className: "memop-tile-pin", iconSize: [0, 0], iconAnchor: [0, 0] }),
          // Leaflet はドラッグを「押せるマーカー」にしか付けないので interactive にする
          interactive: true,
          draggable: true,
          keyboard: false,
          zIndexOffset: 2000,
        }).addTo(leafletMap);
        const entry = { marker, dragging: false };
        function reportMove() {
          const { lat, lng } = marker.getLatLng().wrap();
          callbacksRef.current.onPendingPinMove?.({ lat, lng });
        }
        marker.on("dragstart", () => { entry.dragging = true; });
        marker.on("drag", reportMove);
        marker.on("dragend", () => { entry.dragging = false; reportMove(); });
        markers.set(PENDING_KEY, entry);
      }
    } else if (pendingEntry) {
      pendingEntry.marker.remove();
      markers.delete(PENDING_KEY);
    }
    // markerElement は ref だけを使う関数なので，依存に入れなくてよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pins, pendingPin, selectedPinId, movablePinId]);

  // 3. 追加中・選択中のピンが画面の外や上のボタンの裏に隠れないよう，見える位置まで地図を動かす．
  //    スマホではパネルが開くと地図の領域が縮むので，大きさが変わったときにも確かめ直す．
  const focusTarget = pendingPin ?? (selectedPinId != null ? pins.find((pin) => pin.id === selectedPinId) ?? null : null);
  const focusTargetRef = useRef(focusTarget);
  focusTargetRef.current = focusTarget;
  // ピンをドラッグで動かしている間は追いかけない（位置ではなく id・draftId を鍵にする）
  const focusKey = !focusTarget
    ? null
    : focusTarget.id ?? (focusTarget.draftId != null ? `draft:${focusTarget.draftId}` : `new:${focusTarget.lat}:${focusTarget.lng}`);

  useEffect(() => {
    const leafletMap = leafletMapRef.current;
    if (!leafletMap || focusKey === null) return;

    function revealFocusTarget() {
      const target = focusTargetRef.current;
      if (target?.lat == null || target?.lng == null) return;
      leafletMap.invalidateSize();
      // 画面の外にある（住所から置いたときなど）ときは，まず真ん中に持ってくる．
      // panInside だけだと最小限しか動かさないので，ピンが画面の端ぎりぎりに来てしまう．
      if (!leafletMap.getBounds().contains([target.lat, target.lng])) {
        leafletMap.setView([target.lat, target.lng], leafletMap.getZoom(), { animate: false });
      }
      const panelOverlapsMap = dense && window.matchMedia(WIDE_SCREEN_QUERY).matches;
      leafletMap.panInside([target.lat, target.lng], {
        paddingTopLeft: REVEAL_PADDING_TOP_LEFT,
        paddingBottomRight: panelOverlapsMap
          ? [PIN_PANEL_SPACE, REVEAL_PADDING_BOTTOM_RIGHT[1]]
          : REVEAL_PADDING_BOTTOM_RIGHT,
      });
    }

    revealFocusTarget();
    const observer = new ResizeObserver(revealFocusTarget);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [focusKey, ready, dense]);

  return (
    // isolate：Leaflet は地図の層に z-index 400〜1000 を使う．ここで重なり順を閉じておかないと，
    // MapDetail.jsx で地図に重ねている「絞り込み」「ピン」ボタン（z-30）の上に地図がかぶってしまう．
    <div className="relative isolate h-full w-full min-w-0">
      {/*
        地図の本体．中の操作（1本指で移動・2本指で拡大）は Leaflet が受け持ち，
        ページ全体のスクロールや拡大とはぶつからない（Leaflet が touch-action を止めている）．
      */}
      <div
        ref={containerRef}
        role="application"
        aria-label={`${map?.title || "地図"}の地図。矢印キーで移動、＋とーで拡大・縮小できます。`}
        className="memop-tile-map h-full w-full"
      />

      {/* 拡大・縮小ボタン．画像のマップと同じ見た目・同じ場所（左下．提供元の表記の上）に置く． */}
      <div className={`absolute bottom-8 left-3 z-[1000] rounded-lg border border-line-strong bg-surface shadow-sm ${dense ? "hidden sm:flex" : "flex"}`}>
        <button
          type="button"
          onClick={() => leafletMapRef.current?.zoomOut()}
          disabled={zoom <= MIN_ZOOM}
          className="btn-icon"
          aria-label="縮小"
          title="縮小"
        >
          <Icon name="minus" className="size-5" />
        </button>
        <span className="my-2 w-px bg-line" />
        <button
          type="button"
          onClick={() => leafletMapRef.current?.zoomIn()}
          disabled={zoom >= MAX_ZOOM}
          className="btn-icon"
          aria-label="拡大"
          title="拡大"
        >
          <Icon name="plus" className="size-5" />
        </button>
      </div>

      {/* ピンの見た目を，Leaflet のマーカーの中へ描き込む */}
      {ready && pins.map((pin) => {
        if (pin.lat == null || pin.lng == null) return null;
        const isSelected = selectedPinId != null && pin.id === selectedPinId;
        const movable = movablePinId === pin.id;
        return createPortal(
          <span
            title={pinLabel(pin)}
            className={`memop-tile-pin-body absolute left-0 top-0 block origin-bottom -translate-x-1/2 -translate-y-full transition-transform ${isSelected ? "scale-125" : "hover:scale-125"} ${movable
              ? "cursor-grab animate-pulse opacity-70 active:cursor-grabbing motion-reduce:animate-none"
              : "cursor-pointer"
              }`}
          >
            <PinMarker pin={pin} selected={isSelected} />
          </span>,
          markerElement(pin.id),
          pin.id,
        );
      })}
      {ready && pendingPin?.lat != null && createPortal(
        <span className={`absolute left-0 top-0 block -translate-x-1/2 -translate-y-full animate-pulse motion-reduce:animate-none ${onPendingPinMove ? "cursor-grab active:cursor-grabbing" : ""}`}>
          <PendingPinMarker pin={pendingPin} />
        </span>,
        markerElement(PENDING_KEY),
        PENDING_KEY,
      )}
    </div>
  );
}
