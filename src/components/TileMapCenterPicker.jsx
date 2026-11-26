import { useEffect, useRef, useState } from "react";
import { createTileMap, getMapView } from "./leafletBase.js";
import { searchAddress } from "../lib/addressSearch.js";
import { isValidMapView, MAX_ZOOM, MIN_ZOOM, thumbnailTiles } from "../lib/tileMaps.js";
import Icon from "./Icon.jsx";

// 検索で場所を選んだときの拡大率（街の様子が分かるくらい）
const SEARCH_RESULT_ZOOM = 16;

/**
 * 「地図」のマップを作るときに，最初に表示する場所と拡大率を決める部品．
 *
 * 決め方は2つ．
 *   ・地名や住所で検索して，候補から選ぶ（国土地理院の住所検索．lib/addressSearch.js）
 *   ・地図を動かして，真ん中の 📍 を表示したい場所に合わせる
 * 中心と拡大率に加え，中心のタイルの読み込み状態を onChange で知らせる．
 *
 * MapUpload.jsx から lazy() で読み込む（Leaflet を必要なときだけ読み込むため）．
 */
export default function TileMapCenterPicker({ value, onChange, disabled = false }) {
  const containerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [zoom, setZoom] = useState(value.zoom);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null は「まだ検索していない」
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchControllerRef = useRef(null);

  useEffect(() => {
    const leafletMap = createTileMap(containerRef.current, value);
    leafletMapRef.current = leafletMap;
    let cancelTileCheck = () => {};

    function reportTileStatus(view, tileStatus) {
      onChangeRef.current?.({ ...view, tileStatus });
    }

    function checkCenterTile() {
      cancelTileCheck();
      const view = getMapView(leafletMap);
      setZoom(view.zoom);
      // 表示範囲の端には地図がないこともあるので，保存する中心の1枚を確認する．
      const tile = isValidMapView(view) ? thumbnailTiles(view, 0, 0)[0] : null;
      if (!tile) {
        reportTileStatus(view, "unavailable");
        return;
      }

      reportTileStatus(view, "checking");
      const image = new Image();
      image.onload = () => reportTileStatus(view, image.naturalWidth > 0 ? "ready" : "unavailable");
      image.onerror = () => reportTileStatus(view, "unavailable");
      // 前の位置の結果が遅れて返ってきても，次の位置を保存可能にしない．
      cancelTileCheck = () => {
        image.onload = null;
        image.onerror = null;
      };
      image.src = tile.url;
    }

    leafletMap.on("movestart", () => {
      cancelTileCheck();
      reportTileStatus(getMapView(leafletMap), "checking");
    });
    leafletMap.on("moveend", checkCenterTile);
    checkCenterTile();
    const observer = new ResizeObserver(() => leafletMap.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      cancelTileCheck();
      observer.disconnect();
      searchControllerRef.current?.abort();
      leafletMap.remove();
      leafletMapRef.current = null;
    };
    // 最初の表示位置は一度だけ使う．そのあとは地図が自分で位置を持つ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch() {
    if (!query.trim() || searching) return;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearching(true);
    setSearchError("");
    try {
      setResults(await searchAddress(query, { signal: controller.signal }));
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("住所検索に失敗", error);
      setResults(null);
      setSearchError("検索できませんでした。時間をおいて試すか、地図を動かして場所を決めてください。");
    } finally {
      if (searchControllerRef.current === controller) setSearching(false);
    }
  }

  function chooseResult(result) {
    leafletMapRef.current?.setView([result.lat, result.lng], SEARCH_RESULT_ZOOM);
    setResults(null);
    setQuery(result.title);
  }

  return (
    <div className="space-y-2">
      {/* 外側のフォーム（マップの作成）の中にあるので，<form> は使わず Enter を自分で受け取る */}
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Enter でマップ作成のフォームが送られないようにする（日本語の変換確定の Enter も含む）
            event.preventDefault();
            if (!event.nativeEvent.isComposing) runSearch();
          }}
          disabled={disabled}
          aria-label="地名・住所で探す"
          placeholder="地名・住所で探す（例：豊洲駅）"
          enterKeyHint="search"
          className="field min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={disabled || searching || !query.trim()}
          className="btn shrink-0"
        >
          <Icon name="search" />
          {searching ? "検索中…" : "検索"}
        </button>
      </div>

      {searchError && <p className="notice-error">{searchError}</p>}
      {results && (
        results.length === 0 ? (
          <p className="text-sm text-sub">見つかりませんでした。別の書き方で探すか、地図を動かして決めてください。</p>
        ) : (
          <ul aria-label="検索結果" className="max-h-48 overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-1">
            {results.map((result) => (
              <li key={`${result.title}-${result.lat}-${result.lng}`}>
                <button
                  type="button"
                  onClick={() => chooseResult(result)}
                  className="block min-h-10 w-full rounded-md px-2.5 py-2 text-left text-sm text-ink hover:bg-ink/5 sm:min-h-8"
                >
                  {result.title}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      <div className="relative isolate h-72 overflow-hidden rounded-lg border border-line-strong sm:h-96">
        <div
          ref={containerRef}
          role="application"
          aria-label="最初に表示する場所を決める地図。矢印キーで移動、＋とーで拡大・縮小できます。"
          className="memop-tile-map h-full w-full"
        />
        {/* 真ん中の目印．この位置がマップを開いたときの中心になる．地図の操作のじゃまをしないよう，押せないようにしている． */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-full text-3xl leading-none drop-shadow"
        >
          📍
        </span>
        <div className="absolute bottom-3 left-3 z-[1000] flex rounded-lg border border-line-strong bg-surface shadow-sm">
          <button
            type="button"
            onClick={() => leafletMapRef.current?.zoomOut()}
            disabled={disabled || zoom <= MIN_ZOOM}
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
            disabled={disabled || zoom >= MAX_ZOOM}
            className="btn-icon"
            aria-label="拡大"
            title="拡大"
          >
            <Icon name="plus" className="size-5" />
          </button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-faint">
        地図を動かして、真ん中の 📍 を最初に表示したい場所に合わせてください。拡大・縮小した大きさも、そのまま最初の表示になります。
      </p>
    </div>
  );
}
