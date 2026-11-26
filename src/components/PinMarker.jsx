import { getPinEmoji } from "../lib/pinTypes";
import { EmojiPin } from "./EmojiPin";

/**
 * 地図の上に描くピンの見た目．
 * 画像のマップ（MapView.jsx）と地図のマップ（TileMapView.jsx）で同じ見た目にするため，ここにまとめている．
 * 押したときの動きは，それぞれの地図の部品が受け持つ．
 */
export function PinMarker({ pin, selected = false }) {
  if (pin.kind === "button") {
    // ボタンは，押すと別のマップへ移動することが一目で分かるよう，
    // 普通のピン（絵文字がそのまま浮くだけ）とは見た目を変える．
    // 実際の建物の案内サインに寄せて，扉の絵文字＋行き先の名前を出す．
    return (
      <span className="flex flex-col items-center">
        <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-ink text-lg text-white shadow-md ${selected
          ? "ring-4 ring-accent ring-offset-2 ring-offset-white"
          : "ring-2 ring-white"
          }`}>
          🚪
        </span>
        <span className={`mt-0.5 max-w-24 truncate rounded bg-ink px-1.5 py-0.5 text-xs font-bold text-white shadow ${selected
          ? "ring-2 ring-accent"
          : ""
          }`}>
          {pin.title}
        </span>
      </span>
    );
  }

  return <EmojiPin emoji={getPinEmoji(pin.pin_type)} selected={selected} size="sm" />;
}

/** 新しいピンを追加しようとしている場所に出す，半透明の仮のピン */
export function PendingPinMarker({ pin }) {
  if (pin.kind === "button") {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-lg text-white shadow-md ring-2 ring-white">
        🚪
      </span>
    );
  }
  return <EmojiPin emoji={getPinEmoji(pin.pin_type)} preview size="sm" />;
}
