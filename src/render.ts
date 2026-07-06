import type { DropItem, Player } from "./types";
import { G, FY, PRJX, PRJY, distsFrom, cityName } from "./geo";
import { COAST, CARDS, CITIES, HAND_MAX, PCOLORS, BONBI_CHAR } from "./data";
import { S, propOwners } from "./state";
import { log, banner } from "./ui";
import { SND } from "./sound";

const NS = "http://www.w3.org/2000/svg";
const svg = document.getElementById("map") as unknown as SVGSVGElement;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: SVGElement,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  (parent ?? svg).appendChild(e);
  return e;
}

let gLand: SVGGElement, gEdge: SVGGElement, gNode: SVGGElement, gDrop: SVGGElement;
let gDest: SVGGElement, gTok: SVGGElement, gOpt: SVGGElement;
const nodeEls: SVGGElement[] = [];
const dotGroups = new Map<number, SVGGElement>();

/* ---------- 逆スケール(拡大しても駅・マスの画面上の大きさを一定に保つ) ----------
   ズームすると駅どうしの間隔だけ広がり、駅名標やマスの見かけの大きさは変わらないので、
   重なりが解消して見やすくなる。各要素を自分の中心を基準に nodeScale 倍する。 */
type ScaleTarget = { g: SVGGElement; cx: number; cy: number };
let staticScaleTargets: ScaleTarget[] = []; // 駅・マス(renderMapで再構築)
let tokenScaleTargets: ScaleTarget[] = []; // コマ(drawTokensで再構築)
let destCenter: { cx: number; cy: number } | null = null; // 目的地マーカーの中心
let nodeScale = 1;
let lastAppliedStaticScale = -1;

function scaleAbout(cx: number, cy: number, s: number): string {
  return `translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})`;
}
function applyScaleTo(t: ScaleTarget): void {
  t.g.setAttribute("transform", scaleAbout(t.cx, t.cy, nodeScale));
}

/** 駅名標クリック時のハンドラ。ui.ts からの循環参照を避けるため main.ts で後付け登録する */
let onCityClick: (ci: number) => void = () => {};
export function setCityClickHandler(fn: (ci: number) => void): void {
  onCityClick = fn;
}

export function renderMap(): void {
  svg.innerHTML = "";
  nodeEls.length = 0;
  dotGroups.clear();
  staticScaleTargets = [];
  gLand = el("g", {});
  gEdge = el("g", {});
  gNode = el("g", {});
  gDrop = el("g", { "pointer-events": "none" });
  gDest = el("g", {});
  gTok = el("g", { "pointer-events": "none" });
  gOpt = el("g", {});

  for (const isl of COAST) {
    const d = "M" + isl.map((p) => `${PRJX(p[0]).toFixed(1)},${FY(PRJY(p[1])).toFixed(1)}`).join("L") + "Z";
    el("path", { d, class: "landside", "stroke-width": 10, transform: "translate(0,9)" }, gLand); // 陸地の厚み
    el("path", { d, class: "landblob", "stroke-width": 10 }, gLand);
  }
  for (const e of G.edgeLines) {
    const pts = e.chain.map((i) => `${G.nodes[i].x},${FY(G.nodes[i].y)}`).join(" ");
    el("polyline", { points: pts, class: "edge" + (e.sea ? " sea" : "") }, gEdge);
  }
  // 手前(南)のものが上にかぶさるよう、Y座標順に描画する
  const order = G.nodes.map((_, i) => i).sort((a, b) => G.nodes[a].y - G.nodes[b].y);
  for (const i of order) {
    const n = G.nodes[i], fy = FY(n.y);
    const g = el("g", {}, gNode);
    if (n.type === "city") {
      el("rect", { x: n.x - n.pw / 2, y: fy - 6, width: n.pw, height: 20, rx: 6, class: "citypill-side" }, g);
      el("rect", { x: n.x - n.pw / 2, y: fy - 12, width: n.pw, height: 20, rx: 6, class: "citypill" }, g);
      el("text", { x: n.x, y: fy + 1.8, class: "cityname" }, g).textContent = n.name;
      const dots = el("g", { class: "dots" }, g);
      dotGroups.set(i, dots);
      g.style.cursor = "pointer"; // 駅をタップすると物件情報を確認できる
      g.addEventListener("click", () => onCityClick(n.ci));
    } else {
      // 本家桃鉄にならい、マスは回転させたダイヤ型(四角)で表現する
      const side = 12.5;
      el("rect", { x: n.x - side / 2, y: fy - side / 2 + 5, width: side, height: side, rx: 2, transform: `rotate(45 ${n.x} ${fy + 5})`, class: "sqside " + n.type }, g);
      el("rect", { x: n.x - side / 2, y: fy - side / 2, width: side, height: side, rx: 2, transform: `rotate(45 ${n.x} ${fy})`, class: "sq " + n.type }, g);
      const lbl = { blue: "+", red: "−", card: "C", lotto: "宝", warp: "W" }[n.type];
      el("text", { x: n.x, y: fy + 3, class: "sqlabel" }, g).textContent = lbl;
    }
    nodeEls[i] = g;
    staticScaleTargets.push({ g, cx: n.x, cy: fy });
  }
  lastAppliedStaticScale = -1; // 次の camLoop で再適用させる
  updateOwnDots();
  drawDest();
  drawTokens();
}

