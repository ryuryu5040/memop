import { RATING_MAX, ratingFromStar } from "../lib/pinRatings.js";

/**
 * 星の評価（#47）を入力・表示する部品．
 *
 * 入力は星5つ．1つの星を左右の半分に分け，左半分を押すと 0.5 点，右半分を押すと 1 点になる
 * （5つ目の左半分なら 4.5）．スマホでも押しやすいよう，入力の星は1つ 40px にしている．
 *
 * 半分の星は，塗った星を左半分だけ見せて表す（CSS のクラスだけで描き，埋め込みのスタイルは使わない）．
 */
const STAR_PATH = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";
const STARS = Array.from({ length: RATING_MAX }, (_, index) => index + 1);

/** index 番目（1〜5）の星を，value 点のときにどこまで塗るか */
function starFill(value, index) {
  if (value >= index) return "full";
  if (value >= index - 0.5) return "half";
  return "empty";
}

function Star({ fill, sizeClass }) {
  return (
    <span className={`relative block ${sizeClass}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-full fill-current text-line-strong">
        <path d={STAR_PATH} />
      </svg>
      {fill !== "empty" && (
        <span className={`absolute inset-y-0 left-0 overflow-hidden ${fill === "half" ? "w-1/2" : "w-full"}`}>
          <svg viewBox="0 0 24 24" className={`${sizeClass} max-w-none fill-current text-amber-400`}>
            <path d={STAR_PATH} />
          </svg>
        </span>
      )}
    </span>
  );
}

/**
 * 星の入力．
 *   value     今の点数（未評価なら null）
 *   onChange  点数（0.5〜5.0）を受け取る
 *   disabled  保存中など，押せないとき
 *   label     読み上げ用の名前（例：「あなたの評価」）
 */
export function StarRatingInput({ value, onChange, disabled = false, label }) {
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label={label} className="flex">
        {STARS.map((index) => (
          <span key={index} className="relative">
            <Star fill={starFill(value ?? 0, index)} sizeClass="size-10" />
            {[true, false].map((isLeftHalf) => {
              const rating = ratingFromStar(index, isLeftHalf);
              return (
                <button
                  key={rating}
                  type="button"
                  role="radio"
                  aria-checked={value === rating}
                  aria-label={`${rating.toFixed(1)}点`}
                  disabled={disabled}
                  onClick={() => onChange(rating)}
                  className={`absolute inset-y-0 w-1/2 rounded-sm focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed ${isLeftHalf ? "left-0" : "right-0"}`}
                />
              );
            })}
          </span>
        ))}
      </div>
      <span className="min-w-12 text-sm font-bold text-ink" aria-live="polite">
        {value ? value.toFixed(1) : "未評価"}
      </span>
    </div>
  );
}
