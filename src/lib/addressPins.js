/**
 * 「住所からピンを置く」機能（#25）の計算．
 *
 * 画像のマップは緯度経度を持たないので，マップの作成者が「目印」を登録する．
 * 目印は「画像上の点（x, y：画像に対する割合）」と「実際の位置（lat, lng）」の組．
 * 目印から「緯度経度 → 画像上の位置」の変換式を作り，住所を検索して得た緯度経度を画像上の位置に直す．
 *
 *   目印が2か所   … 北が上の地図とみなし，東西・南北それぞれの縮尺と位置を合わせる（axis）．
 *   目印が3か所以上 … 回転や傾きも合わせる（affine）．目印が一直線に並ぶときは axis にする．
 *
 * 画像の縮尺が場所によって違うマップ（イラストマップなど）では，ずれが大きくなる．
 * DB 側の制約（supabase/migrations/20261128000000_address_pins.sql）と値の範囲をそろえている．
 */

export const MIN_LANDMARKS = 2;
export const MAX_LANDMARKS = 10;
export const LANDMARK_LABEL_MAX_LENGTH = 40;

// 目印どうしが近すぎると，わずかな誤差で計算結果が大きくずれる．
// 緯度経度は 0.0001 度（約10m），画像上は幅・高さの 2% より離れていることを求める．
const MIN_DEGREE_SPREAD = 0.0001;
const MIN_IMAGE_SPREAD = 0.02;

/** 1つの目印が保存してよい値か（DB の制約と同じ条件） */
export function isValidLandmark(landmark) {
  if (!landmark || typeof landmark !== "object") return false;
  const { x, y, lat, lng, label = "" } = landmark;
  return Number.isFinite(x) && x >= 0 && x <= 1
    && Number.isFinite(y) && y >= 0 && y <= 1
    && Number.isFinite(lat) && lat >= -85 && lat <= 85
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && typeof label === "string" && label.length <= LANDMARK_LABEL_MAX_LENGTH;
}

/** マップに保存されている目印を取り出す．壊れた値は捨てる */
export function getMapLandmarks(map) {
  const landmarks = map?.address_landmarks;
  return Array.isArray(landmarks) ? landmarks.filter(isValidLandmark) : [];
}

/** 保存用に，目印から必要な値だけを取り出す（画面だけで使う値を DB に送らない） */
export function landmarksForSave(landmarks) {
  return landmarks.map(({ x, y, lat, lng, label = "" }) => ({ x, y, lat, lng, label: label.trim() }));
}

/**
 * 「35.6547, 139.7959」のような緯度経度の文字を読む．
 * Google マップで場所を右クリックしたときにコピーできる形．全角のカンマや空白区切りも受け付ける．
 * 緯度経度として読めなければ null．
 */
export function parseLatLng(text) {
  const match = String(text ?? "")
    .trim()
    .match(/^(-?\d{1,3}(?:\.\d+)?)\s*(?:[,，、]\s*|\s+)(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) return null;
  return { lat, lng };
}

/** 値の平均 */
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 平均からの散らばり（分散．n で割らない合計のまま使う） */
function sumOfSquares(values, center) {
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0);
}

/** 2つの値の組の，平均からの散らばりの掛け合わせの合計（共分散．n で割らない） */
function sumOfProducts(a, aCenter, b, bCenter) {
  return a.reduce((sum, value, index) => sum + (value - aCenter) * (b[index] - bCenter), 0);
}

/**
 * 目印から変換式を作る．
 * 戻り値は，作れたら { ok: true, method, toImage }，作れなければ { ok: false, reason }．
 * toImage({ lat, lng }) は画像上の位置 { x, y } を返す（画像の外になると 0〜1 を外れる）．
 */
