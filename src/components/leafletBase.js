/**
 * Leaflet（地図の部品）の土台．
 *
 * Leaflet と，その見た目（CSS）を読み込むのはこのファイルだけ．
 * このファイルを使う TileMapView.jsx・TileMapCenterPicker.jsx は，呼び出し側で lazy() を使って
 * 必要になったときに読み込む．こうすると，画像のマップや一覧を開いたときには Leaflet を読み込まない．
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./tileMap.css";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_ATTRIBUTION_HTML,
  TILE_URL_TEMPLATE,
} from "../lib/tileMaps.js";

/**
 * container の中に国土地理院の地図を作る．
 * 拡大・縮小のボタンは画像のマップと同じ見た目のものを各画面で用意するので，Leaflet のものは出さない．
 * 地図の提供元の表記（国土地理院）は，利用条件なので必ず出す．
 */
export function createTileMap(container, { lat, lng, zoom }, { attributionPosition = "bottomright" } = {}) {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // 拡大率は整数だけにする（保存する値と，地図画像が用意されている段階をそろえるため）
    zoomSnap: 1,
  });

  L.control
    .attribution({
      position: attributionPosition,
      prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
    })
    .addTo(map);

  L.tileLayer(TILE_URL_TEMPLATE, {
    attribution: TILE_ATTRIBUTION_HTML,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  }).addTo(map);

  map.setView([lat, lng], zoom);
  return map;
}

/** 地図の中心を，保存してよい形（経度を -180〜180 に収め，桁を丸めたもの）で返す */
export function getMapView(map) {
  const center = map.getCenter().wrap();
  const round = (value) => Math.round(value * 1e6) / 1e6;
  return { lat: round(center.lat), lng: round(center.lng), zoom: map.getZoom() };
}

export { L };
