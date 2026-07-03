import type { GameState, Player } from "./types";
import { CITIES } from "./data";

/** ゲーム全体で共有する状態(セッション開始時に main.ts が再初期化する) */
export const S: GameState = {
  players: [],
  turn: 0,
  monthIdx: 0,
  years: 3,
  dest: -1,
  arrivals: 0,
  bonbi: { holder: -1, form: "normal", turns: 0 },
  drops: {},
  over: false,
  speed: 1,
  propOwner: [],
};

export const yearOf = (): number => Math.floor(S.monthIdx / 12) + 1;
export const monthOf = (): number => ((S.monthIdx + 3) % 12) + 1;
export const yearMult = (): number => 1 + 0.6 * (yearOf() - 1);

export const rnd = (n: number): number => Math.floor(Math.random() * n);
export const pick = <T>(a: T[]): T => a[rnd(a.length)];
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms * S.speed));

/** m は「万」単位 */
export function fmtMoney(m: number): string {
  const neg = m < 0;
  m = Math.round(Math.abs(m));
  const oku = Math.floor(m / 10000), man = m % 10000;
  const s = oku > 0 ? (man > 0 ? `${oku}億${man}万円` : `${oku}億円`) : `${man}万円`;
  return neg ? `▲${s}` : s;
}

export function propOwners(ci: number): number[] {
  return CITIES[ci][3].map((_, pi) => S.propOwner[ci][pi]);
}

export function isMonopoly(ci: number, pl: number): boolean {
  return propOwners(ci).every((o) => o === pl);
}

export function cityIncome(ci: number, pl: number): number {
  let inc = 0;
  const mono = isMonopoly(ci, pl);
  CITIES[ci][3].forEach((p, pi) => {
    if (S.propOwner[ci][pi] === pl) inc += (p[1] * p[2]) / 100 * (mono ? 2 : 1);
  });
  return Math.round(inc);
}

export function playerIncome(pl: number): number {
  let t = 0;
  for (let ci = 0; ci < CITIES.length; ci++) t += cityIncome(ci, pl);
  return t;
}

export function propValue(pl: number): number {
  let t = 0;
  for (let ci = 0; ci < CITIES.length; ci++) {
    CITIES[ci][3].forEach((p, pi) => { if (S.propOwner[ci][pi] === pl) t += p[1]; });
  }
  return t;
}

export function totalAssets(p: Player): number {
  return p.cash + propValue(p.i);
}

export function currentPrize(): number {
  return Math.round((1000 + 600 * S.arrivals) * yearMult());
}
