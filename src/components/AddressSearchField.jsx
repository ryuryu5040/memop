import { useEffect, useRef, useState } from "react";
import { searchAddress } from "../lib/addressSearch.js";
import { parseLatLng } from "../lib/addressPins.js";
import Icon from "./Icon.jsx";

/**
 * 住所か緯度経度を入れて検索し，候補から1つ選ぶ欄（#25）．
 *
 * 住所は国土地理院の住所検索（lib/addressSearch.js）で緯度経度に変える．
 * 「35.6547, 139.7959」のような緯度経度を入れたときは，検索せずにそのまま使う
 * （Google マップで場所を右クリックするとこの形でコピーできる）．
 *
 * props:
 *   label        入力欄の名前（画面には出さず，読み上げに使う）
 *   placeholder  入力欄の薄い文字
 *   onSelect     候補を選んだときに { title, lat, lng } を渡す
 *   onSearchStart 検索を始めたときに呼ぶ（前の結果についての表示を消すため）
 *   notFound     見つからなかったときに出す内容（切り替えのボタンなど）
 *   autoFocus    開いたときに入力欄へカーソルを置くか
 *
 * ピンのパネルなど，ほかのフォームの中に置くこともあるので，<form> は使わず Enter を自分で受け取る．
 */
export default function AddressSearchField({ label, placeholder, onSelect, onSearchStart, notFound = null, autoFocus = false, disabled = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null は「まだ検索していない」
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const controllerRef = useRef(null);

  // 画面を閉じたら，途中の検索を取り消す
  useEffect(() => () => controllerRef.current?.abort(), []);

  async function runSearch() {
    const text = query.trim();
    if (!text || searching) return;
    // 前の検索結果について親が出している表示（範囲外の案内など）を消してもらう
    onSearchStart?.();

    const latLng = parseLatLng(text);
    if (latLng) {
      // 緯度経度が直接入力された．検索せずにそのまま使う
      setResults(null);
      onSelect({ title: `${latLng.lat}, ${latLng.lng}`, ...latLng });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    setSearchError("");
    try {
      const found = await searchAddress(text, { signal: controller.signal });
      setResults(found);
      // 候補が1つだけなら，選ぶ手間を省く
      if (found.length === 1) chooseResult(found[0]);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("住所検索に失敗", error);
      setResults(null);
      setSearchError("検索できませんでした。時間をおいて試してください。");
    } finally {
      if (controllerRef.current === controller) setSearching(false);
    }
  }

  function chooseResult(result) {
    setResults(null);
    setQuery(result.title);
    onSelect(result);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // まわりのフォームが送られないようにする．日本語の変換を確定する Enter では検索しない
            event.preventDefault();
            if (!event.nativeEvent.isComposing) runSearch();
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- 「住所から置く」を押した直後に入力できるようにするため
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={label}
          placeholder={placeholder}
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
      {results && results.length === 0 && (
        <div className="space-y-2 text-sm text-sub">
          <p>見つかりませんでした。番地を省く・丁目までにするなど、書き方を変えて試してください。</p>
          {notFound}
        </div>
      )}
      {results && results.length > 1 && (
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
      )}
    </div>
  );
}