export function updateOwnDots(): void {
  G.nodes.forEach((n, i) => {
    if (n.type !== "city") return;
    const dots = dotGroups.get(i);
    if (!dots) return;
    dots.innerHTML = "";
    const owners = S.propOwner.length ? propOwners(n.ci) : [];
    owners.forEach((o, j) => {
      if (o >= 0) el("circle", { cx: n.x - n.pw / 2 + 5 + j * 8, cy: FY(n.y) + 18, r: 3.2, fill: PCOLORS[o], class: "owndot" }, dots);
    });
    if (owners.length && owners[0] >= 0 && owners.every((o) => o === owners[0])) {
      el("text", { x: n.x + n.pw / 2, y: FY(n.y) + 22, "font-size": 10, "font-weight": 800, fill: PCOLORS[owners[0]], "text-anchor": "end" }, dots).textContent = "独占!";
    }
  });
}

export function drawDest(): void {
  gDest.innerHTML = "";
  destCenter = null;
  if (S.dest < 0) return;
  const n = G.nodes[S.dest], fy = FY(n.y);
  destCenter = { cx: n.x, cy: fy };
  el("ellipse", { cx: n.x, cy: fy, rx: 26, ry: 16, class: "dest-ring" }, gDest);
  el("line", { x1: n.x + 20, y1: fy - 6, x2: n.x + 20, y2: fy - 44, stroke: "var(--accent)", "stroke-width": 3.5, "stroke-linecap": "round" }, gDest);
  el("path", { d: `M${n.x + 21.5},${fy - 44} l24,7.5 l-24,7.5 Z`, fill: "var(--accent)", stroke: "#fff", "stroke-width": 1.5 }, gDest);
  el("text", { x: n.x, y: fy - 50, class: "dest-flag" }, gDest).textContent = "目的地";
}

export function drawDrops(): void {
  if (!gDrop) return;
  gDrop.innerHTML = "";
  for (const key in S.drops) {
    const ni = Number(key);
    const n = G.nodes[ni], k = S.drops[ni].length, fy = FY(n.y);
    if (!k) { delete S.drops[ni]; continue; }
    const g = el("g", {}, gDrop);
    el("ellipse", { cx: n.x + 14, cy: fy - 8, rx: 8, ry: 3, fill: "rgba(0,0,0,.22)" }, g);
    el("rect", { x: n.x + 7, y: fy - 31, width: 14, height: 14, rx: 3, transform: `rotate(45 ${n.x + 14} ${fy - 24})`, fill: "#F2B33D", stroke: "#fff", "stroke-width": 1.8 }, g);
    el("text", { x: n.x + 14, y: fy - 20, "font-size": 10, "font-weight": 800, "text-anchor": "middle", fill: "#4a3b12" }, g).textContent = String(k);
  }
}

export function checkDrop(p: Player): void {
  const dr: DropItem[] | undefined = S.drops[p.pos];
  if (!dr || !dr.length) return;
  const keep: DropItem[] = [];
  for (const it of dr) {
    if (it.card) {
      if (p.cards.length < HAND_MAX) {
        p.cards.push(it.card);
        log(`${p.name}:落ちていた${CARDS[it.card].n}を拾った!`, "money");
      } else keep.push(it);
    } else if (it.prop) {
      S.propOwner[it.prop.ci][it.prop.pi] = p.i;
      log(`${p.name}:吹き飛ばされた物件「${CITIES[it.prop.ci][0]}の${it.prop.pr[0]}」をタダで手に入れた!`, "money");
    }
  }
  if (keep.length) S.drops[p.pos] = keep; else delete S.drops[p.pos];
  SND.coin();
  banner(`${p.name}が落とし物を拾った!`, "good");
  drawDrops();
}

