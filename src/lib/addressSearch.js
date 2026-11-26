/**
 * 地名・住所から緯度経度を探す（国土地理院の住所検索 API）．
 *
 * API キーは不要で，料金もかからない．入力した文字は国土地理院に送られる．
 * #25（住所からピンの位置を決める）でも同じものを使える．
 * https://msearch.gsi.go.jp/address-search/AddressSearch?q=東京駅
 *
 * 戻り値は [{ title, lat, lng }]（見つからなければ空の配列）．
 */
const ADDRESS_SEARCH_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const MAX_RESULTS = 8;

export async function searchAddress(query, { signal } = {}) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return [];

  const response = await fetch(`${ADDRESS_SEARCH_URL}?q=${encodeURIComponent(trimmed)}`, { signal });
  if (!response.ok) throw new Error(`住所検索に失敗しました（${response.status}）`);
  return parseAddressSearchResults(await response.json());
}

/** API の応答（GeoJSON の Feature の配列）を，画面で使う形に直す */
export function parseAddressSearchResults(features) {
  if (!Array.isArray(features)) return [];
  return features
    .map((feature) => {
      // GeoJSON の座標は [経度, 緯度] の順（緯度が先ではない）
      const [lng, lat] = feature?.geometry?.coordinates ?? [];
      return { title: String(feature?.properties?.title ?? ""), lat: Number(lat), lng: Number(lng) };
    })
    .filter((result) => result.title && Number.isFinite(result.lat) && Number.isFinite(result.lng))
    .slice(0, MAX_RESULTS);
}
