import { useState } from "react";
import { placeOnImage } from "../lib/addressPins.js";
import AddressSearchField from "./AddressSearchField.jsx";
import Icon from "./Icon.jsx";

/**
 * 住所からピンを置くための検索カード（#25）．
 *
 * 住所を検索して得た緯度経度を，マップの目印から作った変換式（transform．lib/addressPins.js）で
 * 画像上の位置に直し，onPlace({ x, y }) で知らせる．位置は目安なので，置いたあとにドラッグで調整できる．
 * 見つからない・画像の範囲外になるときは理由を出し，「地図をクリックして置く」へ切り替えられる．
 */
export default function AddressPinPlacer({ transform, onPlace, onClickInstead, onClose }) {
  const [outsideTitle, setOutsideTitle] = useState("");

  function handleSelect(result) {
    const position = placeOnImage(transform, result);
    if (!position.inside) {
      setOutsideTitle(result.title);
      return;
    }
    setOutsideTitle("");
    onPlace({ x: position.x, y: position.y });
  }

  const clickInsteadButton = (
    <button type="button" onClick={onClickInstead} className="btn">
      <Icon name="pin" />
      地図をクリックして置く
    </button>
  );

  return (
    <div
      role="dialog"
      aria-label="住所からピンを置く"
      className="pointer-events-auto relative z-30 w-full space-y-2 rounded-xl border border-line bg-surface p-3 shadow-lg sm:w-80"
    >
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-bold text-ink">住所からピンを置く</p>
        <button type="button" onClick={onClose} aria-label="閉じる" title="閉じる" className="btn-icon -my-1 -mr-1.5">
          <Icon name="close" className="size-5" />
        </button>
      </div>
      <p className="text-xs leading-relaxed text-sub">
        お店のページなどからコピーした住所を貼り付けてください。マップの目印から計算した位置に仮のピンを置きます。位置は目安なので、ドラッグで調整してから保存してください。
      </p>
      <AddressSearchField
        label="ピンを置く住所"
        placeholder="住所（例：東京都江東区豊洲6丁目）"
        onSelect={handleSelect}
        onSearchStart={() => setOutsideTitle("")}
        notFound={clickInsteadButton}
        autoFocus
      />
      {outsideTitle && (
        <div className="space-y-2 text-sm text-sub" role="alert">
          <p>「{outsideTitle}」は、このマップ画像の範囲の外になります。住所が合っているか確かめるか、地図をクリックして置いてください。</p>
          {clickInsteadButton}
        </div>
      )}
    </div>
  );
}