export function drawTokens(): void {
  gTok.innerHTML = "";
  tokenScaleTargets = [];
  const byPos = new Map<number, Player[]>();
  S.players.forEach((p) => {
    const list = byPos.get(p.pos) ?? [];
    list.push(p);
    byPos.set(p.pos, list);
  });
  for (const [pos, listRaw] of byPos) {
    const n = G.nodes[pos], m = listRaw.length;
    // 手番のコマを最後(最前面)に描く
    const list = [...listRaw].sort((a, b) => (a.i === S.turn ? 1 : 0) - (b.i === S.turn ? 1 : 0));
    list.forEach((p, k) => {
      // 重なったら横一列にならべる(円形配置より駅名が読みやすい)
      const x = n.x + (k - (m - 1) / 2) * 19, base = FY(n.y) - 4;
      const g = el("g", { class: "token" }, gTok);
      tokenScaleTargets.push({ g, cx: x, cy: base });
      // 影(2.5D)
      el("ellipse", { cx: x, cy: base + 2, rx: 11, ry: 3.4, fill: "rgba(0,0,0,.28)" }, g);
      // 小さな機関車シルエットのコマ
      el("circle", { cx: x - 6, cy: base - 3, r: 2.6, class: "tokenwheel" }, g);
      el("circle", { cx: x + 6, cy: base - 3, r: 2.6, class: "tokenwheel" }, g);
      el("rect", { x: x - 9.5, y: base - 18, width: 3.4, height: 6.5, rx: 1, fill: p.color, class: "tokenchimney" }, g);
      el("rect", { x: x + 2.5, y: base - 17, width: 7.5, height: 14, rx: 2.5, fill: p.color, class: "tokencab" }, g);
      el("rect", { x: x + 3.8, y: base - 15, width: 5, height: 5.5, rx: 1, class: "tokenwindow" }, g);
      el("rect", { x: x - 9.5, y: base - 12, width: 16, height: 9, rx: 3, fill: p.color, class: "tokenbody" }, g);
      el("text", { x: x - 2, y: base - 5.2, class: "tokentxt" }, g).textContent = p.name[0];
      if (S.bonbi.holder === p.i) {
        el("circle", { cx: x + 9, cy: base - 24, r: 7.5, class: "bonbadge" }, g);
        el("text", { x: x + 9, y: base - 20.8, class: "bonbadgetxt" }, g).textContent = BONBI_CHAR[S.bonbi.form];
      }
      if (p.i === S.turn && !S.over) { // いま動かしているコマの目印
        el("path", { d: `M${x - 8},${base - 33} h16 l-8,10 Z`, class: "turnmark" }, g);
      }
    });
  }
}

/** 分岐選択で駅・マスをハイライトし、クリックされたノードIDを返す(最短距離の選択肢を強調表示) */
export function highlightOptions(opts: number[]): Promise<number> {
  const dists = distsFrom(S.dest);
  const recommended = Math.min(...opts.map((o) => dists[o]).filter((d) => d >= 0));
  return new Promise<number>((res) => {
    const marks: SVGElement[] = [];
    opts.forEach((o) => {
      const n = G.nodes[o], fy = FY(n.y), rec = dists[o] === recommended;
      // 駅・マスと同じ逆スケールをかけ、拡大しても見かけの大きさを揃える
      const grp = el("g", { transform: scaleAbout(n.x, fy, nodeScale) }, gOpt);
      el("ellipse", { cx: n.x, cy: fy, rx: 18, ry: 12, class: "opt-ring" + (rec ? " rec" : "") }, grp);
      el("text", { x: n.x, y: fy + 24, class: "opt-lbl" + (rec ? " rec" : "") }, grp).textContent = `あと${dists[o]}マス`;
      const hit = el("ellipse", { cx: n.x, cy: fy, rx: 28, ry: 19, class: "opt-hit" }, grp);
      hit.addEventListener("click", () => {
        marks.forEach((mk) => mk.remove());
        res(o);
      });
      marks.push(grp);
    });
  });
}

