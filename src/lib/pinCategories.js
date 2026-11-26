/**
 * ピンのカテゴリ（何の場所か）とサブカテゴリの一覧．
 *
 * ピンの「種類」（lib/pinTypes.js．地図上の絵文字を決める）とは別の項目．
 * 種類は「おすすめ」「注意」のような気持ち・印，カテゴリは「食事」「公園」のような場所の分類を表す．
 *
 * カテゴリもサブカテゴリも選ばなくてよい（null）．
 * サブカテゴリは，そのカテゴリに属するものだけを選べる．
 *
 * 一覧を変えるときは，Supabase 側で保存できる値も同じにそろえる
 * （supabase/migrations/20261126000000_pin_categories.sql の check 制約）．
 * npm test で，ここの一覧と SQL の制約が一致しているかを確認している．
 *
 * value は DB に保存する値なので，一度使い始めたら変えない（表示名の label は変えてよい）．
 * 食事のサブカテゴリは食べログのジャンル分けを参考にした名前だが，食べログのデータは取り込んでいない．
 */
export const PIN_CATEGORIES = [
  {
    value: "food",
    label: "食事",
    emoji: "🍽️",
    subcategories: [
      { value: "japanese", label: "和食" },
      { value: "sushi_seafood", label: "寿司・海鮮" },
      { value: "soba_udon", label: "そば・うどん" },
      { value: "ramen", label: "ラーメン" },
      { value: "yakiniku_steak", label: "焼肉・ステーキ" },
      { value: "western", label: "洋食・イタリアン・フレンチ" },
      { value: "chinese", label: "中華" },
      { value: "asian_ethnic", label: "アジア・エスニック" },
      { value: "curry", label: "カレー" },
      { value: "izakaya_bar", label: "居酒屋・バー" },
      { value: "cafe", label: "カフェ・喫茶" },
      { value: "sweets_bakery", label: "スイーツ・パン" },
      { value: "fast_food", label: "ファストフード" },
    ],
  },
  {
    value: "shopping",
    label: "買い物",
    emoji: "🛍️",
    subcategories: [
      { value: "grocery", label: "スーパー・コンビニ" },
      { value: "goods_interior", label: "雑貨・インテリア" },
      { value: "fashion", label: "服・ファッション" },
      { value: "books_stationery", label: "本・文具" },
      { value: "souvenir", label: "お土産" },
      { value: "drugstore", label: "ドラッグストア" },
    ],
  },
  {
    value: "nature",
    label: "自然",
    emoji: "🌳",
    subcategories: [
      { value: "park", label: "公園" },
      { value: "mountain_hiking", label: "山・ハイキング" },
      { value: "waterside", label: "海・川・湖" },
      { value: "flowers_foliage", label: "花・紅葉の名所" },
      { value: "scenery", label: "景色・展望" },
    ],
  },
  {
    value: "sightseeing",
    label: "遊ぶ・観光",
    emoji: "🎡",
    subcategories: [
      { value: "landmark", label: "観光名所" },
      { value: "shrine_temple", label: "神社・お寺" },
      { value: "museum", label: "美術館・博物館" },
      { value: "amusement", label: "遊園地・レジャー" },
      { value: "movie_live", label: "映画・ライブ" },
    ],
  },
  {
    value: "stay",
    label: "泊まる",
    emoji: "🏨",
    subcategories: [
      { value: "hotel_ryokan", label: "ホテル・旅館" },
    ],
  },
  {
    value: "transport",
    label: "交通",
    emoji: "🚉",
    subcategories: [
      { value: "station_bus_stop", label: "駅・バス停" },
      { value: "parking", label: "駐車場" },
    ],
  },
  {
    value: "life",
    label: "生活",
    emoji: "🏠",
    subcategories: [
      { value: "hospital", label: "病院" },
      { value: "city_office", label: "役所" },
      { value: "bank_post", label: "銀行・郵便局" },
      { value: "toilet", label: "トイレ" },
      { value: "other", label: "その他" },
    ],
  },
];

const CATEGORY_BY_VALUE = new Map(
  PIN_CATEGORIES.map((category) => [category.value, category]),
);

/** カテゴリの値から定義を返す．未設定や一覧にない値なら null */
export function getPinCategory(value) {
  return CATEGORY_BY_VALUE.get(value) ?? null;
}

/** カテゴリとサブカテゴリの値から，サブカテゴリの定義を返す．組み合わせが正しくなければ null */
export function getPinSubcategory(categoryValue, subcategoryValue) {
  return getPinCategory(categoryValue)?.subcategories
    .find((subcategory) => subcategory.value === subcategoryValue) ?? null;
}

/**
 * ピンのカテゴリを「🍽️ 食事 › ラーメン」のような表示用の文字にする．
 * カテゴリが無いピンは null を返す（何も表示しない）．
 */
export function formatPinCategory(pin) {
  const category = getPinCategory(pin?.category);
  if (!category) return null;
  const subcategory = getPinSubcategory(pin.category, pin.subcategory);
  return subcategory
    ? `${category.emoji} ${category.label} › ${subcategory.label}`
    : `${category.emoji} ${category.label}`;
}

/**
 * 絞り込みで使う鍵．カテゴリは "food"，サブカテゴリは "food:ramen" のように表す．
 * カテゴリの無いピンは NO_CATEGORY_FILTER でまとめて切り替える．
 */
export const NO_CATEGORY_FILTER = "__none__";
export function subcategoryFilterKey(categoryValue, subcategoryValue) {
  return `${categoryValue}:${subcategoryValue}`;
}

/**
 * 絞り込みで隠しているカテゴリ（hiddenKeys）に，このピンが当てはまるか．
 * カテゴリごと隠しているか，そのサブカテゴリを隠しているときに true．
 */
export function isPinCategoryHidden(pin, hiddenKeys) {
  const category = getPinCategory(pin?.category);
  if (!category) return hiddenKeys.has(NO_CATEGORY_FILTER);
  if (hiddenKeys.has(category.value)) return true;
  return Boolean(pin.subcategory)
    && hiddenKeys.has(subcategoryFilterKey(category.value, pin.subcategory));
}

export const PIN_CATEGORY_UNAVAILABLE_MESSAGE =
  "カテゴリの保存は現在利用できません。カテゴリを「なし」にすると保存できます。運営担当者にお問い合わせください。";

/** Supabase に category / subcategory 列がまだ無い（SQL 未適用の）ときのエラーか */
export function isPinCategoryColumnMissingError(error) {
  return Boolean(error)
    && (error.code === "PGRST204" || error.code === "42703")
    && /\b(sub)?category\b/.test(String(error.message ?? ""));
}
