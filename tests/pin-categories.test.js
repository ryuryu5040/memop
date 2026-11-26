import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  NO_CATEGORY_FILTER,
  PIN_CATEGORIES,
  formatPinCategory,
  isPinCategoryHidden,
  subcategoryFilterKey,
  togglePinSubcategoryFilter,
} from "../src/lib/pinCategories.js";

// 実データを使わず，pins テーブルに今回の SQL だけを当てて確かめる．
const db = new PGlite();
const sql = (path) => readFile(new URL(path, import.meta.url), "utf8");

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.pins (id serial primary key, title text not null default '');
  `);
  await db.exec(await sql("../supabase/migrations/20261126000000_pin_categories.sql"));
});
after(() => db.close());

async function canSave(category, subcategory) {
  try {
    await db.query("insert into public.pins(category, subcategory) values ($1, $2)", [category, subcategory]);
    return true;
  } catch (error) {
    if (error.code === "23514") return false; // check 制約違反
    throw error;
  }
}

test("アプリの一覧にあるカテゴリとサブカテゴリは，すべて保存できる", async () => {
  assert.equal(await canSave(null, null), true, "カテゴリなし");
  for (const category of PIN_CATEGORIES) {
    assert.equal(await canSave(category.value, null), true, category.value);
    for (const subcategory of category.subcategories) {
      assert.equal(await canSave(category.value, subcategory.value), true, `${category.value}:${subcategory.value}`);
    }
  }
});

test("一覧にない値や，カテゴリと合わないサブカテゴリは保存できない", async () => {
  assert.equal(await canSave("unknown", null), false, "一覧にないカテゴリ");
  assert.equal(await canSave(null, "ramen"), false, "サブカテゴリだけ");
  assert.equal(await canSave("nature", "ramen"), false, "別カテゴリのサブカテゴリ");
  assert.equal(await canSave("food", "unknown"), false, "一覧にないサブカテゴリ");
});

test("値の重複がなく，DB に保存する値として使える文字だけでできている", () => {
  const categoryValues = PIN_CATEGORIES.map((category) => category.value);
  assert.equal(new Set(categoryValues).size, categoryValues.length);
  for (const category of PIN_CATEGORIES) {
    const values = category.subcategories.map((subcategory) => subcategory.value);
    assert.equal(new Set(values).size, values.length, category.value);
    for (const value of [category.value, ...values]) assert.match(value, /^[a-z_]+$/);
  }
});

test("ピンのカテゴリを表示用の文字にする", () => {
  assert.equal(formatPinCategory({ category: "food", subcategory: "ramen" }), "🍽️ 食事 › ラーメン");
  assert.equal(formatPinCategory({ category: "food", subcategory: null }), "🍽️ 食事");
  assert.equal(formatPinCategory({ category: null }), null);
});

test("絞り込みで隠したカテゴリ・サブカテゴリのピンだけを隠す", () => {
  const ramen = { category: "food", subcategory: "ramen" };
  const foodOnly = { category: "food", subcategory: null };
  const none = { category: null, subcategory: null };

  assert.equal(isPinCategoryHidden(ramen, new Set()), false);
  assert.equal(isPinCategoryHidden(ramen, new Set(["food"])), true);
  assert.equal(isPinCategoryHidden(ramen, new Set([subcategoryFilterKey("food", "ramen")])), true);
  assert.equal(isPinCategoryHidden(foodOnly, new Set([subcategoryFilterKey("food", "ramen")])), false);
  assert.equal(isPinCategoryHidden(none, new Set(["food"])), false);
  assert.equal(isPinCategoryHidden(none, new Set([NO_CATEGORY_FILTER])), true);
});

test("非表示のカテゴリからサブカテゴリを選ぶと，そのピンだけ表示に戻る", () => {
  const ramen = { category: "food", subcategory: "ramen" };
  const cafe = { category: "food", subcategory: "cafe" };
  const foodOnly = { category: "food", subcategory: null };
  const shopping = { category: "shopping", subcategory: null };
  const otherCategory = { category: "nature", subcategory: "park" };
  const keys = new Set([subcategoryFilterKey("food", "ramen"), "food", "shopping"]);

  const withRamen = togglePinSubcategoryFilter(keys, "food", "ramen");
  assert.deepEqual(
    [ramen, cafe, foodOnly, shopping, otherCategory].filter((pin) => !isPinCategoryHidden(pin, withRamen)),
    [ramen, otherCategory],
  );

  const withUnspecified = togglePinSubcategoryFilter(withRamen, "food", null);
  assert.equal(isPinCategoryHidden(foodOnly, withUnspecified), false);
});
