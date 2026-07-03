/** 物件1件ぶんのデータ:[名前, 価格(万円), 収益率(%)] */
export type PropertyTuple = [name: string, price: number, yieldPct: number];

/** 都市1件ぶんのデータ:[名前, 経度, 緯度, 物件一覧] */
export type CityTuple = [name: string, lon: number, lat: number, properties: PropertyTuple[]];

/** 路線1本ぶんのデータ:[都市A, 都市B, 中間マス数, 海路フラグ(省略可)] */
export type EdgeTuple = [cityA: string, cityB: string, midCount: number, sea?: number];

/** 海岸線ポリゴンの1点:[経度, 緯度] */
export type CoastPoint = [lon: number, lat: number];

export type SquareKind = "blue" | "red" | "card" | "lotto" | "warp";

export interface CityNode {
  type: "city";
  name: string;
  x: number;
  y: number;
  /** CITIES配列内でのインデックス */
  ci: number;
  /** 駅名標の幅(px) */
  pw: number;
}

export interface SquareNode {
  type: SquareKind;
  x: number;
  y: number;
  sea: boolean;
}

export type GraphNode = CityNode | SquareNode;

export interface EdgeLine {
  chain: number[];
  sea: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  adj: number[][];
  cityIdx: Record<string, number>;
  edgeLines: EdgeLine[];
}

export type CardId =
  | "kyuko" | "tokkyu" | "nozomi"
  | "buttobi" | "ohara" | "gosoku"
  | "shield" | "fuku" | "ushiho";

export type CardKind = "move" | "warp" | "ohara" | "throw" | "passive" | "money" | "slow";

export interface CardDef {
  n: string;
  d: string;
  kind: CardKind;
  w: number;
  dice?: number;
}

export type BonbiForm = "normal" | "king" | "pokon" | "big" | "destroy";

export interface BonbiState {
  holder: number;
  form: BonbiForm;
  turns: number;
}

export interface PropRef {
  ci: number;
  pi: number;
  pr: PropertyTuple;
}

export interface DropItem {
  card?: CardId;
  prop?: PropRef;
}

export interface Player {
  i: number;
  name: string;
  human: boolean;
  color: string;
  cash: number;
  cards: CardId[];
  pos: number;
  prev: number;
  slow: number;
}

export interface GameState {
  players: Player[];
  turn: number;
  monthIdx: number;
  years: number;
  dest: number;
  arrivals: number;
  bonbi: BonbiState;
  drops: Record<number, DropItem[]>;
  over: boolean;
  speed: number;
  propOwner: number[][];
}

export interface HeroDef {
  n: string;
  msg: string;
  f: (p: Player) => Promise<void>;
}

export type PlayerAction = { kind: "roll" } | { kind: "card"; idx: number };

export type UseCardResult = { dice: number } | { done: true } | null;

export interface ModalButton<T = unknown> {
  label: string;
  value: T;
  primary?: boolean;
}

export interface ModalOptions {
  title: string;
  html?: string;
  buttons?: ModalButton[];
  headKlass?: string;
}
