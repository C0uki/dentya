import "./style.css";
import type { Graph } from "./types";
import { G, FY, cityName } from "./geo";
import { CITIES } from "./data";
import { S } from "./state";
import { muted, setMuted, unlockAudio } from "./sound";
import {
  renderMap, camTo, focusPlayer, fullView, setFullView, setFollowW, FOLLOW_W,
  startCameraLoop, setCityClickHandler,
} from "./render";
import { $, log, banner, updateAll, showCityInfo, showAssets, showHowto } from "./ui";
import { resolveAction } from "./input";
import { gameLoop, startNewGame } from "./game";

declare global {
  interface Window {
    DENTYA: { state: typeof S; G: Graph; CITIES: typeof CITIES };
  }
}

setCityClickHandler((ci) => {
  if (!$("overlay").classList.contains("show")) showCityInfo(ci);
});

$<HTMLButtonElement>("dicebtn").onclick = () => resolveAction({ kind: "roll" });

$<HTMLButtonElement>("assetsbtn").onclick = () => {
  const hp = S.players.find((p) => p.human);
  if (hp && !$("overlay").classList.contains("show")) void showAssets(hp);
};

$<HTMLButtonElement>("viewbtn").onclick = (e) => {
  setFullView(!fullView);
  (e.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(fullView));
  if (fullView) camTo(0, 0);
  else { const p = S.players[S.turn]; if (p) focusPlayer(p); }
};

$<HTMLButtonElement>("mutebtn").onclick = (e) => {
  setMuted(!muted);
  const btn = e.currentTarget as HTMLButtonElement;
  btn.setAttribute("aria-pressed", String(muted));
  btn.textContent = muted ? "音 OFF" : "音 ON";
};

$<HTMLButtonElement>("helpbtn").onclick = () => { if (!$("overlay").classList.contains("show")) void showHowto(); };
$<HTMLButtonElement>("howtobtn").onclick = () => void showHowto();

function refocus(): void {
  if (fullView) return;
  const p = S.players[S.turn];
  if (p) focusPlayer(p);
}
$<HTMLButtonElement>("zoominbtn").onclick = () => {
  setFollowW(Math.max(220, FOLLOW_W - 80));
  setFullView(false);
  $("viewbtn").setAttribute("aria-pressed", "false");
  refocus();
};
$<HTMLButtonElement>("zoomoutbtn").onclick = () => {
  setFollowW(Math.min(900, FOLLOW_W + 80));
  setFullView(false);
  $("viewbtn").setAttribute("aria-pressed", "false");
  refocus();
};

$<HTMLFormElement>("startform").addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio(); // ユーザー操作でAudioContext解放
  const name = ($<HTMLInputElement>("pname").value.trim() || "あなた").slice(0, 6);
  const years = Number($<HTMLSelectElement>("pyears").value);
  const speed = Number($<HTMLSelectElement>("pspeed").value);
  const ncpu = Number($<HTMLSelectElement>("pcpus").value);

  startNewGame(name, years, speed, ncpu);

  $("viewbtn").setAttribute("aria-pressed", "false");
  $("startscr").style.display = "none";
  renderMap();
  updateAll();
  log(`日本一周すごろく、スタート!${S.years}年の旅がはじまる!`, "sys");
  log(`さいしょの目的地は ${cityName(S.dest)}!`, "sys");
  banner(`目的地は ${cityName(S.dest)}!しゅっぱつ!!`, "good");
  const dn = G.nodes[S.dest];
  camTo(dn.x, FY(dn.y), 600);
  setTimeout(() => { void gameLoop(); }, 1400 * S.speed);
});

renderMap();
camTo(0, 0);
setFullView(true); // タイトル裏では全体図
startCameraLoop();
$("viewbtn").setAttribute("aria-pressed", "true");

window.DENTYA = { get state() { return S; }, G, CITIES }; // デバッグ用
