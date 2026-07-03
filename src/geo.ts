import type { Graph, GraphNode, SquareKind } from "./types";
import { CITIES, EDGES, COAST } from "./data";

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 経度・緯度 → 平面座標への投影 */
export const PRJX = (lon: number): number => (lon - 126.8) * 76;
export const PRJY = (lat: number): number => (46.0 - lat) * 90;

/** 俯瞰(2.5D)用にY軸を圧縮して描画するための係数と変換 */
export const FLAT = 0.6;
export const FY = (y: number): number => y * FLAT;

function buildGraph(): Graph {
  const rng = mulberry32(20260703);
  const nodes: GraphNode[] = [];
  const adj: number[][] = [];
  const cityIdx: Record<string, number> = {};

  CITIES.forEach((c, i) => {
    cityIdx[c[0]] = nodes.length;
    nodes.push({ type: "city", name: c[0], x: PRJX(c[1]), y: PRJY(c[2]), ci: i, pw: c[0].length * 10.5 + 14 });
    adj.push([]);
  });

  // 過密地帯(関東・関西など)は駅名標が重ならないよう少しだけ押し広げる。
  // ただし元の位置から離れすぎないよう上限をかけ、海の上に出た駅は陸へ引き戻す。
  const anchors = nodes.slice(0, CITIES.length).map((n) => ({ x: n.x, y: n.y }));
  for (let it = 0; it < 50; it++) {
    for (let a = 0; a < CITIES.length; a++) {
      for (let b = a + 1; b < CITIES.length; b++) {
        const A = nodes[a], B = nodes[b];
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), min = 50;
        if (d < min && d > 0.01) {
          const push = (min - d) / 2 / d;
          A.x -= dx * push; A.y -= dy * push;
          B.x += dx * push; B.y += dy * push;
        }
      }
    }
    for (let a = 0; a < CITIES.length; a++) {
      const A = nodes[a], an = anchors[a];
      const dx = A.x - an.x, dy = A.y - an.y, d = Math.hypot(dx, dy), cap = 30;
      if (d > cap) { A.x = an.x + (dx / d) * cap; A.y = an.y + (dy / d) * cap; }
    }
  }

  const polys = COAST.map((isl) => isl.map((p) => [PRJX(p[0]), PRJY(p[1])] as [number, number]));
  const inland = (x: number, y: number): boolean =>
    polys.some((poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    });
  for (let a = 0; a < CITIES.length; a++) {
    const n = nodes[a], an = anchors[a];
    if (inland(n.x, n.y) || !inland(an.x, an.y)) continue;
    let fixed = false;
    for (let t = 0.15; t < 1 && !fixed; t += 0.15) {
      const x = n.x + (an.x - n.x) * t, y = n.y + (an.y - n.y) * t;
      if (inland(x, y)) { n.x = x; n.y = y; fixed = true; }
    }
    if (!fixed) { n.x = an.x; n.y = an.y; }
  }

  const link = (a: number, b: number): void => { adj[a].push(b); adj[b].push(a); };
  const edgeLines: Graph["edgeLines"] = [];
  for (const [an, bn, kk, sea] of EDGES) {
    const k = kk >= 2 ? kk - 1 : kk; // 全体をおよそ200駅に調整
    const a = cityIdx[an], b = cityIdx[bn];
    const A = nodes[a], B = nodes[b];
    let prev = a;
    const chain = [a];
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      const nx = A.x + (B.x - A.x) * t, ny = A.y + (B.y - A.y) * t;
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const off = (rng() - 0.5) * 22;
      const r = rng();
      const type: SquareKind = r < 0.32 ? "blue" : r < 0.56 ? "red" : r < 0.8 ? "card" : r < 0.9 ? "lotto" : "warp";
      const id = nodes.length;
      nodes.push({ type, x: nx - (dy / len) * off, y: ny + (dx / len) * off, sea: !!sea });
      adj.push([]);
      link(prev, id); prev = id; chain.push(id);
    }
    link(prev, b); chain.push(b);
    edgeLines.push({ chain, sea: !!sea });
  }

  return { nodes, adj, cityIdx, edgeLines };
}

/** ゲーム全体で共有する路線グラフ(起動時に一度だけ構築、固定シードなので毎回同じ盤面になる) */
export const G: Graph = buildGraph();

export function distsFrom(src: number): number[] {
  const d = new Array(G.nodes.length).fill(-1);
  d[src] = 0;
  const q = [src];
  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    for (const v of G.adj[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push(v); }
  }
  return d;
}

export const bfsDist = (a: number, b: number): number => distsFrom(a)[b];

/** ノードが都市駅であることを前提に駅名を取得する(目的地・現在地は常に都市ノード) */
export function cityName(nodeIndex: number): string {
  const n = G.nodes[nodeIndex];
  return n.type === "city" ? n.name : "";
}
