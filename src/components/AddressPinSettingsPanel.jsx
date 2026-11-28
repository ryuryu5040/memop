import {
  LANDMARK_LABEL_MAX_LENGTH,
  MAX_LANDMARKS,
  MIN_LANDMARKS,
  fitLandmarkTransform,
} from "../lib/addressPins.js";
import AddressSearchField from "./AddressSearchField.jsx";
import Icon from "./Icon.jsx";

/**
 * 「住所からピンを置く」の設定パネル（#25）．マップの作成者と管理者だけが開ける．
 *
 * 目印（画像上の点と実際の位置の組）を登録し，機能の有効・無効を切り替える．
 * 目印の登録は2段階：
 *   1. 地図（画像）の上で，目印にする点をクリックする（MapDetail.jsx が settings.point に入れる）
 *   2. その点の実際の位置を，住所か緯度経度で入力する
 *
 * 下書きの状態（settings）は MapDetail.jsx が持つ．地図の上にも目印を描くため．
 *   settings = { landmarks: [{ x, y, lat, lng, label }], enabled: boolean, point: { x, y } | null }
 *   onChange(更新する関数) で書き換えを頼む．
 */
export default function AddressPinSettingsPanel({ settings, onChange, onSave, onClose, saving = false, error = "" }) {
  const { landmarks, enabled, point } = settings;
  const transform = fitLandmarkTransform(landmarks);
  const canAddMore = landmarks.length < MAX_LANDMARKS;

  function addLandmark(result) {
    onChange((current) => ({
      ...current,
      point: null,
      landmarks: [
        ...current.landmarks,
        {
          x: current.point.x,
          y: current.point.y,
          lat: result.lat,
          lng: result.lng,
          label: result.title.slice(0, LANDMARK_LABEL_MAX_LENGTH),
        },
      ],
    }));
  }

  function removeLandmark(index) {
    onChange((current) => ({
      ...current,
      landmarks: current.landmarks.filter((_, i) => i !== index),
    }));
  }

  return (
    // 見た目と置き場所は，ピンのパネル（PinPanel.jsx）と同じ．スマホでは地図の下，広い画面では右下に浮かべる．
    <div className="pin-sheet relative z-30 flex shrink-0 flex-col border-t border-line bg-surface sm:absolute sm:bottom-4 sm:right-4 sm:w-80 sm:rounded-xl sm:border sm:shadow-lg">
      <div className="flex shrink-0 items-center gap-1 border-b border-line py-1 pl-4 pr-1.5">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">住所からピンを置く設定</p>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          aria-label="設定をやめる"
          title="キャンセル"
          className="btn-icon"
        >
          <Icon name="close" className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        <p className="text-xs leading-relaxed text-sub">
          画像上の点と、その場所の実際の住所を組にした「目印」を{MIN_LANDMARKS}か所以上登録すると、
          ピンを追加する人が住所から位置を決められます。
          駅や交差点など場所がはっきりした点を、マップの左上と右下のように離して選ぶと正確になります。
          目印が3か所以上あると、傾いた画像にも合わせます。
        </p>

        {landmarks.length > 0 && (
          <ol aria-label="目印" className="space-y-1">
            {landmarks.map((landmark, index) => (
              <li key={index} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{landmark.label || "（名前なし）"}</span>
                  <span className="block truncate text-xs text-faint">
                    {landmark.lat.toFixed(5)}, {landmark.lng.toFixed(5)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeLandmark(index)}
                  disabled={saving}
                  aria-label={`目印${index + 1}を削除`}
                  title="削除"
                  className="btn-icon"
                >
                  <Icon name="trash" className="size-4" />
                </button>
              </li>
            ))}
          </ol>
        )}

        {point ? (
          <div className="space-y-2 rounded-lg border border-accent bg-accent-soft/40 p-3">
            <p className="text-sm font-bold text-ink">
              目印{landmarks.length + 1}の実際の位置を入力
            </p>
            <p className="text-xs text-sub">
              住所（例：東京都江東区豊洲6丁目）か、緯度経度（例：35.6547, 139.7959）を入れてください。
              地図をもう一度クリックすると、点を置き直せます。
            </p>
            <AddressSearchField
              // 点を置き直したら，入力欄も空に戻す
              key={`${point.x}-${point.y}`}
              label={`目印${landmarks.length + 1}の住所か緯度経度`}
              placeholder="住所か緯度経度"
              onSelect={addLandmark}
              autoFocus
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => onChange((current) => ({ ...current, point: null }))}
              className="text-xs text-accent-strong hover:underline"
            >
              この目印の追加をやめる
            </button>
          </div>
        ) : canAddMore ? (
          <p className="rounded-lg border border-dashed border-line-strong p-3 text-sm text-sub">
            <Icon name="plus" className="mr-1 inline size-4" />
            目印を追加するには、地図の上で目印にしたい点をクリックしてください。
          </p>
        ) : (
          <p className="text-xs text-sub">目印は{MAX_LANDMARKS}か所まで登録できます。</p>
        )}

        <div className="space-y-1 border-t border-line pt-3">
          <label className={`flex min-h-10 items-center gap-2 text-sm sm:min-h-8 ${transform.ok ? "cursor-pointer text-ink" : "text-faint"}`}>
            <input
              type="checkbox"
              checked={enabled && transform.ok}
              disabled={!transform.ok || saving}
              onChange={(event) => onChange((current) => ({ ...current, enabled: event.target.checked }))}
              className="size-4 shrink-0 accent-accent"
            />
            このマップで「住所から置く」を使えるようにする
          </label>
          {!transform.ok && (
            <p className="text-xs text-sub">
              まだ有効にできません：{transform.reason}
            </p>
          )}
        </div>

        {error && <p className="notice-error">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn">
            キャンセル
          </button>
          <button type="button" onClick={onSave} disabled={saving} className="btn btn-primary">
            {saving ? "保存中..." : "設定を保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