export function fitLandmarkTransform(landmarks) {
  const points = Array.isArray(landmarks) ? landmarks.filter(isValidLandmark) : [];
  if (points.length < MIN_LANDMARKS) {
    return {
      ok: false,
      reason: `目印をあと${MIN_LANDMARKS - points.length}か所登録してください（2か所以上必要です）。`,
    };
  }

  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  // 計算の誤差を減らすため，すべて平均からの差で扱う
  const lng0 = mean(lngs);
  const lat0 = mean(lats);
  const x0 = mean(xs);
  const y0 = mean(ys);

  // いちばん離れた目印どうしの幅
  const range = (values) => Math.max(...values) - Math.min(...values);

  if (range(lngs) < MIN_DEGREE_SPREAD || range(lats) < MIN_DEGREE_SPREAD
    || range(xs) < MIN_IMAGE_SPREAD || range(ys) < MIN_IMAGE_SPREAD) {
    return {
      ok: false,
      reason: "目印どうしが近すぎるか、縦か横に一直線に並んでいます。マップの左上と右下のように、東西にも南北にも離れた場所を選んでください。",
    };
  }

  const sLngLng = sumOfSquares(lngs, lng0);
  const sLatLat = sumOfSquares(lats, lat0);
  const sLngLat = sumOfProducts(lngs, lng0, lats, lat0);

  // 目印の並び方が「一直線に近い」かどうか．
  // 0 に近いほど一直線．一直線だと回転・傾きを決められないので，axis の計算にする．
  const flatness = 1 - (sLngLat * sLngLat) / (sLngLng * sLatLat);

  if (points.length >= 3 && flatness > 0.05) {
    // affine：x = a·経度 + b·緯度 + 定数，y = c·経度 + d·緯度 + 定数 を，
    // すべての目印に最もよく合うように（誤差の二乗の合計が最小になるように）決める（最小二乗法）．
    // 平均からの差で考えると定数は消え，2行2列の連立方程式を解くだけになる．
    const det = sLngLng * sLatLat - sLngLat * sLngLat;
    const solve = (values, center) => {
      const sLngV = sumOfProducts(lngs, lng0, values, center);
      const sLatV = sumOfProducts(lats, lat0, values, center);
      return {
        perLng: (sLatLat * sLngV - sLngLat * sLatV) / det,
        perLat: (sLngLng * sLatV - sLngLat * sLngV) / det,
      };
    };
    const forX = solve(xs, x0);
    const forY = solve(ys, y0);
    return {
      ok: true,
      method: "affine",
      toImage: ({ lat, lng }) => ({
        x: x0 + forX.perLng * (lng - lng0) + forX.perLat * (lat - lat0),
        y: y0 + forY.perLng * (lng - lng0) + forY.perLat * (lat - lat0),
      }),
    };
  }

  // axis：北が上の地図とみなし，横（x）は経度だけ，縦（y）は緯度だけで決める．
  // 目印が2か所なら，2点を通る直線の傾き（縮尺）と位置がちょうど決まる．
  const xPerLng = sumOfProducts(lngs, lng0, xs, x0) / sLngLng;
  const yPerLat = sumOfProducts(lats, lat0, ys, y0) / sLatLat;
  return {
    ok: true,
    method: "axis",
    toImage: ({ lat, lng }) => ({
      x: x0 + xPerLng * (lng - lng0),
      y: y0 + yPerLat * (lat - lat0),
    }),
  };
}

/** Supabase にこの機能の列がある（SQL を適用済みの）マップか．無いときは設定のメニューを出さない */
export function hasAddressPinColumns(map) {
  return Boolean(map) && "address_landmarks" in map && "address_pin_enabled" in map;
}

export const ADDRESS_PIN_UNAVAILABLE_MESSAGE =
  "住所からピンを置く機能はまだ利用できません。運営担当者にお問い合わせください。";

/** Supabase にこの機能の列がまだ無い（SQL 未適用の）ときのエラーか */
export function isAddressPinColumnMissingError(error) {
  return Boolean(error)
    && (error.code === "PGRST204" || error.code === "42703")
    && /\baddress_(landmarks|pin_enabled)\b/.test(String(error.message ?? ""));
}

/** マップで「住所からピンを置く」が使えるか．使えるなら変換式も返す */
export function getAddressPinSetup(map) {
  if (!map?.address_pin_enabled) return { ok: false, reason: "このマップでは住所からピンを置く機能が無効です。" };
  return fitLandmarkTransform(getMapLandmarks(map));
}

/**
 * 緯度経度を，変換式で画像上の位置に直す．
 * 画像の外になるときは inside: false（位置は 0〜1 に収めない）．
 */
export function placeOnImage(transform, position) {
  const { x, y } = transform.toImage(position);
  const inside = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return { x, y, inside };
}
