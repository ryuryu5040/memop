import MapVisibilitySelect from "../components/MapVisibilitySelect.jsx";
import { getMapVisibility, getMapVisibilityLabel, mapVisibilityValues } from "../lib/mapVisibility.js";
import { subscribeSavedMapsChanged } from "../lib/savedMaps.js";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isSamePinPosition, isTileMap, pinPositionValues } from "../lib/tileMaps.js";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { canManageContent } from "../lib/mapAccess";
import { getCurrentMapShare } from "../lib/mapShareAccess";
import { getMapShareUrl } from "../lib/mapShareLinks";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import { MapView } from "../components/MapView";
import { PinPanel } from "../components/PinPanel";
import { PIN_TYPES, getPinEmoji } from "../lib/pinTypes";
import { normalizeSearchText } from "../lib/searchText";
import SaveToMyListButton from "../components/SaveToMyListButton";
import { getGithubUsername } from "../lib/displayName";
import { TABELOG_URL_UNAVAILABLE_MESSAGE, isTabelogColumnMissingError } from "../lib/tabelogUrl";
import {
  NO_CATEGORY_FILTER,
  PIN_CATEGORIES,
  formatPinCategory,
  isPinCategoryHidden,
  isPinCategoryColumnMissingError,
  PIN_CATEGORY_UNAVAILABLE_MESSAGE,
  subcategoryFilterKey,
  togglePinSubcategoryFilter,
} from "../lib/pinCategories";
import ThreeDotMenu, {
  MenuItem,
} from "../components/ThreeDotMenu";
import Icon from "../components/Icon.jsx";
import HomeLink from "../components/HomeLink.jsx";
import Breadcrumb from "../components/Breadcrumb.jsx";
import AuthButton from "../components/AuthButton.jsx";
import { showToast } from "../lib/toast.js";
import AddressPinSettingsPanel from "../components/AddressPinSettingsPanel.jsx";
import AddressPinPlacer from "../components/AddressPinPlacer.jsx";
import {
  ADDRESS_PIN_UNAVAILABLE_MESSAGE,
  fitLandmarkTransform,
  getAddressPinSetup,
  getMapLandmarks,
  hasAddressPinColumns,
  isAddressPinColumnMissingError,
  landmarksForSave,
} from "../lib/addressPins.js";
import {
  PIN_RATING_UNAVAILABLE_MESSAGE,
  canRatePin,
  chunkIds,
  formatRatingAverage,
  isPinRatingUnavailableError,
  isRatingEnabled,
  isValidRating,
  mergePinUpdate,
  saveMyRating,
} from "../lib/pinRatings.js";

const MAP_BUTTON_FILTER = "kind:button";

// 地図のマップの表示部品．Leaflet を含むので，地図のマップを開いたときだけ読み込む
const TileMapView = lazy(() => import("../components/TileMapView.jsx"));

/** ピンの保存・更新に失敗したときの文言．SQL 未適用で列が無いときは，空欄にすれば保存できると案内する */
function pinSaveErrorMessage(error, action) {
  if (isTabelogColumnMissingError(error)) return TABELOG_URL_UNAVAILABLE_MESSAGE;
  if (isPinCategoryColumnMissingError(error)) return PIN_CATEGORY_UNAVAILABLE_MESSAGE;
  return `${action}に失敗しました．${error.message}`;
}

/**
 * マップ詳細ページ．
 *
 * URL: /maps/:id
 *
 * URLのIDからマップとピンを取得して表示し，
 * 画像をクリックすると新しいピンを作れるようにする．
 */

