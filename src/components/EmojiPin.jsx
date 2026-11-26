const PIN_SIZES = {
  sm: {
    body: "h-8 min-w-8 max-w-28 px-1.5 text-base",
    tail: "-mt-1.5 h-3 w-3",
  },
  md: {
    body: "h-10 min-w-10 max-w-32 px-2 text-xl",
    tail: "-mt-2 h-4 w-4",
  },
  lg: {
    body: "h-12 min-w-12 max-w-36 px-2.5 text-2xl",
    tail: "-mt-2.5 h-5 w-5",
  },
};

/**
 * badge は，ピンの右上に小さく重ねる絵文字（カテゴリ．lib/pinCategories.js）．
 * 本体の絵文字（種類）は変えずに，何の場所かを見分けられるようにする．
 */
export function EmojiPin({
  emoji,
  badge = null,
  preview = false,
  selected = false,
  size = "sm",
}) {
  const sizeClasses = PIN_SIZES[size] ?? PIN_SIZES.sm;
  // 空文字も未指定と同じ扱いにする（見えないピンになるのを防ぐ）
  const text = String(emoji || "📍");
  // 選択中は色だけでなく，外側の太い枠（白い隙間つき）でも見分けられるようにする
  const borderClasses = selected ? "border-accent" : "border-ink/70";

  return (
    <span
      className={`relative flex flex-col items-center ${
        preview ? "opacity-70" : ""
      }`}
    >
      {/* 本体は overflow-hidden なので，バッジは本体の外（外側の枠）に重ねる */}
      {badge && (
        <span
          aria-hidden="true"
          className="absolute -right-2 -top-2 z-20 flex size-5 items-center justify-center rounded-full border border-ink/40 bg-white text-[0.7rem] leading-none shadow-sm"
        >
          {badge}
        </span>
      )}
      <span
        className={`
          relative z-10 flex w-max items-center justify-center
          overflow-hidden whitespace-nowrap
          rounded-lg border-2 ${borderClasses}
          bg-white font-bold text-ink
          ${selected ? "shadow-lg ring-4 ring-accent ring-offset-2 ring-offset-white" : "shadow-md"}
          ${sizeClasses.body}
        `}
      >
        {/*
          行の高さは文字より広く取る（leading-normal）．
          絵文字は文字の枠より少し上にはみ出して描かれるので，行の高さを文字ぴったり（leading-none）にすると，
          truncate のはみ出し隠しで絵文字の上が切れてしまう．枠の中で中央に置かれるので，位置は変わらない．
        */}
        <span className="max-w-full truncate leading-normal">
          {text}
        </span>
      </span>

      <span
        className={`
          rotate-45 border-r-2 border-b-2
          ${borderClasses} bg-white shadow-sm
          ${sizeClasses.tail}
        `}
      />
    </span>
  );
}