/**
 * 「地図」のマップ（実際の地図をもとにしたマップ）に関する定数と計算．
 *
 * マップには2種類ある．
 *   image … アップロードした画像のマップ（これまでのマップ）．ピンの位置は画像に対する割合（x, y）．
 *   tile  … 国土地理院の地図をもとにしたマップ．ピンの位置は緯度経度（lat, lng）．
 *
 * このファイルは Leaflet（地図の部品）を読み込まない．
 * 一覧のサムネイルなど，地図の部品を使わない画面からも使えるようにするため．
 * Leaflet を使うのは components/TileMapView.jsx と components/TileMapCenterPicker.jsx だけ．
 */

export const MAP_TYPE_IMAGE = "image";
export const MAP_TYPE_TILE = "tile";

/** 「地図」のマップか．map_type が無い（DB の移行前の）マップは画像として扱う */
export function isTileMap(map) {
  return map?.map_type === MAP_TYPE_TILE;
}

/**
 * 国土地理院の地図（標準地図）．
 * API キーは不要で，利用量に応じて料金がかかることもない．
 * 使うときは出典（国土地理院）を地図の上に必ず表示する．
 * https://maps.gsi.go.jp/development/ichiran.html
 */
export const TILE_URL_TEMPLATE = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION_URL = "https://maps.gsi.go.jp/development/ichiran.html";
export const TILE_ATTRIBUTION_HTML =
  `<a href="${TILE_ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">国土地理院</a>`;
// 標準地図が用意されている拡大率の範囲．DB の制約（maps.zoom）も同じ範囲にしている．
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 18;

// マップを作るときに最初に出す場所（東京駅のあたり）
export const DEFAULT_CENTER = { lat: 35.681236, lng: 139.767125 };
export const DEFAULT_ZOOM = 15;

/** 緯度経度と拡大率が，保存してよい値か（DB の制約と同じ条件） */
export function isValidMapView({ lat, lng, zoom }) {
  return Number.isFinite(lat) && lat >= -85 && lat <= 85
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && Number.isInteger(zoom) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM;
}

/** 地図のマップの「最初に表示する場所」を取り出す．値が壊れていたら東京駅にする */
export function getMapInitialView(map) {
  const view = { lat: map?.center_lat, lng: map?.center_lng, zoom: map?.zoom };
  return isValidMapView(view) ? view : { ...DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

/**
 * ピンの位置を，マップの種類に合わせた保存用の値にする．
 * 画像マップは { x, y }（画像に対する割合），地図のマップは { lat, lng }．
 *
 * 地図のマップでは x / y を空（null）にして送る．列に初期値が設定されている DB でも，
 * DB の制約（どちらか一方の組だけ）に合うようにするため．地図のマップは SQL の適用後にしか無いので，送っても困らない．
 * 画像マップでは lat / lng を送らない．こうすると，SQL の適用前でもこれまでどおりピンを保存できる．
 */
export function pinPositionValues(map, position) {
  return isTileMap(map)
    ? { lat: position.lat, lng: position.lng, x: null, y: null }
    : { x: position.x, y: position.y };
}

export const TILE_MAP_UNAVAILABLE_MESSAGE =
  "地図のマップはまだ利用できません。画像のマップを選ぶか、運営担当者にお問い合わせください。";

/** Supabase に地図のマップ用の列がまだ無い（SQL 未適用の）ときのエラーか */
export function isTileMapColumnMissingError(error) {
  return Boolean(error)
    && (error.code === "PGRST204" || error.code === "42703")
    && /\b(map_type|center_lat|center_lng|zoom)\b/.test(String(error.message ?? ""));
}

/** 2つのピンの位置が同じか（画像マップ・地図のマップのどちらでも使える） */
export function isSamePinPosition(a, b) {
  return a?.x === b?.x && a?.y === b?.y && a?.lat === b?.lat && a?.lng === b?.lng;
}

/**
 * 一覧のサムネイル用に，中心の位置を含む地図画像（タイル）を並べる位置を計算する．
 *
 * 地図画像は 256px 四方のタイルに分かれていて，拡大率 z では世界全体が 2^z × 2^z 枚になる．
 * 中心の緯度経度を「世界全体を1枚の画像にしたときのピクセル位置」に直し，
 * 枠の中心に来るよう，まわりのタイルをずらして並べる．
 *
 * 戻り値の left / top は，枠の中心から見たタイル左上の位置（px）．
 */
export function thumbnailTiles({ lat, lng, zoom }, halfWidth = 200, halfHeight = 120) {
  const worldSize = 256 * 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const centerX = ((lng + 180) / 360) * worldSize;
  const centerY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * worldSize;
  const tileCount = 2 ** zoom;

  const tiles = [];
  for (let ty = Math.floor((centerY - halfHeight) / 256); ty <= Math.floor((centerY + halfHeight) / 256); ty += 1) {
    if (ty < 0 || ty >= tileCount) continue;
    for (let tx = Math.floor((centerX - halfWidth) / 256); tx <= Math.floor((centerX + halfWidth) / 256); tx += 1) {
      // 経度180度をまたぐときは，反対側のタイルを使う
      const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${tx}/${ty}`,
        url: TILE_URL_TEMPLATE.replace("{z}", zoom).replace("{x}", wrappedX).replace("{y}", ty),
        left: tx * 256 - centerX,
        top: ty * 256 - centerY,
      });
    }
  }
  return tiles;
}