export default function MapDetail({ currentUser, isAdmin }) {
  const currentUserId = currentUser?.id;
  // /maps/:id の :id を取得する
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPinId = searchParams.get("pin");
  const requestedCommentId = searchParams.get("comment");
  // Supabaseから取得したデータを保存する
  const [map, setMap] = useState(null);
  // マップが入っているフォルダの階層を保存する
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [pins, setPins] = useState([]);
  // 画面の状態
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // パネルに出しているピン．
  // 既存のピンを見ているときは pins の1件，新しく作るときは { x, y } だけの仮の値．
  // null のときはパネルを出さない．
  const [selectedPin, setSelectedPin] = useState(null);
  const selectedPinRef = useRef(null);
  selectedPinRef.current = selectedPin;
  const requestedPinMissing = requestedPinId && !pins.some((pin) => String(pin.id) === requestedPinId);

  const [pendingPinAppearance, setPendingPinAppearance] = useState({
    kind: "pin",
    pin_type: PIN_TYPES[0].value,
    category: null,
    subcategory: null,
  });

  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState("");

  // 新しいピンの下書きにつける番号．地図をクリックするたびに変わる．
  // ピンのパネルはこの番号が変わったときだけ入力欄を空に戻す（ドラッグで動かしても消えない）．
  const nextDraftIdRef = useRef(1);

  // 「住所から置く」の検索カードを開いているか（#25）
  const [addressPlacerOpen, setAddressPlacerOpen] = useState(false);
  // 「住所からピンを置く設定」の下書き．null のときは設定パネルを出さない（#25）．
  // { landmarks: [{ x, y, lat, lng, label }], enabled, point: 目印にするためにクリックした点 | null }
  const [landmarkSettings, setLandmarkSettings] = useState(null);
  const [savingLandmarks, setSavingLandmarks] = useState(false);
  const [landmarkError, setLandmarkError] = useState("");

  // コピー状態を覚える
  const [copied, setCopied] = useState(false);

  // このマップをお気に入りにしているか（一覧のカードのハートと同じもの）．
  // null は「まだ確かめていない」．確かめ終わるまでハートは押せないようにする．
  const [isFavorited, setIsFavorited] = useState(null);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [mapMenuOpen, setMapMenuOpen] = useState(false);

  // ピンのタイトル検索
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // 同じフォルダに入っている他のマップ（#65のフォルダ機能が前提）．
  // フォルダに入っていないマップ（folder_id が null）では空のまま．
  const [siblingMaps, setSiblingMaps] = useState([]);
  const [siblingMapsOpen, setSiblingMapsOpen] = useState(false);

  // ボタン種類のピン（#67）の移動先として選べる，全マップの一覧．
  const [allMaps, setAllMaps] = useState([]);
  const [mapOptionFolders, setMapOptionFolders] = useState([]);
  const [isPinListOpen, setIsPinListOpen] = useState(false);
  const canEditMap = canManageContent(map, currentUser?.id, isAdmin);
  const currentVisibility = getMapVisibility(map);
  // 「住所から置く」が使えるか（#25）．
  //   地図のマップ … 位置を緯度経度で持つので，設定なしでいつでも使える
  //   画像のマップ … 有効にしてあり，目印から位置を計算できるときだけ
  const isTileMapOpen = Boolean(map) && isTileMap(map);
  const addressPinSetup = map && !isTileMapOpen ? getAddressPinSetup(map) : { ok: false };
  const canPlaceByAddress = Boolean(currentUser) && (isTileMapOpen || addressPinSetup.ok) && !landmarkSettings;
  // 設定のメニューは，画像のマップの作成者・管理者に，SQL を適用済みのときだけ出す
  const canEditAddressPins = canEditMap && map && !isTileMap(map) && hasAddressPinColumns(map);
  // ピンの星評価（#47）．評価機能のオン・オフは，作成者・管理者に，SQL を適用済みのときだけ出す
  const ratingEnabled = isRatingEnabled(map);
  const canEditRatings = Boolean(canEditMap && map && "rating_enabled" in map);
  // 自分が付けた評価（ピンの id → 点数）．ほかの人の評価は DB から読めないので，ここには自分の分だけが入る
  const [myRatings, setMyRatings] = useState(() => new Map());
  const [ratingSavingPinId, setRatingSavingPinId] = useState(null);
  const [savingRatingSetting, setSavingRatingSetting] = useState(false);
  // 自分で評価を保存した回数．読み込み中に保存したら，その読み込み結果は古いので捨てて読み直す
  const ratingWriteCountRef = useRef(0);
  const [ratingsReloadToken, setRatingsReloadToken] = useState(0);
  // 自分の評価を読み込む対象のピン．評価の合計が変わるたびに読み直さないよう，id の並びだけで判断する
  const ratablePinIds = ratingEnabled && currentUserId
    ? pins.filter((pin) => pin.kind !== "button").map((pin) => pin.id).join(",")
    : "";
  /** 地図のピンにマウスを重ねたときの吹き出し．評価がオンで評価があれば「タイトル ⭐4.5」 */
  const pinHoverLabel = useCallback((pin) => {
    const average = ratingEnabled && pin.kind !== "button" ? formatRatingAverage(pin) : null;
    return average ? `${pin.title} ⭐${average}` : pin.title;
  }, [ratingEnabled]);

  function handlePinListClick(pin) {
    setPinError("");
    setIsEditingPin(false);
    setSelectedPin(pin);
    setIsPinListOpen(false);
  }

  // マップ自体（タイトル・説明）の編集
  const [isEditingMap, setIsEditingMap] = useState(false);
  const [mapTitle, setMapTitle] = useState("");
  const [mapDescription, setMapDescription] = useState("");
  const [mapVisibility, setMapVisibility] = useState("public");
  const [savingMap, setSavingMap] = useState(false);
  const [mapError, setMapError] = useState("");



  //PIN_TIPESからvalueだけを取り出す
  const fixedTypeValues = new Set(
    PIN_TYPES.map((type) => type.value)
  );

  //自由入力されたピンのみ取り出す
  const customTypeValues = [
    ...new Set(
      pins
        .filter((pin) => pin.kind !== "button")
        .map((pin) => pin.pin_type)
        .filter(
          (pinType) =>
            pinType && !fixedTypeValues.has(pinType)
        )
    ),
  ];

  //表示種類一覧
  const availablePinTypes = [
    {
      value: MAP_BUTTON_FILTER,
      label: "マップ移動",
      emoji: "🚪",
    },
    ...PIN_TYPES,
    ...customTypeValues.map((value) => ({
      value,
      label: value,
      isCustom: true,
    })),
  ];

  // 表示するピンの種類を管理する
  const [defaultTypeVisible, setDefaultTypeVisible] =
    useState(true);

  // 自分が作成したピンだけ表示する
  const [showOnlyMyPins, setShowOnlyMyPins] = useState(false);

  const [typeVisibility, setTypeVisibility] =
    useState({});
  //その種類が表示対象か調べる
  function isTypeEnabled(typeId) {
    return (
      typeVisibility[typeId] ??
      defaultTypeVisible
    );
  }

  //ピンを動かせるように
  const [isEditingPin, setIsEditingPin] = useState(false);
  // Realtime購読のコールバック（[id]にしか依存させていない）から
  // 常に最新の isEditingPin を読めるようにするためのref．
  const isEditingPinRef = useRef(isEditingPin);
  useEffect(() => {
    isEditingPinRef.current = isEditingPin;
  }, [isEditingPin]);
  // position は，画像のマップなら { x, y }，地図のマップなら { lat, lng }（lib/tileMaps.js）
  function handleMovePin(position) {
    if (!isEditingPin) return;

    setSelectedPin((pin) => {
      if (!pin) return pin;

      const moved = { ...pin, ...position };
      // 座標が変わっていなければ再レンダーしない
      if (isSamePinPosition(pin, moved)) {
        return pin;
      }

      return moved;
    });
  }

  function startEditingPin() {
    if (!selectedPin?.id) return;

    setPinError("");
    setIsEditingPin(true);
  }

  function cancelEditingPin() {
    const originalPin = pins.find(
      (pin) => pin.id === selectedPin?.id
    );

    if (originalPin) {
      setSelectedPin(originalPin);
    }

    setPinError("");
    setIsEditingPin(false);
  }

  // ピンの表示・非表示を切り替えるhandle
  function handleTypeToggle(typeId) {
    setTypeVisibility((prev) => {
      const currentlyEnabled =
        prev[typeId] ?? defaultTypeVisible;

      return {
        ...prev,
        [typeId]: !currentlyEnabled,
      };
    });
  }
  // 全選択
  function handleSelectAll() {
    setDefaultTypeVisible(true);
    setTypeVisibility({});
  }
  // 全解除
  function handleDeselectAll() {
    setDefaultTypeVisible(false);
    setTypeVisibility({});
  }

  // カテゴリの絞り込み．隠しているカテゴリ（"food"）とサブカテゴリ（"food:ramen"）の鍵を持つ．
  // 何も入っていなければすべて表示．
  const [hiddenCategoryKeys, setHiddenCategoryKeys] = useState(() => new Set());
  // サブカテゴリの一覧を開いているカテゴリ．長い一覧でスクロールさせないよう，最初は閉じておく．
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());

  // このマップで使われているカテゴリとサブカテゴリだけを絞り込みに出す（一覧を短く保つため）．
  // マップ移動のボタンは場所ではないので数えない．
  const placePins = pins.filter((pin) => pin.kind !== "button");
  const usedCategories = PIN_CATEGORIES
    .flatMap((category) => {
      const categoryPins = placePins.filter((pin) => pin.category === category.value);
      if (categoryPins.length === 0) return [];

      const subcategories = category.subcategories.filter((subcategory) =>
        categoryPins.some((pin) => pin.subcategory === subcategory.value),
      );
      if (categoryPins.some((pin) => pin.subcategory == null)) {
        subcategories.push({ value: null, label: "サブカテゴリ未指定" });
      }
      return [{ ...category, subcategories }];
    });
  const hasUncategorizedPins = placePins.some((pin) => !formatPinCategory(pin));
  const categoryFilterActive = placePins.some((pin) => isPinCategoryHidden(pin, hiddenCategoryKeys));

  function toggleHiddenKey(keys, key) {
    const next = new Set(keys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function handleCategoryToggle(categoryValue, visible) {
    setHiddenCategoryKeys((current) => {
      const next = new Set(current);
      if (visible) {
        // 表示に戻すときは，サブカテゴリもまとめて表示に戻す
        next.delete(categoryValue);
        for (const key of next) {
          if (key.startsWith(`${categoryValue}:`)) next.delete(key);
        }
      } else {
        next.add(categoryValue);
      }
      return next;
    });
  }

  // 絞り込みが効いているかどうか．開閉ボタンに印を出して，閉じていても気づけるようにする．
  const filtersActive =
    searchQuery.trim() !== "" ||
    showOnlyMyPins ||
    categoryFilterActive ||
    availablePinTypes.some((type) => !isTypeEnabled(type.value));

  // 表示対象のピンに絞り込む（種類フィルタ × タイトル検索のAND条件）．
  // ただし今まさに編集中のピンは，フィルタに一致しなくなっても地図上から消さない
  // （フィルタ変更でドラッグ対象が消えて操作できなくなるのを防ぐ）．
  const visiblePins = pins.filter((pin) => {
    // 編集中のピンは、フィルターに関係なく表示し続ける
    if (isEditingPin && pin.id === selectedPin?.id) {
      return true;
    }

    const displayType =
      pin.kind === "button"
        ? MAP_BUTTON_FILTER
        : pin?.pin_type || PIN_TYPES[0].value;

    const isTypeMatch = isTypeEnabled(displayType);

    const isTitleMatch = normalizeSearchText(pin?.title).includes(
      normalizeSearchText(searchQuery.trim()),
    );

    const isCreatorMatch =
      !showOnlyMyPins || pin.user_id === currentUser?.id;

    // マップ移動のボタンはカテゴリを持たないので，カテゴリの絞り込みは当てない
    const isCategoryMatch =
      pin.kind === "button" || !isPinCategoryHidden(pin, hiddenCategoryKeys);

    return isTypeMatch && isTitleMatch && isCreatorMatch && isCategoryMatch;
  });
  const displayPins = visiblePins.map((pin) =>
    isEditingPin && pin.id === selectedPin?.id
      ? {
        ...selectedPin,
        ...pendingPinAppearance,
      }
      : pin
  );
  // マップとピンを取得する
  const loadMapDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMap(null);
    setPins([]);
    setSelectedPin(null);
    setPinError("");
    setIsEditingPin(false);
    setSearchQuery("");
    setIsEditingMap(false);
    setMapError("");
    setAddressPlacerOpen(false);
    setLandmarkSettings(null);
    // 表示フィルタは前のマップの設定を持ち越さない．
    // 持ち越すと，「すべてオフ」等にした状態で別マップを開いたときに
    // ピンが1つも表示されず，原因も分からないまま操作不能に見えてしまう．
    setDefaultTypeVisible(true);
    setTypeVisibility({});
    setShowOnlyMyPins(false);
    setHiddenCategoryKeys(new Set());
    setExpandedCategories(new Set());

    try {
      // 1. mapsテーブルから、URLのIDに一致するマップを取得
      const { data: mapData, error: mapError } = await supabase
        .from("maps")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      // 22P02 はIDの形式が不正なときのエラー．
      // /maps/abc123 のようにUUIDでない文字列が入ると起きるので，
      // 「見つからなかった」と同じ扱いにする．
      if (mapError?.code === "22P02") {
        return;
      }

      if (mapError) {
        throw mapError;
      }

      // 該当するマップが存在しない場合
      if (!mapData) {
        return;
      }

      // マップがフォルダに入っている場合、親フォルダを順番にたどる
      const crumbs = [];
      let cursor = mapData.folder_id;

      while (cursor) {
        const { data: folderData, error: folderError } = await supabase
          .from("folders")
          .select("id, name, parent_folder_id")
          .eq("id", cursor)
          .maybeSingle();

        if (folderError) {
          throw folderError;
        }

        if (!folderData) {
          break;
        }

        crumbs.unshift(folderData);
        cursor = folderData.parent_folder_id;
      }

      setBreadcrumb(crumbs);

      // 2. pinsテーブルから、そのマップのピンを取得
      const { data: pinData, error: pinError } = await supabase
        .from("pins")
        .select("*")
        .eq("map_id", id)
        .order("created_at", { ascending: true });

      if (pinError) {
        throw pinError;
      }

      const mapPins = pinData ?? [];
      if (requestedPinId) {
        // 一覧の取得件数に上限があっても、リンク先のピンを同じマップ内で探す。
        let linkedPin = mapPins.find((pin) => String(pin.id) === requestedPinId);
        if (!linkedPin) {
          const { data, error: linkedPinError } = await supabase
            .from("pins")
            .select("*")
            .eq("map_id", id)
            .eq("id", requestedPinId)
            .maybeSingle();
          if (linkedPinError && linkedPinError.code !== "22P02") throw linkedPinError;
          linkedPin = data;
          if (linkedPin) mapPins.push(linkedPin);
        }
        setSelectedPin(linkedPin ?? null);
      }

      // 3. 取得したデータをstateへ保存
      setMap(mapData);
      setMapTitle(mapData.title);
      setMapDescription(mapData.description ?? "");
      setMapVisibility(getMapVisibility(mapData));
      setPins(mapPins);
    } catch (fetchError) {
      setError(fetchError);
    } finally {
      setLoading(false);
    }
  }, [id, requestedPinId]);

  useEffect(() => {
    loadMapDetail();
  }, [loadMapDetail]);

  useEffect(() => {
    const share = getCurrentMapShare(id);
    if (!currentUser || currentVisibility !== "unlisted" || !share) return;
    // ログインして受け取ったリンクは、保存済み一覧や別のタブからも同じユーザーが開ける。
    supabase.rpc("accept_map_share_link", { target_map_id: id, share_token: share.token })
      .then(({ error }) => {
        if (error) console.error("共有リンクの利用権限を保存できませんでした。", error.code);
      });
  }, [id, currentUser, currentVisibility]);

  // パネルが閉じたら（他の人の削除で自動的に閉じた場合も含む），
  // 編集モード・エラー表示を残さないようにする．
  useEffect(() => {
    if (!selectedPin) {
      setIsEditingPin(false);
      setPinError("");
    }
  }, [selectedPin]);

  // 同じフォルダの他マップを取る．
  // 依存を map?.folder_id（値）にしているので，同じフォルダ内で
  // マップを切り替えても（id は変わるが folder_id は変わらない）取り直さない．
  useEffect(() => {
    if (!map?.folder_id) {
      setSiblingMaps([]);
      return;
    }

    let ignore = false;

    async function loadSiblings() {
      const { data, error: siblingsError } = await supabase
        .from("maps")
        .select("id, title, is_public, visibility, user_id")   // is_public, user_idも取得
        .eq("folder_id", map.folder_id)
        .order("created_at", { ascending: true });

      if (!ignore && !siblingsError) {
        setSiblingMaps(data ?? []);
      }
    }

    loadSiblings();
    return () => {
      ignore = true;
    };
  }, [map?.folder_id]);

  const linkedMapIdsKey = [...new Set(pins.map((pin) => pin.link_map_id).filter(Boolean))].sort().join(",");
  useEffect(() => {
    let cancelled = false;
    let version = 0;
    async function loadMapOptions() {
      const currentVersion = ++version;
      try {
        const savedIds = [];
        if (currentUserId) {
          for (let start = 0; ; start += 500) {
            const { data, error } = await supabase.from("saved_maps").select("map_id")
              .eq("user_id", currentUserId).order("map_id").range(start, start + 499);
            if (cancelled || currentVersion !== version) return;
            if (error) throw error;
            savedIds.push(...(data ?? []).map((row) => row.map_id));
            if (!data || data.length < 500) break;
          }
        }
        const saved = new Set(savedIds);
        const ids = [...new Set([...savedIds, ...linkedMapIdsKey.split(",").filter(Boolean)])];
        const availableMaps = [];
        // 既存ボタンの移動可否と、新規作成で選べる候補は別に管理する。
        if (currentUserId || ids.length) {
          for (let start = 0; ; start += 500) {
            let query = supabase.from("maps").select("id, title, folder_id, user_id").eq("is_public", true)
              .order("id").range(start, start + 499);
            if (currentUserId) {
              query = ids.length ? query.or(`user_id.eq.${currentUserId},id.in.(${ids.join(",")})`)
                : query.eq("user_id", currentUserId);
            } else query = query.in("id", ids);
            const { data, error } = await query;
            if (cancelled || currentVersion !== version) return;
            if (error) throw error;
            availableMaps.push(...(data ?? []));
            if (!data || data.length < 500) break;
          }
        }
        if (cancelled || currentVersion !== version) return;
        setAllMaps(availableMaps.map((target) => ({ ...target,
          is_destination_option: Boolean(currentUserId && (target.user_id === currentUserId || saved.has(target.id))),
        })));
        // パンくずは自分のフォルダだけ。公開マップから他人のフォルダ名は取得しない。
        if (currentUserId) {
          const { data, error } = await supabase.from("folders").select("id, name, parent_folder_id, user_id")
            .eq("user_id", currentUserId);
          if (!cancelled && currentVersion === version) setMapOptionFolders(error ? [] : data ?? []);
        } else setMapOptionFolders([]);
      } catch (error) {
        if (!cancelled && currentVersion === version) { setAllMaps([]); console.error("移動先マップの取得に失敗", error); }
      }
    }
    loadMapOptions();
    function refresh() { if (document.visibilityState === "visible") loadMapOptions(); }
    const unsubscribe = subscribeSavedMapsChanged(refresh);
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 15000);
    return () => { cancelled = true; unsubscribe(); window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, [currentUserId, linkedMapIdsKey, id]);

  // 公開範囲が別の画面から変わった場合、開いている内容も取り下げる。
  useEffect(() => {
    let cancelled = false;
    let checking = false;
    async function refreshAccess() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const { data, error } = await supabase.from("maps").select("*").eq("id", id).maybeSingle();
        if (cancelled || error) return;
        setMap(data);
        if (!data) { setPins([]); setSelectedPin(null); setBreadcrumb([]); setAllMaps([]); setIsEditingMap(false); }
      } finally { checking = false; }
    }
    const interval = window.setInterval(refreshAccess, 10000);
    window.addEventListener("focus", refreshAccess);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", refreshAccess); };
  }, [id, currentUserId]);

  // このマップをお気に入りにしているかを確かめる（ログインしているときだけ）
  useEffect(() => {
    setIsFavorited(null);
    if (!currentUserId) return;

    let ignore = false;
    supabase.from("map_favorites").select("map_id")
      .eq("map_id", id).eq("user_id", currentUserId).maybeSingle()
      .then(({ data, error: favoriteError }) => {
        if (ignore) return;
        if (favoriteError) {
          console.error("お気に入りの状態を確認できませんでした", favoriteError);
          return;
        }
        setIsFavorited(Boolean(data));
      });
    return () => {
      ignore = true;
    };
  }, [id, currentUserId]);

  // 他の人が置いた・書き直した・消したピンを，リロードなしで反映する．
  //
  // Supabase側で pins テーブルの変更配信（Replication）を有効にしておかないと，
  // ここは何も受け取れない（#39のヒント参照）．
  useEffect(() => {
    if (!currentUserId) {
      let controller;
      async function refreshSharedPins() {
        if (document.visibilityState !== "visible") return;
        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;
        const selectedId = selectedPinRef.current?.id;
        const { data, error } = await supabase.from("pins").select("*")
          .eq("map_id", id).order("created_at", { ascending: true }).abortSignal(signal);
        if (error || signal.aborted) return;
        const updatedPins = data ?? [];
        // 取得上限より後ろのピンを表示中でも、そのピンを個別に確認する。
        if (selectedId && !updatedPins.some((pin) => pin.id === selectedId)) {
          const { data: linkedPin, error: linkedError } = await supabase.from("pins").select("*")
            .eq("map_id", id).eq("id", selectedId).maybeSingle().abortSignal(signal);
          if (linkedError || signal.aborted) return;
          if (linkedPin) updatedPins.push(linkedPin);
        }
        setPins(updatedPins);
        setSelectedPin((current) => current?.id === selectedId
          ? updatedPins.find((pin) => pin.id === selectedId) ?? null : current);
      }
      // 匿名の共有閲覧は、共有キー付きのHTTP取得で変更を反映する。
      const interval = window.setInterval(refreshSharedPins, 10000);
      window.addEventListener("focus", refreshSharedPins);
      return () => {
        controller?.abort();
        window.clearInterval(interval);
        window.removeEventListener("focus", refreshSharedPins);
      };
    }

    const channel = supabase
      .channel(`pins-of-map-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pins", filter: `map_id=eq.${id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            // 自分が置いたピンは，保存時にすでに手元へ足してある．
            // 同じ id が来たら足さないことで，二重表示を防ぐ．
            setPins((current) =>
              current.some((p) => p.id === payload.new.id)
                ? current
                : [...current, payload.new],
            );
          } else if (payload.eventType === "UPDATE") {
            // 評価（#47）が変わるたびに合計と件数だけが更新され，長いメモなどは送られてこないことがあるので，
            // 届いた列だけを手元のピンに重ねる
            setPins((current) =>
              current.map((p) => (p.id === payload.new.id ? mergePinUpdate(p, payload.new) : p)),
            );
            // 今パネルで表示中のピンが他の人に書き換えられた場合，古い内容を
            // 表示し続けない．ただし自分が編集中のときは，入力途中の内容を
            // 消してしまわないよう上書きしない（保存時にどちらが勝つかは
            // 別問題として残るが，少なくとも見ている内容は最新化する）．
            setSelectedPin((current) =>
              current?.id === payload.new.id && !isEditingPinRef.current
                ? mergePinUpdate(current, payload.new)
                : current,
            );
          } else if (payload.eventType === "DELETE") {
            setPins((current) => current.filter((p) => p.id !== payload.old.id));
            // 今開いている・編集中のピンが他の人に消された場合，
            // 存在しないピンをパネルに表示し続けないようにする．
            setSelectedPin((current) =>
              current?.id === payload.old.id ? null : current,
            );
          }
        },
      )
      .subscribe();

    // ページを離れる・別のマップに移るときは，必ず接続を切る．
    // 切らないと，開くたびに接続が増え続ける．
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, currentUserId]);

  /**
   * 地図の何もない場所がクリックされた．そこに新しいピンを作る準備をする．
   * position は，画像のマップなら { x, y }，地図のマップなら { lat, lng }．
   */
  async function handleMapClick(position) {
    // 「住所からピンを置く設定」を開いているときは，ピンではなく目印にする点を選ぶ
    if (landmarkSettings) {
      setLandmarkSettings((current) => current && { ...current, point: { x: position.x, y: position.y } });
      return;
    }

    setPinError("");
    setAddressPlacerOpen(false);

    // 現在ログインしているユーザーを確認する
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 未ログインのときは onMapClick 自体を渡していないので，通常ここには来ない．
    // 来るのは，画面を開いたままログインが切れた場合．
    if (!user) {
      showToast("ピンを追加するにはログインしてください。", { tone: "error" });
      return;
    }
    setSelectedPin({ ...position, draftId: nextDraftIdRef.current++ });
  }

  /** 追加前の仮のピンをドラッグで動かした．position は { x, y } か { lat, lng } */
  function handlePendingPinMove(position) {
    setSelectedPin((pin) => (pin && !pin.id ? { ...pin, ...position } : pin));
  }

  /** 「住所から置く」で求めた位置に，仮のピンを置く */
  async function handlePlaceByAddress(position) {
    await handleMapClick(position);
    showToast(isTileMapOpen
      ? "住所の場所に置きました。ずれていたら、ピンをドラッグして調整できます。"
      : "住所から計算した位置に置きました。位置は目安なので、ピンをドラッグして調整できます。");
  }

  /** 「住所から置く」をやめて，地図のクリックで置く */
  function handlePlaceByClickInstead() {
    setAddressPlacerOpen(false);
    showToast("地図の置きたい場所をクリックしてください。");
  }

  function openLandmarkSettings() {
    setSelectedPin(null);
    setIsEditingPin(false);
    setAddressPlacerOpen(false);
    setLandmarkError("");
    setLandmarkSettings({
      landmarks: getMapLandmarks(map),
      enabled: Boolean(map.address_pin_enabled),
      point: null,
    });
  }

  function closeLandmarkSettings() {
    setLandmarkSettings(null);
    setLandmarkError("");
  }

  /** 目印と有効・無効を保存する．maps の更新なので，作成者と管理者だけができる（RLS） */
  async function handleSaveLandmarks() {
    if (!landmarkSettings || savingLandmarks) return;
    if (!canEditMap) {
      setLandmarkError("このマップの設定は変更できません。");
      return;
    }
    // 目印が足りないなど，計算できない状態では有効にしない
    const enabled = landmarkSettings.enabled && fitLandmarkTransform(landmarkSettings.landmarks).ok;

    setSavingLandmarks(true);
    setLandmarkError("");
    try {
      const { data: updated, error: updateError } = await supabase
        .from("maps")
        .update({
          address_landmarks: landmarksForSave(landmarkSettings.landmarks),
          address_pin_enabled: enabled,
        })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (updateError || !updated) {
        console.error("住所からピンを置く設定の保存に失敗", updateError);
        setLandmarkError(isAddressPinColumnMissingError(updateError)
          ? ADDRESS_PIN_UNAVAILABLE_MESSAGE
          : `保存できませんでした。${updateError?.message ?? "このマップの設定を変更する権限がありません。"}`);
        return;
      }

      setMap(updated);
      setLandmarkSettings(null);
      showToast(enabled ? "住所からピンを置けるようにしました。" : "設定を保存しました。");
    } catch (e) {
      console.error("住所からピンを置く設定の保存中に予期しないエラー", e);
      setLandmarkError(`予期しないエラーが発生しました。${e?.message ?? e}`);
    } finally {
      setSavingLandmarks(false);
    }
  }

  /** ピンをクリックしたら詳細パネルを開く */
  function handlePinClick(pin) {
    // 「住所からピンを置く設定」の間は，ピンを開かない（設定パネルと重なるため）
    if (landmarkSettings) return;
    setPinError("");
    setIsEditingPin(false);
    setSelectedPin(pin);
  }


  /** マップ移動ボタンをダブルクリックしたら直接移動する */
  async function handlePinDoubleClick(pin) {
    if (pin.kind !== "button") return;

    await handleNavigateToMap(pin.link_map_id);
  }

  async function validateMapDestination(linkMapId, requireCandidate = false) {
    if (!linkMapId) { setPinError("移動先のマップを選んでください。"); return false; }
    const { data: target, error } = await supabase.from("maps").select("id, user_id")
      .eq("id", linkMapId).eq("is_public", true).maybeSingle();
    if (error || !target) { setPinError("移動先は存在しないか、公開範囲・閲覧権限が変更されたため利用できません。"); return false; }
    if (requireCandidate && target.user_id !== currentUserId) {
      const { data: saved, error: saveError } = await supabase.from("saved_maps").select("map_id")
        .eq("user_id", currentUserId).eq("map_id", linkMapId).maybeSingle();
      if (saveError || !saved) { setPinError("移動先には自分が作成したマップか、保存済みのマップを選んでください。"); return false; }
    }
    return true;
  }

  /** パネルの移動ボタンから移動する */
  async function handleNavigateToMap(linkMapId) {
    setPinError("");
    if (!await validateMapDestination(linkMapId)) return;

    // window.open は非同期処理（Supabase問い合わせ）の後に呼ぶと，
    // ユーザー操作起因のポップアップと認識されずブラウザにブロックされる
    // ことがある（特にSafari）．同じタブ内でのSPA遷移にしておけばその心配がない．
    navigate(`/maps/${linkMapId}`);
  }

  function closePanel() {
    setSelectedPin(null);
    setIsEditingPin(false);
    setPinError("");
  }

  function clearDeletedCommentLink(commentId) {
    if (String(commentId) !== requestedCommentId) return;
    // 削除中に別のページに移った場合は、そのページのURLを書き換えない。
    if (window.location.pathname !== location.pathname || window.location.search !== location.search) return;

    // 対象コメントへの指定だけを外し、ピンは開いたままにする。
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("comment");
    setSearchParams(nextParams, { replace: true });
  }

  // コピー処理を追加
  // utrをクリップボードにコピー、2秒経ったらもとに戻す（Issueのコード通り）
  async function toggleFavorite() {
    if (!currentUserId || isFavorited === null || savingFavorite) return;

    const next = !isFavorited;
    setSavingFavorite(true);
    // 押した瞬間に見た目を切り替え，失敗したら元に戻す
    setIsFavorited(next);
    const { error: favoriteError } = next
      ? await supabase.from("map_favorites").insert({ map_id: id, user_id: currentUserId })
      : await supabase.from("map_favorites").delete().eq("map_id", id).eq("user_id", currentUserId);
    if (favoriteError) {
      console.error("お気に入りの更新に失敗", favoriteError);
      setIsFavorited(!next);
      showToast("お気に入りを更新できませんでした。", { tone: "error" });
    }
    setSavingFavorite(false);
  }

  async function copyUrl() {
    try {
      const url = await getMapShareUrl(id, map, canEditMap);
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // コピーできたことは画面上部の通知で伝える（保存ボタンの行をなくしたので，そこには出さない）
      showToast("共有URLをコピーしました。");
    } catch (copyError) {
      console.error("共有リンクのコピーに失敗", copyError);
      setMapError("共有リンクをコピーできませんでした。");
    }
  }

  function startEditingMap() {
    setMapTitle(map.title);
    setMapDescription(map.description ?? "");
    setMapVisibility(getMapVisibility(map));
    setMapError("");
    setIsEditingMap(true);
  }

  function cancelEditingMap() {
    setMapTitle(map.title);
    setMapDescription(map.description ?? "");
    setMapVisibility(getMapVisibility(map));
    setMapError("");
    setIsEditingMap(false);
  }

  /** マップのタイトル・説明を書き直す */
  async function handleUpdateMap(event) {
    event.preventDefault();
    if (savingMap) return;
    if (!canEditMap) {
      setMapError("このマップは編集できません．");
      return;
    }
    const trimmedTitle = mapTitle.trim();
    if (!trimmedTitle) return;

    setSavingMap(true);
    setMapError("");

    try {
      const { data: updated, error: updateError } = await supabase
        .from("maps")
        .update({
          title: trimmedTitle,
          description: mapDescription.trim(),
          ...mapVisibilityValues(mapVisibility),
        })
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        console.error("マップの更新に失敗", updateError);
        setMapError(`更新に失敗しました．${updateError.message}`);
        return;
      }

      setMap(updated);
      setMapTitle(updated.title);
      setMapDescription(updated.description ?? "");
      setIsEditingMap(false);
    } catch (e) {
      console.error("マップの更新中に予期しないエラー", e);
      setMapError(`予期しないエラーが発生しました．${e?.message ?? e}`);
    } finally {
      setSavingMap(false);
    }
  }

  /** マップを削除する（pinsはon delete cascadeで一緒に消える）． */
  async function handleDeleteMap() {
    if (savingMap) return;

    if (!canEditMap) {
      setMapError("このマップは削除できません．");
      return;
    }

    if (
      !window.confirm(
        "このマップを削除しますか？中のピンもすべて削除され，元に戻せません．",
      )
    ) {
      return;
    }

    setSavingMap(true);
    setMapError("");

    try {
      const { data: deleted, error: deleteError } = await supabase
        .from("maps")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (deleteError) {
        console.error("マップの削除に失敗", deleteError);
        setMapError(`削除に失敗しました．${deleteError.message}`);
        return;
      }

      if (!deleted) {
        setMapError("このマップは削除できませんでした．");
        return;
      }

      navigate(isAdmin ? "/admin/maps" : "/", { replace: true });
    } catch (e) {
      console.error("マップの削除中に予期しないエラー", e);
      setMapError(`予期しないエラーが発生しました．${e?.message ?? e}`);
    } finally {
      setSavingMap(false);
    }
  }

  /** パネルの入力を pins テーブルに保存する */
  // 自分が付けた評価を読む（#47）．RLS により，自分の分だけが返る
  useEffect(() => {
    if (!ratablePinIds) return;
    const controller = new AbortController();
    const writeCountAtStart = ratingWriteCountRef.current;
    (async () => {
      // ピンが多いマップでも URL が長くなりすぎないよう，100件ずつ読む
      const results = await Promise.all(chunkIds(ratablePinIds.split(","), 100).map((ids) =>
        supabase.from("pin_ratings").select("pin_id, rating").in("pin_id", ids).abortSignal(controller.signal)));
      if (controller.signal.aborted) return;
      // 読み込んでいる間に自分で評価を保存していたら，この結果は古いので読み直す
      if (ratingWriteCountRef.current !== writeCountAtStart) {
        setRatingsReloadToken((token) => token + 1);
        return;
      }
      const loadError = results.find((result) => result.error)?.error;
      if (loadError) {
        if (!isPinRatingUnavailableError(loadError)) console.error("自分の評価の読み込みに失敗", loadError);
        setMyRatings(new Map());
        return;
      }
      setMyRatings(new Map(results.flatMap((result) => result.data).map((row) => [row.pin_id, Number(row.rating)])));
    })();
    return () => controller.abort();
  }, [ratablePinIds, ratingsReloadToken]);

  /** ピンの合計と件数を読み直して，手元のピンに反映する（リアルタイムの反映を待たずに平均を更新する） */
  async function refreshPinRatingTotals(pinId) {
    const { data, error: refreshError } = await supabase
      .from("pins")
      .select("id, rating_sum, rating_count")
      .eq("id", pinId)
      .maybeSingle();
    if (refreshError || !data) return;
    const merge = (pin) => (pin?.id === pinId ? { ...pin, rating_sum: data.rating_sum, rating_count: data.rating_count } : pin);
    setPins((current) => current.map(merge));
    setSelectedPin((current) => merge(current));
  }

  /** 自分の評価を付ける・変える・取り消す（rating が null なら取り消す） */
  async function handleRatePin(pinId, rating) {
    if (!currentUserId || ratingSavingPinId) return;
    if (rating !== null && !isValidRating(rating)) return;

    setRatingSavingPinId(pinId);
    setPinError("");
    try {
      // 手元の「自分の評価」が古くても失敗しないよう，変更→追加の順で試す（lib/pinRatings.js）
      const { ok, error: saveError } = await saveMyRating(supabase, { pinId, userId: currentUserId, rating });
      ratingWriteCountRef.current += 1;

      if (!ok) {
        console.error("評価の保存に失敗", saveError);
        setPinError(isPinRatingUnavailableError(saveError)
          ? PIN_RATING_UNAVAILABLE_MESSAGE
          : "評価を保存できませんでした。評価機能がオフになったか、このピンを見られなくなった可能性があります。");
        return;
      }

      setMyRatings((current) => {
        const next = new Map(current);
        if (rating === null) next.delete(pinId);
        else next.set(pinId, rating);
        return next;
      });
      await refreshPinRatingTotals(pinId);
    } catch (e) {
      console.error("評価の保存中に予期しないエラー", e);
      setPinError(`予期しないエラーが発生しました．${e?.message ?? e}`);
    } finally {
      setRatingSavingPinId(null);
    }
  }

  /** マップの評価機能をオン・オフする（作成者・管理者だけ） */
  async function handleToggleRatingEnabled() {
    if (!canEditRatings || savingRatingSetting) return;
    const nextEnabled = !ratingEnabled;

    setSavingRatingSetting(true);
    try {
      const { data: updated, error: updateError } = await supabase
        .from("maps")
        .update({ rating_enabled: nextEnabled })
        .eq("id", id)
        .select()
        .maybeSingle();

      if (updateError || !updated) {
        console.error("評価機能の切り替えに失敗", updateError);
        showToast(isPinRatingUnavailableError(updateError)
          ? PIN_RATING_UNAVAILABLE_MESSAGE
          : "評価機能を切り替えられませんでした。", { tone: "error" });
        return;
      }

      setMap(updated);
      showToast(nextEnabled
        ? "このマップでピンの評価を使えるようにしました。"
        : "このマップでピンの評価を使わないようにしました。これまでの評価は残ります。");
    } catch (e) {
      console.error("評価機能の切り替え中に予期しないエラー", e);
      showToast(`予期しないエラーが発生しました。${e?.message ?? e}`, { tone: "error" });
    } finally {
      setSavingRatingSetting(false);
    }
  }

  async function handleSavePin({ title, content, pinType, category = null, subcategory = null, kind, linkMapId, tabelogUrl = null, rating = null }) {
    if (savingPin || !selectedPin) return;

    setSavingPin(true);
    setPinError("");

    try {
      // 現在ログインしているユーザーを取得する
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setPinError("ピンを作成するにはログインしてください．");
        return;
      }
      if (kind === "button" && !await validateMapDestination(linkMapId, true)) return;
      const { data: created, error: insertError } = await supabase
        .from("pins")
        .insert({
          map_id: id,
          // 画像のマップは { x, y }，地図のマップは { lat, lng } だけを送る（lib/tileMaps.js）
          ...pinPositionValues(map, selectedPin),
          title,
          content,
          pin_type: pinType,
          kind,
          link_map_id: kind === "button" ? linkMapId : null,
          user_id: user.id,
          // GitHubでログインしていない（メールのみの）場合は null のままにする．
          // メールアドレスにフォールバックすると，他の閲覧者全員に生のメール
          // アドレスが見えてしまうため．
          creator_username: getGithubUsername(user),
          // 食べログ URL は入力したときだけ送る．空欄なら，SQL 未適用の環境でもこれまでどおり保存できる（#5）
          ...(tabelogUrl ? { tabelog_url: tabelogUrl } : {}),
          // カテゴリも選んだときだけ送る．「なし」なら，SQL 未適用の環境でもこれまでどおり保存できる
          ...(category ? { category, subcategory } : {}),
        })
        .select()
        .single();

      if (insertError) {
        console.error("ピンの保存に失敗", insertError);
        setPinError(pinSaveErrorMessage(insertError, "保存"));
        return;
      }

      // 作られたピンを手元の一覧に足す．
      // ここで loadMapDetail() を呼び直すと，画面が一度「読み込み中...」に戻って
      // 地図が消えるので，ピンを1件足すだけのときは呼ばない．
      setPins((current) =>
        current.some((p) => p.id === created.id)
          ? current
          : [...current, created],
      );

      // 追加するときに付けた評価は，ピンができてから保存する（#47）．
      // 評価だけ保存できなくても，ピンは残す．
      if (rating !== null && canRatePin(map, created)) {
        const { ok: ratingSaved, error: ratingError } = await saveMyRating(supabase, { pinId: created.id, userId: user.id, rating });
        ratingWriteCountRef.current += 1;
        if (!ratingSaved) {
          console.error("追加したピンの評価の保存に失敗", ratingError);
          showToast("ピンは保存しましたが、評価は保存できませんでした。", { tone: "error" });
        } else {
          setMyRatings((current) => new Map(current).set(created.id, rating));
          await refreshPinRatingTotals(created.id);
        }
      }
      closePanel();
    } catch (e) {
      console.error("ピンの保存中に予期しないエラー", e);
      setPinError(`予期しないエラーが発生しました．${e?.message ?? e}`);
    } finally {
      setSavingPin(false);
    }
  }

  /** パネルで編集した内容を更新する */
  async function handleUpdatePin({ title, content, pinType, category = null, subcategory = null, kind, linkMapId, tabelogUrl = null }) {
    if (savingPin || !selectedPin) return;

    setSavingPin(true);
    setPinError("");

    try {
      // 現在ログインしているユーザーを取得する
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      const canEdit = canManageContent(selectedPin, user?.id, isAdmin && user?.id === currentUser?.id);
      if (userError || !canEdit) {
        setPinError("このピンは編集できません．");
        return;
      }

      if (kind === "button" && !await validateMapDestination(linkMapId, true)) return;
      const { data: updated, error: updateError } = await supabase
        .from("pins")
        .update({
          ...pinPositionValues(map, selectedPin),
          title,
          content,
          pin_type: pinType,
          kind,
          link_map_id: kind === "button" ? linkMapId : null,
          // 食べログ URL は変えたときだけ送る．触っていなければ，SQL 未適用の環境でもこれまでどおり更新できる（#5）
          ...(tabelogUrl !== (selectedPin.tabelog_url ?? null) ? { tabelog_url: tabelogUrl } : {}),
          // カテゴリも変えたときだけ送る（食べログ URL と同じ考え方）
          ...(category !== (selectedPin.category ?? null) || subcategory !== (selectedPin.subcategory ?? null)
            ? { category, subcategory }
            : {}),
        })
        .eq("id", selectedPin.id)
        .select()
        .single();

      if (updateError) {
        console.error("ピンの更新に失敗", updateError);
        setPinError(pinSaveErrorMessage(updateError, "更新"));
        return;
      }

      // 手元の配列を書き換えて画面に即時反映
      setPins((current) =>
        current.map((p) => (p.id === updated.id ? updated : p))
      );
      closePanel();
    } catch (e) {
      console.error("ピンの更新中に予期しないエラー", e);
      setPinError(`予期しないエラーが発生しました．${e?.message ?? e}`);
    } finally {
      setSavingPin(false);
    }
  }

  /** ピンを削除する */
  async function handleDeletePin() {
    if (savingPin || !selectedPin) return;

    setSavingPin(true);
    setPinError("");

    try {
      // 現在ログインしているユーザーを取得する
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      const canDelete = canManageContent(selectedPin, user?.id, isAdmin && user?.id === currentUser?.id);
      if (userError || !canDelete) {
        setPinError("このピンは削除できません．");
        return;
      }

      if (!window.confirm("このピンを削除しますか？")) {
        return;
      }

      const { data: deleted, error: deleteError } = await supabase
        .from("pins")
        .delete()
        .eq("id", selectedPin.id)
        .select("id")
        .maybeSingle();

      if (deleteError) {
        console.error("ピンの削除に失敗", deleteError);
        setPinError(`削除に失敗しました．${deleteError.message}`);
        return;
      }

      if (!deleted) {
        setPinError("このピンは削除できませんでした．");
        return;
      }

      // 手元の配列から対象のピンを除外
      setPins((current) => current.filter((p) => p.id !== selectedPin.id));
      closePanel();
    } catch (e) {
      console.error("ピンの削除中に予期しないエラー", e);
      setPinError(`予期しないエラーが発生しました．${e?.message ?? e}`);
    } finally {
      setSavingPin(false);
    }
  }

  // 1. 読み込み中は Loading コンポーネントを表示
  if (loading) {
    return <Loading />;
  }

  // 2. エラー時は ErrorMessage コンポーネントを表示（error.messageを渡す）
  // スマホではこのページに共通ヘッダーが出ない（App.jsx）ので，
  // 表示できなかったときも，ここから一覧に戻ったりログインしたりできるようにしておく．
  if (error) {
    return (
      <div className="p-4">
        <ErrorMessage message={error.message} className="" />
        <HomeLink className="btn mt-3" />
      </div>
    );
  }

  // URLのIDに一致するマップがなかった場合
  if (!map) {
    return (
      <div className="grid h-full place-items-center overflow-auto p-8 text-sub">
        <div className="w-full max-w-md space-y-3 text-center">
          <p className="text-lg font-semibold text-ink">マップが見つかりません</p>
          {!currentUser && !getCurrentMapShare(id) && <p className="text-sm leading-relaxed">URL限定公開の場合は作成者から共有URLを受け取ってください。共有URLがあれば、ログインせずに閲覧できます。</p>}
          <HomeLink className="btn" />
          {!currentUser && (
            <div className="border-t border-line pt-4 sm:hidden">
              <p className="mb-3 text-sm leading-relaxed">自分の非公開マップは、ログインすると表示されます。</p>
              <AuthButton centered />
            </div>
          )}
        </div>
      </div>
    );
  }

  const backHref = map.folder_id
    ? `/folders/${map.folder_id}`
    : "/";

  const backLabel = map.folder_id
    ? "フォルダに戻る"
    : "マップ一覧に戻る";

  const folderById = new Map(
    mapOptionFolders.map((folder) => [folder.id, folder]),
  );

  function createMapOptionLabel(targetMap) {
    const folderNames = [];
    const visited = new Set();
    let folderId = targetMap.folder_id;

    while (folderId && !visited.has(folderId)) {
      visited.add(folderId);

      const targetFolder = folderById.get(folderId);
      if (!targetFolder) break;

      folderNames.unshift(targetFolder.name);
      folderId = targetFolder.parent_folder_id;
    }

    return ["ホーム", ...folderNames, targetMap.title].join(
      " / ",
    );
  }

  const destinationMapOptions = allMaps
    .filter((targetMap) => targetMap.id !== id && targetMap.is_destination_option)
    .map((targetMap) => ({
      ...targetMap,
      hierarchyLabel: createMapOptionLabel(targetMap),
    }))
    .sort((a, b) =>
      a.hierarchyLabel.localeCompare(b.hierarchyLabel, "ja"),
    );

  return (

    <div className="relative flex h-full min-w-0 bg-paper">
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <div className="relative z-40 border-b border-line bg-surface px-3 py-1 sm:px-4 sm:py-2">
          {/*
            パンくずリスト（広い画面だけ）．末尾の項目が「1つ上（フォルダまたはホーム）へ戻る」を兼ねるので，
            戻る矢印は置かない（矢印と末尾の項目が同じ場所へ移動する，重複したボタンになるため）．
            スマホでは地図を広く見せるためパンくずを出さず，代わりに戻る矢印だけを下のタイトルの行に置く．
          */}
          {/*
            マップがフォルダに入っていないときは，戻り先がホームだけなので「‹ ホーム」の戻るリンクにする．
            フォルダに入っているときは「ホーム › フォルダ」のパンくず．
          */}
          {breadcrumb.length === 0 ? (
            <HomeLink className="-ml-1 hidden rounded-md py-0.5 pl-0.5 pr-1.5 text-xs text-sub hover:bg-ink/5 hover:text-ink sm:inline-flex" />
          ) : (
            <Breadcrumb folders={breadcrumb} className="hidden min-w-0 py-0.5 text-xs text-sub sm:block" />
          )}
          {isEditingMap ? (
            <form onSubmit={handleUpdateMap} className="mt-1 max-w-2xl">
              <input
                type="text"
                aria-label="マップのタイトル"
                value={mapTitle}
                onChange={(e) => setMapTitle(e.target.value)}
                disabled={savingMap}
                maxLength={100}
                className="field font-bold"
              />
              <textarea
                aria-label="マップの説明"
                value={mapDescription}
                onChange={(e) => setMapDescription(e.target.value)}
                disabled={savingMap}
                maxLength={500}
                rows={2}
                placeholder="説明（任意）"
                className="field mt-2"
              />

              <MapVisibilitySelect id="editMapVisibility" value={mapVisibility} onChange={setMapVisibility} disabled={savingMap} />

              {mapError && (
                <p className="notice-error mt-2">
                  {mapError}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="submit"
                  disabled={savingMap || mapTitle.trim() === ""}
                  className="btn btn-primary"
                >
                  {savingMap ? "保存中..." : "保存"}
                </button>
                <button
                  type="button"
                  onClick={cancelEditingMap}
                  disabled={savingMap}
                  className="btn"
                >
                  キャンセル
                </button>
              </div>
            </form>
          ) : (
            <>
              {/*
                タイトルの行．スマホでは戻る・ハート・しおり・メニュー・アカウントのアイコンが並んで窮屈なので，
                アイコンだけのボタンの押せる範囲を一回り小さく（44px → 36px）し，間も詰めている．
                アイコンの大きさは変えない．広い画面はふだんどおり．
              */}
              <div className="flex min-w-0 items-center gap-0.5 max-sm:[&_.btn-icon]:size-9 sm:gap-1">
                {/* スマホ用の戻る矢印（広い画面では，上のパンくずの末尾の項目が戻る役を兼ねる） */}
                <Link
                  to={backHref}
                  aria-label={backLabel}
                  className="btn-icon -ml-2 sm:hidden"
                >
                  <Icon name="arrowLeft" className="size-5" />
                </Link>

                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <h2 className="min-w-0 truncate text-base font-bold text-ink sm:text-lg">
                    {map.title}
                  </h2>

                  {/* 公開範囲バッジ．スマホではタイトルの幅を確保するため，下の説明の行に出す */}
                  <span className={`tag max-sm:hidden ${map.is_public ? "" : "tag-private"}`}>
                    {getMapVisibilityLabel(map)}
                  </span>
                </div>

                {siblingMaps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSiblingMapsOpen((current) => !current)}
                    aria-expanded={siblingMapsOpen}
                    aria-label={`同じフォルダのマップ（${siblingMaps.length}件）`}
                    title="同じフォルダのマップ"
                    className={`btn btn-sm px-2.5 ${siblingMapsOpen ? "bg-ink/5" : ""}`}
                  >
                    <Icon name="folder" />
                    {siblingMaps.length}
                  </button>
                )}

                {/*
                  お気に入り（ハート）と，他の人のマップだけ自分の一覧への保存（しおり）．
                  どちらも一覧のカードと同じアイコンで，
                  押すたびに保存と解除が切り替わる（保存済みは塗りつぶし）．自分のマップでは何も表示されない．
                */}
                {currentUser && (
                  <button
                    type="button"
                    onClick={toggleFavorite}
                    disabled={isFavorited === null || savingFavorite}
                    aria-pressed={Boolean(isFavorited)}
                    aria-label={isFavorited ? "お気に入り解除" : "お気に入り登録"}
                    title={isFavorited ? "お気に入り解除" : "お気に入り登録"}
                    className={`btn-icon ${isFavorited ? "text-accent" : "text-line-strong hover:text-sub"}`}
                  >
                    <Icon name="heart" filled={Boolean(isFavorited)} className="size-5" />
                  </button>
                )}

                {currentUser && (
                  <SaveToMyListButton
                    itemType="map"
                    itemId={map.id}
                    ownerId={map.user_id}
                    currentUser={currentUser}
                    variant="icon"
                  />
                )}

                <ThreeDotMenu
                  label={`${map.title}の操作メニューを開く`}
                  isOpen={mapMenuOpen}
                  onToggle={() => setMapMenuOpen((current) => !current)}
                  onClose={() => setMapMenuOpen(false)}
                >
                  {currentVisibility !== "private" && <MenuItem icon={copied ? "check" : "link"} onClick={copyUrl}>
                    {copied ? "コピーしました" : "共有URLをコピー"}
                  </MenuItem>}

                  {canEditMap && (
                    <MenuItem
                      icon="edit"
                      onClick={() => {
                        setMapMenuOpen(false);
                        startEditingMap();
                      }}
                    >
                      編集
                    </MenuItem>
                  )}

                  {canEditAddressPins && (
                    <MenuItem
                      icon="pin"
                      onClick={() => {
                        setMapMenuOpen(false);
                        openLandmarkSettings();
                      }}
                    >
                      住所からピンを置く設定
                    </MenuItem>
                  )}

                  {canEditRatings && (
                    <MenuItem
                      icon={ratingEnabled ? "close" : "check"}
                      disabled={savingRatingSetting}
                      onClick={() => {
                        setMapMenuOpen(false);
                        handleToggleRatingEnabled();
                      }}
                    >
                      {ratingEnabled ? "ピンの評価を使わない" : "ピンの評価を使う"}
                    </MenuItem>
                  )}

                  {canEditMap && (
                    <MenuItem
                      icon="trash"
                      danger
                      disabled={savingMap}
                      onClick={() => {
                        setMapMenuOpen(false);
                        handleDeleteMap();
                      }}
                    >
                      削除
                    </MenuItem>
                  )}
                </ThreeDotMenu>

                {/* スマホでは共通ヘッダーを出さないので，ログイン・ログアウトをここに置く */}
                <div className="sm:hidden">
                  <AuthButton />
                </div>
              </div>

              {/*
                公開範囲と説明．スマホでは1行に収め，ピンのパネルを開いている間は
                地図の表示領域を優先して隠す．左の余白は，戻る矢印の分だけタイトルと揃えるためのもの．
              */}
              <div className={`flex min-w-0 items-center gap-2 pb-1 pl-10 sm:pb-0 sm:pl-0 ${selectedPin ? "max-sm:hidden" : ""}`}>
                <span className={`tag sm:hidden ${map.is_public ? "" : "tag-private"}`}>
                  {getMapVisibilityLabel(map)}
                </span>
                {map.description && (
                  <p className="line-clamp-1 min-w-0 break-words text-xs text-sub sm:line-clamp-2 sm:text-sm">{map.description}</p>
                )}
              </div>

              {mapError && (
                <p className="notice-error mt-2">
                  {mapError}
                </p>
              )}
            </>
          )}
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/*
            地図の上に重ねる操作．左に絞り込み，右にピン一覧．
            狭い画面で両方開くと重なるので，片方を開いたらもう片方は閉じる．
          */}
          <div className={`pointer-events-none absolute inset-x-3 top-3 z-30 items-start justify-between gap-2 ${selectedPin ? "hidden sm:flex" : "flex"}`}>
            <button
              type="button"
              onClick={() => {
                setFiltersOpen((current) => !current);
                setIsPinListOpen(false);
                setAddressPlacerOpen(false);
              }}
              aria-expanded={filtersOpen}
              aria-controls="map-filters"
              className={`btn pointer-events-auto shadow-sm ${filtersOpen ? "border-ink" : ""}`}
            >
              <Icon name="filter" />
              絞り込み
              {filtersActive && (
                <span className="size-2 rounded-full bg-accent">
                  <span className="sr-only">（絞り込み中）</span>
                </span>
              )}
            </button>

            <div className="flex items-start gap-2">
              {/* 住所からピンを置く（#25）．地図のマップと，有効にしてある画像のマップで，ログインしているときだけ出す */}
              {canPlaceByAddress && (
                <button
                  type="button"
                  onClick={() => {
                    setAddressPlacerOpen((open) => !open);
                    setFiltersOpen(false);
                    setIsPinListOpen(false);
                    setSelectedPin(null);
                    setIsEditingPin(false);
                  }}
                  aria-expanded={addressPlacerOpen}
                  className={`btn pointer-events-auto shadow-sm ${addressPlacerOpen ? "border-ink" : ""}`}
                >
                  <Icon name="search" />
                  住所から置く
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsPinListOpen((open) => !open);
                  setFiltersOpen(false);
                  setAddressPlacerOpen(false);
                }}
                aria-expanded={isPinListOpen}
                aria-controls="map-pin-list"
                className={`btn pointer-events-auto shadow-sm ${isPinListOpen ? "border-ink" : ""}`}
              >
                <Icon name="list" />
                ピン
                <span className="text-sub">{visiblePins.length}</span>
              </button>
            </div>
          </div>

          {canPlaceByAddress && addressPlacerOpen && !selectedPin && (
            <div className="pointer-events-none absolute inset-x-3 top-16 z-30 flex justify-end sm:top-14">
              <AddressPinPlacer
                // 地図のマップは変換しない（緯度経度をそのまま使う）ので渡さない
                transform={isTileMapOpen ? null : addressPinSetup}
                onPlace={handlePlaceByAddress}
                onClickInstead={handlePlaceByClickInstead}
                onClose={() => setAddressPlacerOpen(false)}
              />
            </div>
          )}

          {filtersOpen && (
            <div
              id="map-filters"
              // スマホでは地図に重ねず，地図の下に並べる（max-sm:order-last）．
              // 重ねると地図が隠れて，絞り込んだ結果を見ながら選べないため．広い画面では左上に浮かべる．
              // スマホでピンのパネルが開いている間は，地図が狭くなりすぎないよう一時的に引っ込める．
              className={`relative z-30 max-h-[60%] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-t border-line bg-surface p-3 max-sm:order-last sm:absolute sm:left-3 sm:top-14 sm:max-h-[calc(100%-5rem)] sm:w-72 sm:space-y-4 sm:rounded-xl sm:border sm:shadow-lg ${selectedPin ? "max-sm:hidden" : ""}`}
            >
              <label className="block">
                <span className="block text-xs font-bold text-sub">
                  タイトルで検索
                </span>

                <input
                  type="search"
                  placeholder="ピンのタイトル"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="field mt-1"
                />
              </label>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-sub">
                    表示する種類
                  </span>

                  <span className="flex items-center text-xs">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="rounded px-2 py-2 text-accent-strong hover:underline"
                    >
                      すべて表示
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="rounded px-2 py-2 text-accent-strong hover:underline"
                    >
                      すべて隠す
                    </button>
                  </span>
                </div>

                {/* スマホは横幅いっぱいを使えるので，縦に積まず横に流して高さを抑える */}
                <div className="flex flex-wrap gap-x-5 sm:grid sm:grid-cols-2 sm:gap-x-2">
                  {availablePinTypes.map((type) => (
                    <label
                      key={type.value}
                      className="flex min-h-10 min-w-0 max-w-full cursor-pointer items-center gap-2 text-sm text-ink sm:min-h-8"
                    >
                      <input
                        type="checkbox"
                        checked={isTypeEnabled(type.value)}
                        onChange={() => handleTypeToggle(type.value)}
                        className="size-4 shrink-0 accent-accent"
                      />

                      <span className="min-w-0 truncate">
                        {type.isCustom
                          ? type.label
                          : `${type.emoji} ${type.label}`}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* カテゴリ（何の場所か）．このマップで使われているものだけを出す． */}
              {(usedCategories.length > 0 || categoryFilterActive) && (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-sub">
                      表示するカテゴリ
                    </span>
                    <span className="flex items-center text-xs">
                      <button
                        type="button"
                        onClick={() => setHiddenCategoryKeys(new Set())}
                        className="rounded px-2 py-2 text-accent-strong hover:underline"
                      >
                        すべて表示
                      </button>
                    </span>
                  </div>

                  <ul className="space-y-0.5">
                    {usedCategories.map((category) => {
                      const categoryHidden = hiddenCategoryKeys.has(category.value);
                      const visibleCount = categoryHidden ? 0 : category.subcategories.filter((subcategory) =>
                        !hiddenCategoryKeys.has(subcategoryFilterKey(category.value, subcategory.value)),
                      ).length;
                      const canExpand = category.subcategories.some((subcategory) =>
                        subcategory.value !== null,
                      );
                      const expanded = canExpand && expandedCategories.has(category.value);
                      const subListId = `filter-subcategories-${category.value}`;

                      return (
                        <li key={category.value}>
                          <div className="flex items-center gap-1">
                            <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-ink sm:min-h-8">
                              <input
                                type="checkbox"
                                checked={visibleCount > 0}
                                // 一部のサブカテゴリだけ隠しているときは「一部だけ表示」の印（−）にする
                                ref={(element) => {
                                  if (element) element.indeterminate = visibleCount > 0 && visibleCount < category.subcategories.length;
                                }}
                                onChange={(event) => handleCategoryToggle(category.value, event.target.checked)}
                                className="size-4 shrink-0 accent-accent"
                              />
                              <span className="min-w-0 truncate">
                                {category.emoji} {category.label}
                              </span>
                            </label>

                            {canExpand && (
                              <button
                                type="button"
                                onClick={() => setExpandedCategories((current) => toggleHiddenKey(current, category.value))}
                                aria-expanded={expanded}
                                aria-controls={subListId}
                                aria-label={`${category.label}の種類で絞り込む`}
                                className="btn-icon"
                              >
                                <Icon name={expanded ? "chevronUp" : "chevronDown"} className="size-4" />
                              </button>
                            )}
                          </div>

                          {expanded && (
                            <div id={subListId} className="mb-1 ml-6 flex flex-wrap gap-x-4">
                              {category.subcategories.map((subcategory) => (
                                <label
                                  key={subcategoryFilterKey(category.value, subcategory.value)}
                                  className="flex min-h-10 min-w-0 max-w-full cursor-pointer items-center gap-2 text-sm text-ink sm:min-h-8"
                                >
                                  <input
                                    type="checkbox"
                                    checked={
                                      !categoryHidden &&
                                      !hiddenCategoryKeys.has(subcategoryFilterKey(category.value, subcategory.value))
                                    }
                                    onChange={() => setHiddenCategoryKeys((current) =>
                                      togglePinSubcategoryFilter(current, category.value, subcategory.value),
                                    )}
                                    className="size-4 shrink-0 accent-accent"
                                  />
                                  <span className="min-w-0 truncate">{subcategory.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}

                    {hasUncategorizedPins && (
                      <li>
                        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink sm:min-h-8">
                          <input
                            type="checkbox"
                            checked={!hiddenCategoryKeys.has(NO_CATEGORY_FILTER)}
                            onChange={() => setHiddenCategoryKeys((current) => toggleHiddenKey(current, NO_CATEGORY_FILTER))}
                            className="size-4 shrink-0 accent-accent"
                          />
                          <span>カテゴリなし</span>
                        </label>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {currentUser && (
                <label className="flex min-h-10 cursor-pointer items-center gap-2 border-t border-line pt-2 text-sm text-ink sm:min-h-8">
                  <input
                    type="checkbox"
                    checked={showOnlyMyPins}
                    onChange={(e) => setShowOnlyMyPins(e.target.checked)}
                    className="size-4 shrink-0 accent-accent"
                  />
                  <span>自分のピンだけ表示</span>
                </label>
              )}
            </div>
          )}

          {isPinListOpen && (
            <aside
              id="map-pin-list"
              aria-label="ピン一覧"
              className={`absolute right-3 top-16 z-30 flex max-h-[calc(100%-5rem)] w-64 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:top-14 ${selectedPin ? "max-sm:hidden" : ""}`}
            >
              {visiblePins.length > 0 ? (
                // アイコンの列は，一覧の中でいちばん幅の広いアイコンに合わせて広がる（自由入力は4文字まで入るため）．
                // 各行を subgrid にして列を共有しているので，アイコンの幅が違ってもタイトルの書き出しは揃う．
                <ul className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)] content-start overflow-y-auto overscroll-contain p-1">
                  {visiblePins.map((pin) => (
                    <li key={pin.id} className="col-span-2 grid grid-cols-subgrid">
                      <button
                        type="button"
                        onClick={() => handlePinListClick(pin)}
                        className={`col-span-2 grid min-h-11 w-full min-w-0 grid-cols-subgrid items-center gap-x-2 rounded-lg px-2.5 text-left text-sm sm:min-h-9 ${selectedPin?.id === pin.id
                          ? "bg-accent-soft font-bold text-accent-strong"
                          : "text-ink hover:bg-ink/5"
                          }`}
                      >
                        <span className="grid min-w-5 place-items-center whitespace-nowrap" aria-hidden="true">
                          {pin.kind === "button"
                            ? <Icon name="arrowRight" className="size-4 text-sub" />
                            : getPinEmoji(pin.pin_type)}
                        </span>

                        <span className="min-w-0 py-1">
                          <span className="block truncate">{pin.title}</span>
                          {pin.kind !== "button" && (formatPinCategory(pin) || (ratingEnabled && formatRatingAverage(pin))) && (
                            <span className="block truncate text-xs font-normal text-sub">
                              {[
                                formatPinCategory(pin),
                                ratingEnabled && formatRatingAverage(pin) ? `⭐${formatRatingAverage(pin)}` : null,
                              ].filter(Boolean).join("　")}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-4 text-center text-xs text-sub">
                  {filtersActive ? "絞り込みに一致するピンがありません" : "ピンはまだありません"}
                </p>
              )}
            </aside>
          )}
          {/* 地図は残りの高さをすべて使う．スマホで下に絞り込みが並ぶと，その分だけ縮む． */}
          <div className="relative min-h-0 min-w-0 flex-1">
            {isTileMap(map) ? (
              // 地図のマップ．Leaflet は開いたときにだけ読み込む（読み込み中は「読み込み中」を出す）
              <Suspense fallback={<Loading />}>
                <TileMapView
                  // マップを切り替えたときに表示位置をそのマップの最初の位置に戻すため，作り直す．
                  key={map.id}
                  map={map}
                  pins={displayPins}
              pinLabel={pinHoverLabel}
                  pendingPin={
                    selectedPin && !selectedPin.id
                      ? { ...selectedPin, ...pendingPinAppearance }
                      : null
                  }
                  selectedPinId={selectedPin?.id ?? null}
                  onPinClick={handlePinClick}
                  onPinDoubleClick={handlePinDoubleClick}
                  onMapClick={isEditingPin || !currentUser ? undefined : handleMapClick}
                  movablePinId={isEditingPin ? selectedPin?.id : null}
                  onPinMove={handleMovePin}
                  // 追加前の仮のピンは，ドラッグで位置を調整できる（住所から置いたときの微調整など．#25）
                  onPendingPinMove={handlePendingPinMove}
                  dense={Boolean(selectedPin)}
                />
              </Suspense>
            ) : (
            <MapView
              // マップを切り替えたときにズーム倍率(scale)をリセットするため，
              // マップごとに別インスタンスとして作り直す．
              key={map.id}
              map={map}
              pins={displayPins}
              pinLabel={pinHoverLabel}
              pendingPin={
                selectedPin && !selectedPin.id
                  ? { ...selectedPin, ...pendingPinAppearance }
                  : null
              }
              // 詳細パネルで開いているピンをマップ上でも強調する（新規ピンは id が無いので対象外）
              selectedPinId={selectedPin?.id ?? null}
              onPinClick={handlePinClick}
              onPinDoubleClick={handlePinDoubleClick}
              // 未ログインではピンを作れないので，地図を押しても何も起こさない．
              // （スクロールしようとして触れるたびに「ログインしてください」と出るのを防ぐ）
              // 画像のマップは位置を (x, y) の2つで渡してくるので，{ x, y } にまとめる．
              onMapClick={isEditingPin || !currentUser ? undefined : (x, y) => handleMapClick({ x, y })}
              movablePinId={isEditingPin ? selectedPin?.id : null}
              onPinMove={(x, y) => handleMovePin({ x, y })}
              // 追加前の仮のピンは，ドラッグで位置を調整できる（住所から置いたときの微調整など．#25）
              onPendingPinMove={(x, y) => handlePendingPinMove({ x, y })}
              // 「住所からピンを置く設定」を開いている間は，目印（と，いま選んでいる点）を表示する
              landmarks={landmarkSettings
                ? [...landmarkSettings.landmarks, ...(landmarkSettings.point ? [landmarkSettings.point] : [])]
                : []}
              dense={Boolean(selectedPin || landmarkSettings)}
            />
            )}
          </div>
        </div>

        {landmarkSettings && (
          <AddressPinSettingsPanel
            settings={landmarkSettings}
            onChange={setLandmarkSettings}
            onSave={handleSaveLandmarks}
            onClose={closeLandmarkSettings}
            saving={savingLandmarks}
            error={landmarkError}
          />
        )}

        {selectedPin && !landmarkSettings && (
          <PinPanel
            pin={selectedPin}
            focusedCommentId={String(selectedPin.id) === requestedPinId ? requestedCommentId : null}
            onFocusedCommentDeleted={clearDeletedCommentLink}
            currentUser={currentUser}
            isAdmin={isAdmin}
            canManagePin={canManageContent(selectedPin, currentUser?.id, isAdmin)}
            saving={savingPin}
            error={pinError}
            mapOptions={destinationMapOptions}
            readableMaps={allMaps}
            onSave={handleSavePin}
            onClose={closePanel}
            onNavigate={handleNavigateToMap}
            onUpdate={handleUpdatePin}
            onDelete={handleDeletePin}
            onPreviewChange={setPendingPinAppearance}
            isEditing={isEditingPin}
            onEditStart={startEditingPin}
            onEditCancel={cancelEditingPin}
            ratingEnabled={ratingEnabled}
            myRating={ratingEnabled ? myRatings.get(selectedPin.id) ?? null : null}
            onRate={(rating) => handleRatePin(selectedPin.id, rating)}
            ratingSaving={ratingSavingPinId !== null && ratingSavingPinId === selectedPin.id}
          />
        )}
        {requestedPinMissing && (
          <p role="status" className="absolute inset-x-4 bottom-4 z-10 rounded-lg border border-line bg-surface p-3 text-sm text-ink shadow-lg">
            リンク先のピンを開けませんでした。
          </p>
        )}
      </div>
      {/* 同じフォルダの閲覧可能なマップへの切り替え */}
      {siblingMapsOpen && siblingMaps.length > 0 && (
        <>
          {/* スマホでは一覧の外側を押しても閉じられるようにする */}
          <button
            type="button"
            aria-label="フォルダ内マップの一覧を閉じる"
            onClick={() => setSiblingMapsOpen(false)}
            className="absolute inset-0 z-40 cursor-default bg-black/30 sm:hidden"
          />

          <aside className="absolute inset-y-0 right-0 z-40 w-64 max-w-[85vw] overflow-auto overscroll-contain border-l border-line bg-surface p-3 shadow-xl sm:static sm:z-auto sm:w-52 sm:shrink-0 sm:shadow-none">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-sub">
                同じフォルダのマップ
              </p>

              <button
                type="button"
                onClick={() => setSiblingMapsOpen(false)}
                aria-label="フォルダ内マップの一覧を閉じる"
                className="btn-icon -mr-1.5"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>

            <ul className="mt-1 space-y-0.5">
              {siblingMaps.map((sibling) => {
                const isActive = sibling.id === map.id;

                return (
                  <li key={sibling.id}>
                    <Link
                      to={`/maps/${sibling.id}`}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-sm sm:min-h-9 ${isActive
                        ? "bg-ink/5 font-bold text-ink"
                        : "text-sub hover:bg-ink/5 hover:text-ink"
                        }`}
                    >
                      <span className="truncate">{sibling.title}</span>

                      {/* 公開範囲バッジ */}
                      <span className={`tag ${sibling.is_public ? "" : "tag-private"}`}>
                        {getMapVisibilityLabel(sibling)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
        </>
      )}
    </div>
  );
}