/* ================= camera ================= */
const cam = { x: 760, y: 900, w: 1600 };
const camT = { ...cam };
export let fullView = false;
/** 追従ズームの初期幅。REF_FOLLOW_W(400)より小さいぶん、初期状態から
    駅の間隔が広めに表示される(逆スケールで駅の見かけサイズは適度なまま) */
export let FOLLOW_W = 320;
export function setFullView(v: boolean): void { fullView = v; }
export function setFollowW(v: number): void { FOLLOW_W = v; }

export function camTo(x: number, y: number, w?: number): void {
  if (fullView) {
    const wrap = document.getElementById("mapwrap") as HTMLElement;
    const asp = wrap.clientHeight / Math.max(1, wrap.clientWidth);
    camT.x = 760; camT.y = FY(910); camT.w = Math.max(1560, FY(1880) / asp);
  } else {
    camT.x = x; camT.y = y; camT.w = w || FOLLOW_W;
  }
}

export function focusPlayer(p: Player): void {
  const n = G.nodes[p.pos];
  camTo(n.x, FY(n.y));
}

/** ズーム倍率の基準となる追従時の画面幅。この幅のとき駅・マスは等倍(scale=1)。 */
const REF_FOLLOW_W = 400;

function camLoop(): void {
  cam.x += (camT.x - cam.x) * 0.14;
  cam.y += (camT.y - cam.y) * 0.14;
  cam.w += (camT.w - cam.w) * 0.14;
  const wrap = document.getElementById("mapwrap") as HTMLElement;
  const asp = wrap.clientHeight / Math.max(1, wrap.clientWidth);
  const h = cam.w * asp;
  svg.setAttribute("viewBox", `${cam.x - cam.w / 2} ${cam.y - h / 2} ${cam.w} ${h}`);

  // 逆スケールを更新:追従の目標幅から求めた倍率へなめらかに寄せる。
  // 全体図と等倍追従(=REF_FOLLOW_W)ではどちらも scale=1 なので、拡大したときだけ
  // 駅・マスの見かけの大きさが保たれ、間隔が広がって重なりが解消する。
  const targetScale = fullView ? 1 : Math.min(2.4, Math.max(0.5, FOLLOW_W / REF_FOLLOW_W));
  nodeScale += (targetScale - nodeScale) * 0.14;
  if (Math.abs(nodeScale - lastAppliedStaticScale) > 0.002) {
    for (const t of staticScaleTargets) applyScaleTo(t);
    lastAppliedStaticScale = nodeScale;
  }
  // コマと目的地マーカーは頻繁に描き直されるので毎フレーム適用(要素数が少なく軽い)
  for (const t of tokenScaleTargets) applyScaleTo(t);
  if (destCenter && gDest) gDest.setAttribute("transform", scaleAbout(destCenter.cx, destCenter.cy, nodeScale));

  updateDestArrow(wrap, cam.x - cam.w / 2, cam.y - h / 2, cam.w, h);
  requestAnimationFrame(camLoop);
}

export function startCameraLoop(): void {
  requestAnimationFrame(camLoop);
}

/** 目的地が画面の外にあるとき、画面のはしに方向矢印を出す */
function updateDestArrow(wrap: HTMLElement, vx: number, vy: number, vw: number, vh: number): void {
  const box = document.getElementById("destarrow") as HTMLElement;
  if (S.dest < 0 || S.over || S.players.length === 0) { box.hidden = true; return; }
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const n = G.nodes[S.dest];
  const sx = ((n.x - vx) / vw) * W, sy = ((FY(n.y) - vy) / vh) * H;
  if (sx >= 30 && sx <= W - 30 && sy >= 30 && sy <= H - 30) { box.hidden = true; return; }
  const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
  const padY = dy < 0 ? 150 : 120; // 上はバナーやHUDと重ならないよう広めに
  const t = Math.min((W / 2 - 80) / Math.abs(dx || 1e-9), (H / 2 - padY) / Math.abs(dy || 1e-9), 1);
  box.style.left = `${cx + dx * t}px`;
  box.style.top = `${cy + dy * t}px`;
  (document.getElementById("destarrowdir") as HTMLElement).style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
  (document.getElementById("destarrowtxt") as HTMLElement).textContent = `目的地 ${cityName(S.dest)}`;
  box.hidden = false;
}
