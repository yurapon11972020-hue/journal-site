import type { CSSProperties } from 'react';

/**
 * Новогодние украшения поверх страницы: гирлянда по верхнему краю и снег.
 *
 * Разметка одинаковая на сервере и в браузере, а видна она только пока на
 * <html> стоит data-holiday="on" (см. lib/holiday): включает и выключает
 * украшения CSS, поэтому им не нужен свой скрипт. Нажатия они не ловят,
 * экранные дикторы их не читают.
 */

/** Лампочки через каждые 48 px: хватает на экран шириной 2688 px, лишнее обрезается. */
const BULBS = 56;
const FLAKES = 36;

/** Простой генератор с зерном: снежинки каждый раз раскладываются одинаково. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

interface Flake {
  star: boolean;
  fall: CSSProperties;
  body: CSSProperties;
}

const FLAKE_LIST: Flake[] = (() => {
  const random = seeded(2027);

  return Array.from({ length: FLAKES }, (_, index) => {
    // Каждая пятая — снежинка с лучами, остальные — круглые хлопья.
    const star = index % 5 === 0;
    const size = star ? 10 + random() * 6 : 3 + random() * 3.5;
    const fallSeconds = 11 + random() * 10;

    return {
      star,
      fall: {
        left: `${round(random() * 100)}%`,
        animationDuration: `${round(fallSeconds)}s`,
        // Отрицательная задержка: снег уже идёт, когда страница открылась.
        animationDelay: `${round(-random() * fallSeconds)}s`,
      },
      body: {
        width: `${round(size)}px`,
        height: `${round(size)}px`,
        opacity: round(0.55 + random() * 0.4),
        animationDuration: `${round(2.5 + random() * 3)}s`,
      },
    };
  });
})();

export default function HolidayDecor() {
  return (
    <div className="xmas" aria-hidden="true">
      <div className="xmas-snow">
        {FLAKE_LIST.map((flake, index) => (
          <span className="xmas-flake" style={flake.fall} key={index}>
            <span className={`xmas-flake__body${flake.star ? ' xmas-flake__body--star' : ''}`} style={flake.body} />
          </span>
        ))}
      </div>

      <div className="xmas-garland">
        <span className="xmas-garland__wire" />
        <span className="xmas-garland__bulbs">
          {Array.from({ length: BULBS }, (_, index) => (
            <span className="xmas-bulb" key={index} />
          ))}
        </span>
      </div>
    </div>
  );
}
