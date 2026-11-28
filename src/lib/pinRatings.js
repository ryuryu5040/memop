/**
 * ピンの星評価（#47）の計算と表示．
 *
 * 評価は 0.5〜5.0 の 0.5 刻み．1人が1つのピンに付けられるのは1つだけ．
 * 「誰が何点を付けたか」は本人以外に見せないので，画面に届くのはピンごとの合計と件数だけ
 * （pins.rating_sum・pins.rating_count．DB のトリガーが数え直す）．
 * 平均はここで 合計 ÷ 件数 を計算し，小数第2位で四捨五入して出す（4.75 → 4.8）．
 *
 * 保存できる値は supabase/migrations/20261129000000_pin_ratings.sql の check 制約と同じにする．
 */
export const RATING_MIN = 0.5;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

/** 保存できる点数か（0.5〜5.0 の 0.5 刻み） */
export function isValidRating(value) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= RATING_MIN
    && value <= RATING_MAX
    && Number.isInteger(value / RATING_STEP);
}

/** ピンの平均の評価．未評価や，列がない（SQL 未適用）ときは null */
export function getRatingAverage(pin) {
  const count = Number(pin?.rating_count ?? 0);
  if (!(count > 0)) return null;
  // 小数の誤差を避けるため，10 倍してから四捨五入する．
  return Math.round((Number(pin.rating_sum) * 10) / count) / 10;
}

/** 平均を「4.8」のような文字にする．未評価なら null（何も表示しない） */
export function formatRatingAverage(pin) {
  const average = getRatingAverage(pin);
  return average === null ? null : average.toFixed(1);
}

/** ピンの詳細に出す「⭐4.8（3件）」．未評価なら「未評価」 */
export function formatRatingSummary(pin) {
  const average = formatRatingAverage(pin);
  return average === null ? "未評価" : `⭐${average}（${Number(pin.rating_count)}件）`;
}

/** 星（1〜5 番目）のどこを押したかから点数を決める．左半分なら 0.5 少なくする */
export function ratingFromStar(starIndex, isLeftHalf) {
  return isLeftHalf ? starIndex - RATING_STEP : starIndex;
}

/** このマップで評価機能がオンか */
export function isRatingEnabled(map) {
  return map?.rating_enabled === true;
}

/** このピンを評価できるか．マップ移動のボタンは場所ではないので評価しない */
export function canRatePin(map, pin) {
  return isRatingEnabled(map) && pin?.kind !== "button";
}

/**
 * id の一覧を size 件ずつに分ける．
 * 自分の評価を「pin_id がこの中のどれか」で読むとき，ピンが多いマップでも URL が長くなりすぎないようにする．
 */
export function chunkIds(ids, size) {
  const chunks = [];
  for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size));
  return chunks;
}

/**
 * リアルタイムで届いたピンの更新を，手元のピンに重ねる．
 * 評価が変わるとピンの合計と件数だけが更新され，Supabase は変わっていない長い列（メモなど）を
 * 送ってこないことがあるので，届かなかった列は手元の値を残す．
 */
export function mergePinUpdate(current, incoming) {
  return current ? { ...current, ...incoming } : incoming;
}

/**
 * 自分の評価を保存する（rating が null なら取り消す）．client は supabase．
 * 手元の「自分の評価」が古くても失敗しないよう，まず変更を試し，まだ無ければ追加する．
 * ほぼ同時に別の画面で追加されていた（主キーの重複）ときは，変更でやり直す．
 * 戻り値は { ok, error }．権限がないなどで1行も保存できなかったときは ok: false．
 */
export async function saveMyRating(client, { pinId, userId, rating }) {
  const table = () => client.from("pin_ratings");
  const result = ({ data, error }) => ({ ok: !error && Boolean(data?.length), error: error ?? null });

  if (rating === null) {
    return result(await table().delete().eq("pin_id", pinId).eq("user_id", userId).select("pin_id"));
  }

  const update = () => table().update({ rating }).eq("pin_id", pinId).eq("user_id", userId).select("pin_id");
  const updated = await update();
  if (updated.error || updated.data?.length) return result(updated);

  const inserted = await table().insert({ pin_id: pinId, user_id: userId, rating }).select("pin_id");
  if (inserted.error?.code === "23505") return result(await update());
  return result(inserted);
}

export const PIN_RATING_UNAVAILABLE_MESSAGE =
  "評価は現在利用できません。運営担当者にお問い合わせください。";

/** Supabase にまだ評価の列・表がない（SQL 未適用の）ときのエラーか */
export function isPinRatingUnavailableError(error) {
  return Boolean(error)
    && ["PGRST204", "PGRST205", "42703", "42P01"].includes(error.code)
    && /\b(rating_enabled|rating_sum|rating_count|pin_ratings)\b/.test(String(error.message ?? ""));
}
