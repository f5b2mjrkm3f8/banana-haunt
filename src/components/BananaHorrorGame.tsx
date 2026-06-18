import { useEffect, useRef, useState, useCallback } from "react";

/*
このファイルは、ゲーム1本分の「ほぼ全部」が入っている。
React を使っているが、難しく考えなくて大丈夫で、役割は大きく次の4つ。

1. 音を鳴らす部分
   - AudioEngine クラス
   - BGM、心音、効果音、読み上げを担当する

2. ゲームのルールを決める部分
   - 難易度
   - 敵やアイテムの種類
   - ステージ生成

3. ゲームを進める部分
   - キーボード / タッチ入力
   - 敵の移動
   - 当たり判定
   - 勝ち負け判定

4. 画面に描く部分
   - canvas へ壁、りんご、敵、プレイヤーを描く
   - メニューやボタンは JSX で描く

はじめて読む人向けのおすすめ順:
1. `DIFFICULTIES` でルールの大枠を見る
2. `generateLevel()` でステージの作り方を見る
3. `move()` と `stepEnemy()` でゲームの進み方を見る
4. `tick()` の中で、毎フレーム何が起きるかを見る
5. `AudioEngine` で音の仕組みを見る
*/

// ============================================================================
// 軽量な音響エンジン
// Web Audio API だけで、BGM・心音・効果音をまとめて鳴らす。
// ============================================================================

/*
将来の差し替えメモ: 今は「コード内で音を合成する」方式にしている。
大きな変更を避けたいなら、まずはこのまま残しつつ、特定の音だけ外部ファイル化すると安全。

外部音声へ置き換えるときの基本方針:
1. BGM や効果音を raw.githubusercontent.com 上の mp3 / wav にする
2. もしくは base64 文字列を .txt や .ts に置いて、それを AudioBuffer に戻して再生する
3. 既存の GainNode 構成はそのまま使い、音源だけ差し替える

例: raw.githubusercontent.com の音声を読み込んで再生する例

async function playRemoteAudio(ctx: AudioContext, gain: GainNode) {
  const url =
    "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/pickup.wav";
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start();
}

例: raw.githubusercontent.com 上の「base64だけを書いた .txt」を読む例

async function playBase64TextFile(ctx: AudioContext, gain: GainNode) {
  const url =
    "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/pickup-base64.txt";
  const base64 = (await fetch(url).then((r) => r.text())).trim();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buf = await ctx.decodeAudioData(bytes.buffer);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start();
}

例: base64 を直接コードに埋める最小例

const PICKUP_WAV_BASE64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEA...";

async function decodeEmbeddedBase64(ctx: AudioContext) {
  const binary = atob(PICKUP_WAV_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return await ctx.decodeAudioData(bytes.buffer);
}

補足:
- raw.githubusercontent.com のURLは GitHub の通常URLではなく raw URL を使う
- 音量調整は audio file 側ではなく、既存の bgmGain / sfxGain で行うと管理しやすい
- base64 は手軽だがファイルサイズが大きくなりやすいので、長いBGMより短いSE向き

アセット管理の実務メモ:
- BGM・環境音・効果音を全部いきなり外部化するより、まず `playPickup()` など短いSEから置き換える方が安全
- ループ音は wav よりも圧縮音源の方が軽いが、継ぎ目が気になるなら wav の方が扱いやすい
- base64 を置くなら `src/assets/audio-base64.ts` のような専用ファイルに逃がすと本体が読みにくくなりにくい
- raw URL はブランチ名変更やリポジトリ移動で切れやすいので、コメント例のURL文字列はまとめて管理すると差し替えやすい
- Canvas 側の画像も同様に `src/assets/sprite-urls.ts` のような表に寄せると、小変更で見た目だけ更新しやすい
*/

class AudioEngine {
  // AudioContext 本体。ここから各種ノードを生成する。
  ctx: AudioContext | null = null;
  // すべての音を最後にまとめる親の GainNode。
  master: GainNode | null = null;
  // 常時鳴るBGM用の音量ノード。
  bgmGain: GainNode | null = null;
  // 低くうなる環境音用の音量ノード。
  droneGain: GainNode | null = null;
  // 心拍音だけを個別に調整するための音量ノード。
  heartGain: GainNode | null = null;
  // 敵の近さを知らせるノイズの音量ノード。
  proximityGain: GainNode | null = null;
  // 効果音全般の音量ノード。
  sfxGain: GainNode | null = null;
  // 近接ノイズを左右に振るためのパンナー。
  proximityPanner: StereoPannerNode | null = null;
  // 近接ノイズのこもり具合を変えるローパスフィルタ。
  proximityFilter: BiquadFilterNode | null = null;
  // 次の心拍を予約するタイマーID。
  heartTimer: number | null = null;
  // 1分あたりの鼓動回数。敵が近いほど上がる。
  heartRate = 60;
  // 二重初期化を防ぐフラグ。
  started = false;

  async start() {
    // すでに一度起動した後なら、重複生成しない。
    if (this.started) return;
    try {
      // Safari 系では webkitAudioContext の場合があるので両対応にする。
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctx();
      // ユーザー操作前は suspended のことがあるので、明示的に再開する。
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      // すべての音の最終出口になるマスター音量。
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);

      // 常時流れる不穏なBGM。
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.15;
      this.bgmGain.connect(this.master);

      // 低く鳴り続ける環境音。
      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0.1;
      this.droneGain.connect(this.master);

      // 敵が近いほど速くなる心拍音。
      this.heartGain = this.ctx.createGain();
      this.heartGain.gain.value = 0.5;
      this.heartGain.connect(this.master);

      // 敵との距離をノイズで伝えるための音。
      this.proximityGain = this.ctx.createGain();
      this.proximityGain.gain.value = 0;
      this.proximityPanner = this.ctx.createStereoPanner();
      this.proximityFilter = this.ctx.createBiquadFilter();
      // ローパスにして、近いほど高域が出るように変化させる。
      this.proximityFilter.type = "lowpass";
      this.proximityFilter.frequency.value = 800;
      // ノイズ -> フィルタ -> 左右定位 -> マスター、の順で接続する。
      this.proximityGain.connect(this.proximityFilter);
      this.proximityFilter.connect(this.proximityPanner);
      this.proximityPanner.connect(this.master);

      // アイテム取得や勝敗時の効果音。
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.5;
      this.sfxGain.connect(this.master);

      // 起動時に各レイヤーの音を一斉に立ち上げる。
      this.startBGM();
      this.startDrone();
      this.startProximity();
      this.scheduleHeartbeat();
      this.started = true;
    } catch (e) {
      // 音が使えない環境でもゲーム進行は止めない。
      console.error("AudioEngine start failed:", e);
      this.started = true;
    }
  }

  startBGM() {
    if (!this.ctx || !this.bgmGain) return;
    // 2つの発振器を重ねて、薄い不協和音のBGMを作る。
    // 値は低めにして、主張しすぎない背景音に留める。
    // 将来ここだけ「外部BGMファイル再生」に差し替えてもよい。
    // その場合も接続先は bgmGain のままにすると、既存のミキサーがそのまま効く。
    const freqs = [110, 164.81];
    freqs.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      // sine は柔らかく、triangle は少し角があるので混ぜると不穏さが出る。
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      // 少しだけ detune して、完全に揃わない不安定さを作る。
      osc.detune.value = (Math.random() - 0.5) * 6;
      osc.connect(this.bgmGain!);
      // stop せず常時鳴らし続ける。
      osc.start();
    });
  }

  startDrone() {
    if (!this.ctx || !this.droneGain) return;
    // 低音をフィルタで丸めて、重たい空気感を演出する。
    // ここは「部屋鳴り」「風」「低い機械音」などのループ素材に差し替えやすい。
    // 外部音源化する場合は BufferSource を droneGain へつなぐイメージになる。
    const osc = this.ctx.createOscillator();
    // sawtooth は倍音が多く、鈍い圧迫感を出しやすい。
    osc.type = "sawtooth";
    // 55Hz はかなり低く、BGMとは別の土台として鳴らす。
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    // 高域を切って、耳につきすぎない低い唸りにする。
    filter.frequency.value = 200;
    osc.connect(filter).connect(this.droneGain);
    osc.start();
  }

  startProximity() {
    if (!this.ctx || !this.proximityGain) return;
    // ホワイトノイズを常時ループさせ、距離に応じて音量と左右を変える。
    // 1秒分のバッファを作り、それをループ再生する簡易実装。
    // 将来は「足音」「息づかい」「擦れるノイズ」を短い素材でループしてもよい。
    // その場合も proximityGain / proximityFilter / proximityPanner の並びは再利用できる。
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate,
      this.ctx.sampleRate,
    );
    const d = buf.getChannelData(0);
    // -1〜1 の乱数で白色雑音を作る。
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // ループさせておき、実際の聞こえ方は後段の gain/filter/pan で変える。
    src.loop = true;
    src.connect(this.proximityGain);
    src.start();
  }

  setProximity(level: number, pan: number) {
    if (!this.ctx || !this.proximityGain || !this.proximityPanner || !this.proximityFilter)
      return;
    const t = this.ctx.currentTime;
    try {
      // 近いほど大きく・明るく聞こえ、左右位置も敵の方向に寄せる。
      // setTargetAtTime を使うのは、急な値変更によるクリックノイズを避けるため。
      this.proximityGain.gain.setTargetAtTime(
        Math.min(0.4, level * 0.4),
        t,
        0.15,
      );
      // pan は -1 が左、+1 が右。
      this.proximityPanner.pan.setTargetAtTime(pan, t, 0.15);
      // 近いほどカットオフ周波数を上げ、音が開いて聞こえるようにする。
      this.proximityFilter.frequency.setTargetAtTime(
        400 + level * 2000,
        t,
        0.15,
      );
    } catch {
      /* ignore */
    }
    // 敵が近いほど心拍も速くなり、聴覚的な緊張感を重ねる。
    this.heartRate = 55 + level * 90;
  }

  scheduleHeartbeat() {
    // 心拍の間隔は heartRate から計算し、常に次回を予約する。
    const tick = () => {
      // 1回鳴らすたびに、現在の心拍数をもとに次回時刻を再計算する。
      this.beatHeart();
      this.heartTimer = window.setTimeout(tick, 60000 / this.heartRate);
    };
    tick();
  }

  beatHeart() {
    if (!this.ctx || !this.heartGain) return;
    const t = this.ctx.currentTime;
    const beat = (offset: number, vol: number) => {
      // 1回分の鼓動を短い音程変化で表現する。
      // offset は「今から何秒後に鳴らすか」、vol は鼓動の強さ。
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      // 少し高めから低めへ落とすと、ドンという感触が出やすい。
      osc.frequency.setValueAtTime(80, t + offset);
      osc.frequency.exponentialRampToValueAtTime(35, t + offset + 0.12);
      // 音量も一瞬だけ立ち上げてすぐ減衰させる。
      g.gain.setValueAtTime(0.001, t + offset);
      g.gain.linearRampToValueAtTime(vol, t + offset + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.15);
      osc.connect(g).connect(this.heartGain!);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    };
    // 心拍らしく「ドクン、ドクン」と2発で1セットにする。
    beat(0, 0.5);
    beat(0.18, 0.35);
  }

  playPickup() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    // 上向きの短い3音で、回収成功を明るく伝える。
    // 将来の差し替え先としては、コイン音・鈴音・木の実取得音などが相性がよい。
    // 外部化するなら「短い wav を1発鳴らす」実装が一番簡単。
    // 例:
    // const PICKUP_URL =
    //   "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/pickup.wav";
    // const PICKUP_BASE64 = "UklGRiQAAABXQVZF...";
    [880, 1320, 1760].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      // triangle は丸くて軽いので、取得音に向いている。
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, t + i * 0.07);
      // アタックを少しだけ付けて、耳に痛くならないようにする。
      g.gain.setValueAtTime(0.001, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.35);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.4);
    });
  }

  playItem(kind: ItemKind) {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    // アイテムごとに音程パターンを変え、拾った種類を音でも区別できるようにする。
    // 上昇系は強化感、下降系は鈍化感、交互の高低差はスタンの刺激を表す。
    // 将来は kind ごとに別々の音声ファイルURLや base64 を割り当ててもよい。
    // その場合は presets の代わりに「kind => 再生関数 or AudioBuffer」の表を持つと整理しやすい。
    // 例:
    // const ITEM_AUDIO_URL: Record<ItemKind, string> = {
    //   heart:
    //     "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/heart.wav",
    //   slow:
    //     "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/slow.wav",
    //   shield:
    //     "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/shield.wav",
    //   stun:
    //     "https://raw.githubusercontent.com/your-name/your-repo/main/public/audio/stun.wav",
    // };
    const presets: Record<ItemKind, number[]> = {
      heart: [523, 784, 1047],
      slow: [600, 400, 250],
      shield: [440, 660, 880, 660],
      stun: [1500, 200, 1500, 200],
    };
    presets[kind].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      // スタンだけ square にして、他より強く人工的な刺激音にする。
      osc.type = kind === "stun" ? "square" : "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.001, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.3);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.35);
    });
  }

  playGameOver() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    // 長く下降する音で、失敗と緊張の解放を表現する。
    // 外部ファイル化するなら、ここは1秒前後の短い失敗音にすると扱いやすい。
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    // sawtooth にして、少し耳障りで怖い印象を出す。
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, t);
    // 440Hz から低音まで落とし、奈落に落ちるような印象にする。
    osc.frequency.exponentialRampToValueAtTime(40, t + 1.2);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 1.3);
  }

  playWin() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    // 和音に近い上昇列で、クリア時の達成感を出す。
    // クリア音も外部ファイルへ移しやすい。短いジングルなら base64 埋め込みでも現実的。
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      // 勝利音は澄んだ印象にしたいので sine を使う。
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.001, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.5);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.6);
    });
  }

  speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      // 画面を見ていなくても状況がわかるよう、日本語の読み上げを使う。
      const u = new SpeechSynthesisUtterance(text);
      // 日本語音声を選び、やや遅め・低めでホラー寄りの雰囲気にする。
      u.lang = "ja-JP";
      u.rate = 0.9;
      u.pitch = 0.7;
      u.volume = 0.9;
      // 既存の読み上げは止めず、そのままキューに積む簡易運用。
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }

  setMix(name: "master" | "bgm" | "drone" | "heart" | "sfx", v: number) {
    // UI上の名称から、実際の GainNode を引き当てる。
    // 音源を外部ファイルに変えても、最終的にこの GainNode 群へつなげば既存UIを使い回せる。
    const map: Record<string, GainNode | null> = {
      master: this.master,
      bgm: this.bgmGain,
      drone: this.droneGain,
      heart: this.heartGain,
      sfx: this.sfxGain,
    };
    const node = map[name];
    if (node && this.ctx) {
      try {
        // 少しなめらかに追従させ、スライダー操作時の急変を抑える。
        node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
      } catch {
        // 一部環境で失敗しても最低限の反映は行う。
        node.gain.value = v;
      }
    }
  }
}

// ============================================================================
// ゲーム本体
// 盤面サイズ、敵やアイテムの定義、ゲーム進行をここでまとめて扱う。
// ============================================================================

// 1マスの大きさ。数字を大きくすると、見た目全体が大きくなる。
const TILE = 28;
// 横に何マスあるか。
const COLS = 20;
// 縦に何マスあるか。
const ROWS = 14;
// canvas 全体の横幅。1マスの大きさ × 列数。
const W = TILE * COLS;
// canvas 全体の高さ。1マスの大きさ × 行数。
const H = TILE * ROWS;

// 2次元座標を表す最小単位。
// `x` が横、`y` が縦。
type Vec = { x: number; y: number };

// 敵の種類。
// 文字列で持つと、後で「banana のときだけ特殊処理」のような分岐を書きやすい。
export type EnemyKind = "banana" | "apple" | "chicken" | "fish";
// アイテムの種類。
export type ItemKind = "heart" | "slow" | "shield" | "stun";

export interface Enemy {
  // 敵の種類。
  kind: EnemyKind;
  // 今いるマスの位置。
  pos: Vec;
  // 最後に動いた時刻。動きすぎないように使う。
  lastMoveAt: number;
  // サカナだけが使うことのある「次にテレポートしてよい時刻」。
  nextTeleport?: number;
}

export interface Item {
  // アイテムの種類。
  kind: ItemKind;
  // 置かれている位置。
  pos: Vec;
}

// 敵ごとの基本速度の倍率。
// 数字が大きいほど「移動間隔」が短くなり、体感では速くなる。
const ENEMY_BASE_SPEED: Record<EnemyKind, number> = {
  banana: 1.0,
  apple: 1.6,
  chicken: 0.9,
  fish: 0.55,
};

// 画面表示や読み上げで使う、敵の日本語ラベル。
const ENEMY_LABEL: Record<EnemyKind, string> = {
  banana: "👹 黄鬼",
  apple: "🍏 殺人りんご",
  chicken: "🐔 狂チキン",
  fish: "🐟 高速サカナ",
};

// UIに出すアイテム名。
const ITEM_LABEL: Record<ItemKind, string> = {
  heart: "💚 ライフ",
  slow: "⏱️ 鈍化",
  shield: "🛡️ シールド",
  stun: "⚡ スタン",
};

// 画面描画で使う、アイテムの絵文字。
const ITEM_EMOJI: Record<ItemKind, string> = {
  heart: "💚",
  slow: "⏱️",
  shield: "🛡️",
  stun: "⚡",
};

export interface Difficulty {
  // 内部で使う識別子。
  id: string;
  // 画面に見せる難易度名。
  label: string;
  // りんごの数。
  apples: number;
  // 敵の基本移動間隔。小さいほど速い。
  enemySpeedMs: number;
  // 敵の種類ごとの出現数。
  enemies: Partial<Record<EnemyKind, number>>;
  items?: number; // その難易度で出現するアイテム総数
}

// あらかじめ用意した10段階の難易度 + 自由設定できるカスタム。
// `enemySpeedMs` は「1歩ごとの待ち時間」に近い値なので、
// 直感的な速さとは逆に、小さいほど難しくなる。
export const DIFFICULTIES: Difficulty[] = [
  { id: "lv1",  label: "Lv1 ほのぼの 🍮",     apples: 3,  enemySpeedMs: 600, enemies: { banana: 1 },                                  items: 4 },
  { id: "lv2",  label: "Lv2 やさしい 🌱",     apples: 4,  enemySpeedMs: 520, enemies: { banana: 1 },                                  items: 4 },
  { id: "lv3",  label: "Lv3 おてがる 👹",     apples: 5,  enemySpeedMs: 440, enemies: { banana: 1, apple: 1 },                        items: 3 },
  { id: "lv4",  label: "Lv4 ふつう 😬",        apples: 6,  enemySpeedMs: 380, enemies: { banana: 1, apple: 1 },                        items: 3 },
  { id: "lv5",  label: "Lv5 ちょい難 🔥",     apples: 7,  enemySpeedMs: 320, enemies: { banana: 2, apple: 1 },                        items: 3 },
  { id: "lv6",  label: "Lv6 ハード 🔥🔥",     apples: 8,  enemySpeedMs: 270, enemies: { banana: 2, apple: 1, chicken: 1 },             items: 2 },
  { id: "lv7",  label: "Lv7 鬼ハード 👺",     apples: 10, enemySpeedMs: 230, enemies: { banana: 2, apple: 2, chicken: 1, fish: 1 },     items: 2 },
  { id: "lv8",  label: "Lv8 ナイトメア 💀",   apples: 12, enemySpeedMs: 190, enemies: { banana: 3, apple: 2, chicken: 2, fish: 1 },     items: 2 },
  { id: "lv9",  label: "Lv9 地獄 👹",          apples: 15, enemySpeedMs: 150, enemies: { banana: 3, apple: 3, chicken: 3, fish: 2 },     items: 1 },
  { id: "lv10", label: "Lv10 カオス 🌀",       apples: 30, enemySpeedMs: 1000, enemies: { banana: 5, apple: 5, chicken: 5, fish: 5 },     items: 1 },
  { id: "custom", label: "カスタム ⚙️",         apples: 5,  enemySpeedMs: 320, enemies: { banana: 1 },                                   items: 3 },
];

interface GameState {
  // プレイヤーの位置。
  player: Vec;
  // 盤面にいる全敵。
  enemies: Enemy[];
  // まだ取っていないりんご一覧。
  apples: Vec[];
  // まだ取っていないアイテム一覧。
  items: Item[];
  // 壁の位置一覧。`"x,y"` の文字列で持つ。
  walls: Set<string>;
  // 取ったりんごの数。
  collected: number;
  // ゲームの進行状況。
  status: "playing" | "won" | "lost";
  // 隠れているかどうか。隠れ中は動けないが、敵に見つかりにくくなる。
  hidden: boolean;
  // そのステージに最初から置かれていたりんご総数。
  totalApples: number;
  // 一時的に効く強化・妨害効果の残り時間。
  lives: number;
  shieldUntil: number;   // ミリ秒の期限。0なら無効。
  slowUntil: number;     // この時刻まで敵の移動速度が落ちる。
  stunUntil: number;     // この時刻まで敵が停止する。
  // 画面右上などに出す、直近の出来事メッセージ。
  lastMessage: string;
}

function generateLevel(
  appleCount: number,
  enemyCounts: Partial<Record<EnemyKind, number>> | undefined,
  itemCount: number,
): GameState {
  // undefined でも安全に扱えるよう、空オブジェクトへしておく。
  const counts = enemyCounts ?? {};
  // 壁は `"x,y"` という文字列で管理する。
  // こうしておくと「この場所は壁か？」を高速に調べやすい。
  const walls = new Set<string>();

  // 外周を必ず壁にして、盤面の外に出られないようにする。
  for (let x = 0; x < COLS; x++) {
    walls.add(`${x},0`);
    walls.add(`${x},${ROWS - 1}`);
  }
  for (let y = 0; y < ROWS; y++) {
    walls.add(`0,${y}`);
    walls.add(`${COLS - 1},${y}`);
  }
  for (let i = 0; i < 28; i++) {
    // 内部にもランダムな壁を置き、毎回少し違う迷路を作る。
    // 文化祭展示などで毎回少し違う見た目になるのは、ここが理由。
    const x = 2 + Math.floor(Math.random() * (COLS - 4));
    const y = 2 + Math.floor(Math.random() * (ROWS - 4));
    walls.add(`${x},${y}`);
    if (Math.random() > 0.5) walls.add(`${x + 1},${y}`);
  }

  const freeCell = (): Vec => {
    // 壁ではないマスをランダムに探す共通関数。
    // 何度も使うので、小さな関数として切り出している。
    for (let i = 0; i < 300; i++) {
      const x = 1 + Math.floor(Math.random() * (COLS - 2));
      const y = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (!walls.has(`${x},${y}`)) return { x, y };
    }
    return { x: 1, y: 1 };
  };

  const player = freeCell();
  // 念のため、プレイヤー開始地点は壁扱いから外しておく。
  walls.delete(`${player.x},${player.y}`);

  const apples: Vec[] = [];
  let attempts = 0;
  while (apples.length < appleCount && attempts++ < 1500) {
    const c = freeCell();
    // 開始直後に即回収されないよう、プレイヤーの近くは避ける。
    // マンハッタン距離を使って、上下左右の近さで判定している。
    if (Math.abs(c.x - player.x) + Math.abs(c.y - player.y) < 4) continue;
    if (apples.some((a) => a.x === c.x && a.y === c.y)) continue;
    apples.push(c);
  }

  // アイテムは種類が偏りすぎないよう、順番に割り当てる。
  const items: Item[] = [];
  const itemKinds: ItemKind[] = ["heart", "slow", "shield", "stun"];
  let iAttempts = 0;
  while (items.length < itemCount && iAttempts++ < 1500) {
    const c = freeCell();
    // アイテムも近すぎると序盤が簡単になりすぎるので少し離す。
    if (Math.abs(c.x - player.x) + Math.abs(c.y - player.y) < 3) continue;
    if (apples.some((a) => a.x === c.x && a.y === c.y)) continue;
    if (items.some((it) => it.pos.x === c.x && it.pos.y === c.y)) continue;
    const kind = itemKinds[items.length % itemKinds.length];
    items.push({ kind, pos: c });
  }

  const enemies: Enemy[] = [];
  // 難易度設定に書かれた種類と数だけ、敵を追加していく。
  (Object.keys(counts) as EnemyKind[]).forEach((kind) => {
    const n = counts[kind] ?? 0;
    for (let i = 0; i < n; i++) {
      let pos = freeCell();
      for (let j = 0; j < 60; j++) {
        // 敵がプレイヤーの至近距離に湧かないようにする。
        if (Math.abs(pos.x - player.x) + Math.abs(pos.y - player.y) >= 6) break;
        pos = freeCell();
      }
      enemies.push({ kind, pos, lastMoveAt: 0 });
    }
  });

  return {
    // この return の中身が「ゲーム開始時の初期状態」になる。
    player,
    enemies,
    apples,
    items,
    walls,
    collected: 0,
    status: "playing",
    hidden: false,
    totalApples: apples.length,
    lives: 1,
    shieldUntil: 0,
    slowUntil: 0,
    stunUntil: 0,
    lastMessage: "",
  };
}

// 敵AI用の経路探索。
// BFSで最短経路の「最初の1歩」だけを取り出す。
// 難しく見えるが、やっていることは
// 「行けるマスを少しずつ広げて、ゴールに最初に届く道を探す」だけ。
function nextStepToward(
  from: Vec,
  to: Vec,
  walls: Set<string>,
): Vec | null {
  // 座標オブジェクトは Set にそのまま入れると比較しづらいので、文字列化する。
  const key = (v: Vec) => `${v.x},${v.y}`;
  // すでに見た場所を記録して、同じ場所を何度も調べないようにする。
  const visited = new Set<string>([key(from)]);
  // queue は「これから調べる候補の列」。
  // first は「この道で最初に踏み出した1歩」。
  const queue: { v: Vec; first: Vec | null }[] = [{ v: from, first: null }];
  // 上下左右の4方向だけ移動できる。
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  let iter = 0;
  while (queue.length && iter++ < 400) {
    // 先頭から1件ずつ取り出して調べる。
    const { v, first } = queue.shift()!;
    // ゴールに着いたら、最初の1歩だけ返せば十分。
    if (v.x === to.x && v.y === to.y) return first;
    for (const d of dirs) {
      const nv = { x: v.x + d.x, y: v.y + d.y };
      const k = key(nv);
      // もう見た場所と壁は無視する。
      if (visited.has(k)) continue;
      if (walls.has(k)) continue;
      visited.add(k);
      queue.push({ v: nv, first: first ?? nv });
    }
  }
  return null;
}

function randomFreeNeighbor(from: Vec, walls: Set<string>): Vec | null {
  // 追跡しない敵や、隠れ中の敵がふらつくときに使う。
  // 「今いる場所の上下左右のどこか、空いている所へ進む」ための関数。
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const shuffled = dirs.sort(() => Math.random() - 0.5);
  for (const d of shuffled) {
    const nv = { x: from.x + d.x, y: from.y + d.y };
    if (!walls.has(`${nv.x},${nv.y}`)) return nv;
  }
  return null;
}

function stepEnemy(
  enemy: Enemy,
  player: Vec,
  walls: Set<string>,
  now: number,
  hidden: boolean,
): Vec {
  const k = enemy.kind;
  // 敵ごとの個性は、この関数にまとまっている。
  // つまり「黄鬼はまっすぐ追う」「りんごは少し気まぐれ」などの性格設定の場所。
  // プレイヤーが隠れている間は位置を特定できないので、ランダム移動に切り替える。
  if (hidden) {
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "banana") {
    // 黄鬼はもっとも素直で、常に最短経路で追いかける。
    return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
  }
  if (k === "apple") {
    // りんごは少し気まぐれ。たまに本気で追い、それ以外はふらつく。
    if (Math.random() < 0.3) {
      return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
    }
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "chicken") {
    // チキンはりんごより少しだけ追跡しやすい。
    if (Math.random() < 0.4) {
      return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
    }
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "fish") {
    // サカナはときどきプレイヤー付近へ瞬間移動する。
    // ただし、プレイヤーにぴったり重なる場所には出ないようにしている。
    if (
      enemy.nextTeleport !== undefined &&
      now > enemy.nextTeleport &&
      Math.random() < 0.3
    ) {
      enemy.nextTeleport = now + 4000 + Math.random() * 3000;
      for (let i = 0; i < 30; i++) {
        const tx = player.x + Math.floor((Math.random() - 0.5) * 10);
        const ty = player.y + Math.floor((Math.random() - 0.5) * 10);
        if (
          tx > 0 &&
          tx < COLS - 1 &&
          ty > 0 &&
          ty < ROWS - 1 &&
          !walls.has(`${tx},${ty}`) &&
          (Math.abs(tx - player.x) + Math.abs(ty - player.y)) >= 2
        ) {
          return { x: tx, y: ty };
        }
      }
    }
    return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
  }
  return enemy.pos;
}

function TouchBtn({
  onPress,
  label,
  className,
}: {
  onPress: () => void;
  label: string;
  className?: string;
}) {
  // スマホの仮想ボタン用コンポーネント。
  // 1回押すだけでなく、長押しで連続移動できるようにしている。
  // `onPress` に「上へ移動」などの具体的な処理を外から渡して使う。
  const timer = useRef<number | null>(null);
  const stop = () => {
    // 長押し用タイマーを止める共通処理。
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  return (
    <button
      onPointerDown={(e) => {
        // 画面スクロールや長押しメニューより、このボタンの操作を優先させる。
        e.preventDefault();
        // 指やマウスを少し外しても操作が切れにくいよう、ポインターを捕まえる。
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        // 押した瞬間に1回だけすぐ反応させる。
        onPress();
        stop();
        // 長押し中は一定間隔で押下し続け、スマホでも連続移動できるようにする。
        timer.current = window.setInterval(onPress, 180);
      }}
      // 指を離したり外したりしたら、連打タイマーを止める。
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      className={`rounded-lg border-2 font-bold active:scale-90 touch-none select-none flex items-center justify-center ${className || ""}`}
      style={{
        background: "rgba(244,208,63,0.18)",
        borderColor: "#f4d03f",
        color: "#f4d03f",
      }}
    >
      {label}
    </button>
  );
}

export function BananaHorrorGame() {
  // ここから下が React の本体。
  // `useState` は「画面に見せる変化する値」、
  // `useRef` は「再描画しても保持したいメモ帳」くらいに考えると読みやすい。
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 音響エンジンは再レンダーで作り直さないよう ref に保持する。
  const engineRef = useRef<AudioEngine | null>(null);
  // 現在選ばれている難易度ID。
  const [difficultyId, setDifficultyId] = useState<string>("lv4");
  // 以下は custom 難易度を選んだときだけ使う細かい設定値。
  const [customApples, setCustomApples] = useState(5);
  const [customSpeed, setCustomSpeed] = useState(320);
  const [customItems, setCustomItems] = useState(3);
  const [customEnemies, setCustomEnemies] = useState<
    Record<EnemyKind, number>
  >({ banana: 1, apple: 0, chicken: 0, fish: 0 });

  const getActiveDifficulty = useCallback((): Difficulty => {
    // 選択中の難易度を取り出し、custom のときだけ現在のスライダー値で上書きする。
    // useCallback は「この関数を何度も作り直しすぎない」ための React の仕組み。
    const d = DIFFICULTIES.find((x) => x.id === difficultyId) ?? DIFFICULTIES[3];
    if (d.id === "custom") {
      return {
        ...d,
        apples: customApples,
        enemySpeedMs: customSpeed,
        enemies: customEnemies,
        items: customItems,
      };
    }
    return d;
  }, [difficultyId, customApples, customSpeed, customEnemies, customItems]);

  const stateRef = useRef<GameState>(generateLevel(5, { banana: 1 }, 3));
  // stateRef はゲームの中身そのもの。
  // 毎フレーム大きく変わるので、React の state より ref の方が扱いやすい。
  // 敵速度は state に入れず ref で持ち、頻繁な更新でも再描画を増やさない。
  const enemySpeedRef = useRef(320);
  // 押下中キーの状態を保持する入力バッファ。
  const keysRef = useRef<Record<string, boolean>>({});
  // 連続入力で速すぎる移動にならないよう、前回移動時刻を記録する。
  const lastMoveRef = useRef(0);
  // スワイプ判定用に、タッチ開始座標を覚えておく。
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const [started, setStarted] = useState(false);
  // 起動中フラグ。二重クリックで start が重ならないように使う。
  const [starting, setStarting] = useState(false);
  // `force` は値そのものに意味はなく、「再描画したい」という合図用。
  const [, force] = useState(0);
  const rerender = useCallback(() => force((v) => v + 1), []);

  // 画面サイズに応じてキャンバス表示サイズを調整する。
  // visualViewport と rAF を使い、スマホの表示揺れを抑える。
  const getVp = () => {
    if (typeof window === "undefined") return { w: 800, h: 600 };
    const vv = window.visualViewport;
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight),
    };
  };
  const [viewport, setViewport] = useState(getVp);
  // タッチ端末かどうか。仮想D-padを出すかどうかの判定に使う。
  const [isTouch, setIsTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches
  );
  useEffect(() => {
    // useEffect は「画面が表示された後にやりたい処理」を書く場所。
    // ここでは画面サイズ変更を監視している。
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = getVp();
        setViewport((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
      });
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    const mq = window.matchMedia("(hover: none)");
    const onMq = () => setIsTouch(mq.matches);
    mq.addEventListener?.("change", onMq);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      mq.removeEventListener?.("change", onMq);
    };
  }, []);
  const isLandscape = viewport.w > viewport.h;
  // D-padの置き場を先に確保し、表示切り替え時にキャンバス位置がずれないようにする。
  const dpadSlotW = isTouch ? (isLandscape ? 248 : 180) : 0;
  const reservedH = isLandscape ? 80 : (isTouch ? 220 : 160);
  const reservedW = dpadSlotW + 24;
  // 元のゲーム画面の縦横比。描画内容を歪ませないために使う。
  const aspect = W / H;
  const maxByH = Math.max(180, viewport.h - reservedH);
  const maxByW = Math.max(220, viewport.w - reservedW);
  // 実際に画面へ表示する canvas のサイズ。
  // 「ゲーム内部の解像度」は W x H のまま維持しつつ、見た目だけを端末に合わせて縮尺している。
  const cw = Math.min(W, maxByW, maxByH * aspect);
  const ch = cw / aspect;

  const [mix, setMix] = useState({
    // ここは UI の初期値であり、start 後に AudioEngine へ反映される。
    master: 0.7,
    bgm: 0.15,
    drone: 0.1,
    heart: 0.5,
    sfx: 0.5,
  });

  const handleStart = async () => {
    // 開始ボタンが押されたときの処理。
    if (starting || started) return;
    setStarting(true);
    try {
      const d = getActiveDifficulty();
      // 難易度に応じて盤面を作り直してから開始する。
      stateRef.current = generateLevel(d.apples, d.enemies, d.items ?? 3);
      enemySpeedRef.current = d.enemySpeedMs;
      // 初回だけ音響エンジンを生成し、以後は同じインスタンスを使い回す。
      if (!engineRef.current) engineRef.current = new AudioEngine();
      await engineRef.current.start();
      setStarted(true);
      // started を true にすると、メニュー画面からゲーム画面へ切り替わる。
      // 読み上げ文を組み立て、開始直後にゲームの目的を案内する。
      const enemyTypes = (Object.keys(d.enemies ?? {}) as EnemyKind[])
        .filter((k) => (d.enemies?.[k] ?? 0) > 0)
        .map((k) => ENEMY_LABEL[k])
        .join("、");
      setTimeout(() => {
        // ほんの少し遅らせ、AudioContext の起動直後と競合しにくくする。
        engineRef.current?.speak(
          `${enemyTypes || "敵"}が、追いかけてくる。りんごを${d.apples}つ集めなさい。`,
        );
      }, 300);
    } catch (e) {
      console.error("start failed", e);
      setStarted(true);
    } finally {
      setStarting(false);
    }
  };

  // ミキサーのスライダー変更を、そのまま音量ノードへ反映する。
  useEffect(() => {
    if (!started || !engineRef.current) return;
    // 変更された項目だけでなく全項目を毎回同期し、設定のずれを避ける。
    (Object.keys(mix) as (keyof typeof mix)[]).forEach((k) => {
      engineRef.current!.setMix(k, mix[k]);
    });
  }, [mix, started]);

  // キーボード入力の状態を保持する。
  // 実際の移動はゲームループ側で一定間隔ごとに処理する。
  useEffect(() => {
    // keydown で押したことを記録し、keyup で離したことを記録する。
    // その情報を tick() 側が見て、実際の移動を決める。
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysRef.current[key] = true;
      if (e.key === " " || e.key.startsWith("Arrow")) {
        e.preventDefault();
      }
      // Shiftは押している間ではなく、押した瞬間だけ隠れる状態を切り替える。
      if (key === "shift") {
        const s = stateRef.current;
        if (s.status === "playing") {
          s.hidden = !s.hidden;
          s.lastMessage = s.hidden ? "🫥 隠れた（動けない）" : "🚶 出た";
          rerender();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [rerender]);

  // プレイヤー移動と、移動先での取得判定をまとめて行う。
  const move = useCallback((dx: number, dy: number) => {
    const s = stateRef.current;
    // ゲーム中でなければ何もしない。
    if (s.status !== "playing") return;
    if (s.hidden) return; // 隠れている間は動けない
    // 次に進もうとする座標。
    const nx = s.player.x + dx;
    const ny = s.player.y + dy;
    // 壁なら移動しない。
    if (s.walls.has(`${nx},${ny}`)) return;
    s.player = { x: nx, y: ny };

    // りんごを拾ったら進行度を更新し、全部集めたらクリアにする。
    const idx = s.apples.findIndex((a) => a.x === nx && a.y === ny);
    if (idx >= 0) {
      s.apples.splice(idx, 1);
      s.collected++;
      engineRef.current?.playPickup();
      if (s.collected >= s.totalApples) {
        s.status = "won";
        engineRef.current?.playWin();
        engineRef.current?.speak("脱出、成功。");
      }
    }

    // アイテムごとに効果時間や残機を更新する。
    const iIdx = s.items.findIndex((it) => it.pos.x === nx && it.pos.y === ny);
    if (iIdx >= 0) {
      // 取ったアイテムは配列から消し、その場で効果を反映する。
      const item = s.items[iIdx];
      s.items.splice(iIdx, 1);
      const now = performance.now();
      engineRef.current?.playItem(item.kind);
      if (item.kind === "heart") {
        s.lives++;
        s.lastMessage = "💚 ライフ +1";
      } else if (item.kind === "slow") {
        s.slowUntil = now + 6000;
        s.lastMessage = "⏱️ 敵が6秒間鈍化";
      } else if (item.kind === "shield") {
        s.shieldUntil = now + 8000;
        s.lastMessage = "🛡️ 8秒間シールド";
      } else if (item.kind === "stun") {
        s.stunUntil = now + 3000;
        s.lastMessage = "⚡ 敵が3秒間停止";
      }
    }

    rerender();
  }, [rerender]);

  // ゲームループ。
  // 入力処理、敵更新、音の更新、描画を1フレームごとにまとめて進める。
  useEffect(() => {
    // この useEffect は「ゲームが始まっている間、ずっと動き続ける心臓部」。
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastFrame = 0;
    const tick = (now: number) => {
      // requestAnimationFrame は画面更新のたびに呼ばれる。
      // ただしそのままだと速すぎるので、約33msごと = 約30FPSに間引いている。
      if (now - lastFrame < 33) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;

      const s = stateRef.current;

      if (s.status === "playing") {
        // 押されているキーを見て、一定間隔で1マスずつ移動する。
        if (now - lastMoveRef.current > 140 && !s.hidden) {
          let dx = 0, dy = 0;
          const k = keysRef.current;
          if (k["arrowup"] || k["w"]) dy = -1;
          else if (k["arrowdown"] || k["s"]) dy = 1;
          else if (k["arrowleft"] || k["a"]) dx = -1;
          else if (k["arrowright"] || k["d"]) dx = 1;
          if (dx || dy) {
            move(dx, dy);
            lastMoveRef.current = now;
          }
        }

        const stunned = now < s.stunUntil;
        const slowed = now < s.slowUntil;
        const shielded = now < s.shieldUntil;
        // now と各期限時刻を比べるだけで、効果の有効/無効を毎フレーム判定する。

        // 敵は種類ごとの速さと特殊ルールに従って動く。
        if (!stunned) {
          const baseSpeed = enemySpeedRef.current;
          for (const enemy of s.enemies) {
            const kindMul = ENEMY_BASE_SPEED[enemy.kind];
            // 基本速度に、敵種補正・鈍化・隠れ状態の補正を掛けて最終速度を決める。
            const speedMs =
              baseSpeed * kindMul * (slowed ? 1.8 : 1) * (s.hidden ? 1.5 : 1);
            if (now - enemy.lastMoveAt > speedMs) {
              // 「次の移動先」を決めてから、敵の座標を書き換える。
              const next = stepEnemy(enemy, s.player, s.walls, now, s.hidden);
              enemy.pos = next;
              enemy.lastMoveAt = now;
              if (enemy.pos.x === s.player.x && enemy.pos.y === s.player.y) {
                // 敵とプレイヤーが同じマスに来たら接触。
                if (shielded) {
                  s.shieldUntil = 0;
                  s.lastMessage = "🛡️ シールドが砕けた！";
                  // シールド発動時は敵を少し押し戻して連続接触を防ぐ。
                  const back = randomFreeNeighbor(enemy.pos, s.walls);
                  if (back) enemy.pos = back;
                } else if (s.lives > 1) {
                  // 残機があるなら、その場ではゲームオーバーにしない。
                  s.lives--;
                  s.shieldUntil = now + 1500; // ダメージ直後の短い無敵時間
                  s.lastMessage = `💔 ライフ -1（残${s.lives}）`;
                  const back = randomFreeNeighbor(enemy.pos, s.walls);
                  if (back) enemy.pos = back;
                } else {
                  // ここで初めて敗北が確定する。
                  s.status = "lost";
                  engineRef.current?.playGameOver();
                  engineRef.current?.speak(
                    `${ENEMY_LABEL[enemy.kind]}に、つかまった。`,
                  );
                  rerender();
                  break;
                }
                rerender();
              }
            }
          }
        }

        // 一番近い敵との距離と左右差から、不穏音の強さと定位を決める。
        let nearestDx = 99, nearestDist = 99;
        for (const enemy of s.enemies) {
          const dx = enemy.pos.x - s.player.x;
          const dy = enemy.pos.y - s.player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestDx = dx;
          }
        }
        const level = Math.max(0, 1 - nearestDist / 12);
        const pan = Math.max(-1, Math.min(1, nearestDx / 7));
        // level は「どれだけ近いか」を 0〜1 に押し込んだ値。
        // pan は「左にいるか右にいるか」を -1〜1 に押し込んだ値。
        // 隠れている間は近接ノイズを弱め、見つかりにくさを音でも表現する。
        engineRef.current?.setProximity(level * (s.hidden ? 0.3 : 1), pan);
      }

      // ===== 描画処理 =====
      // ここから下は「今のゲーム状態を画面に描き直す」だけ。
      // 先に背景、その上に物、その上にキャラ、最後に暗がり効果、という順で描く。
      ctx.fillStyle = "#0a0805";
      ctx.fillRect(0, 0, W, H);

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (s.walls.has(`${x},${y}`)) {
            ctx.fillStyle = "#3a1a1a";
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          } else {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#1a1410" : "#221a14";
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
      }

      // りんごは脈打つように少し拡大縮小させる。
      // `Math.sin()` を使うと、なめらかな往復運動が作れる。
      const pulse = 1 + Math.sin(now / 250) * 0.12;
      ctx.fillStyle = "#e63946";
      s.apples.forEach((a) => {
        ctx.beginPath();
        ctx.arc(a.x * TILE + TILE / 2, a.y * TILE + TILE / 2, 8 * pulse, 0, Math.PI * 2);
        ctx.fill();
      });

      // アイテムは絵文字と光の輪で見つけやすくする。
      // 見た目だけ差し替えるなら、ここを「絵文字表示」から「画像表示」に変えるのが一番単純。
      // 今の実装は1セル中央へ描いているので、32x32 前後の正方形画像に置き換えやすい。
      ctx.font = "18px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ipulse = 1 + Math.sin(now / 200) * 0.15;
      s.items.forEach((it) => {
        const ix = it.pos.x * TILE + TILE / 2;
        const iy = it.pos.y * TILE + TILE / 2;
        // 背景に薄い光を敷き、拾える物だと一目でわかるようにする。
        const g = ctx.createRadialGradient(ix, iy, 2, ix, iy, 16);
        g.addColorStop(0, "rgba(255,255,200,0.4)");
        g.addColorStop(1, "rgba(255,255,200,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ix, iy, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(ix, iy);
        ctx.scale(ipulse, ipulse);
        ctx.fillStyle = "#fff";
        ctx.fillText(ITEM_EMOJI[it.kind], 0, 0);
        ctx.restore();
      });

      /*
      アイテム画像化メモ:
      - heart / slow / shield / stun を個別画像へ変えたい場合は、ここで kind ごとに drawImage する
      - まずは今の光エフェクトを残し、その上に画像を載せると違和感が少ない

      例:

      const ITEM_SPRITE_URL: Record<ItemKind, string> = {
        heart:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/items/heart.png",
        slow:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/items/slow.png",
        shield:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/items/shield.png",
        stun:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/items/stun.png",
      };

      const itemSprite = new Image();
      itemSprite.crossOrigin = "anonymous";
      itemSprite.src = ITEM_SPRITE_URL[it.kind];
      if (itemSprite.complete) {
        ctx.drawImage(itemSprite, ix - 14, iy - 14, 28, 28);
      } else {
        // 読み込み前だけ今の絵文字描画を使う
      }
      */

      // プレイヤーは隠れていると暗く半透明になる。
      // つまり「通常時の見た目」と「隠れ中の見た目」の2状態を持っている。
      // 画像化するなら、この if 条件に合わせて2枚の差分画像を使うと移行しやすい。
      const px = s.player.x * TILE + TILE / 2;
      const py = s.player.y * TILE + TILE / 2;
      const shieldedNow = performance.now() < s.shieldUntil;
      if (shieldedNow) {
        // シールド中は、プレイヤーの周りに輪を描いて状態を見える化する。
        ctx.strokeStyle = "rgba(120,200,255,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 13 + Math.sin(now / 100) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = s.hidden ? "#444" : "#7dd3fc";
      ctx.globalAlpha = s.hidden ? 0.45 : 1;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!s.hidden) {
        ctx.fillStyle = "#000";
        ctx.fillRect(px - 4, py - 2, 2, 2);
        ctx.fillRect(px + 2, py - 2, 2, 2);
      }

      /*
      プレイヤー画像化メモ:
      - プレイヤーは中央基準で描いているので、画像も中心合わせで drawImage すると置き換えやすい
      - 通常画像と、隠れ中に少し暗い画像を分けると既存演出を保ちやすい
      - 既存のシールド円や透明度処理はそのまま残してよい

      例:

      const PLAYER_SPRITE_URL = {
        normal:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/player/player-normal.png",
        hidden:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/player/player-hidden.png",
      };

      const playerSprite = new Image();
      playerSprite.crossOrigin = "anonymous";
      playerSprite.src = s.hidden
        ? PLAYER_SPRITE_URL.hidden
        : PLAYER_SPRITE_URL.normal;

      if (playerSprite.complete) {
        ctx.drawImage(playerSprite, px - 16, py - 16, 32, 32);
      } else {
        // まだ読み込めていない間だけ、今の円形プレイヤー描画を使う
      }
      */

      /*
      将来の差し替えメモ: 今は Canvas の図形で敵を直接描いている。
      大きく構造変更せず見た目だけ変えたいなら、各 enemy.kind ごとに画像を1枚ずつ持つのが簡単。

      例: raw.githubusercontent.com の画像を読み込んで描画する流れ

      const enemySprite = new Image();
      enemySprite.crossOrigin = "anonymous";
      enemySprite.src =
        "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/banana.png";

      if (enemySprite.complete) {
        ctx.drawImage(enemySprite, ex - 16, ey - 16, 32, 32);
      }

      実運用では次のような表にしておくと扱いやすい:

      const ENEMY_SPRITE_URL: Record<EnemyKind, string> = {
        banana:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/banana.png",
        apple:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/apple.png",
        chicken:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/chicken.png",
        fish:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/fish.png",
      };

      画像版へ移行するときの考え方:
      - まず今の図形描画を残したまま、画像が読み込めた敵だけ drawImage に切り替える
      - 画像ロード失敗時は今の Canvas 図形へフォールバックすると壊れにくい
      - raw.githubusercontent.com を使う場合、URL文字列だけ差し替えれば試せるので小変更で済む
      - キャラサイズは今の見た目に合わせると 28〜36px 四方から試すと合わせやすい
      - 透過PNGにしておくと既存の暗い背景に乗せやすい

      敵ごとの雰囲気メモ:
      - banana: 黄鬼の主役。少し大きめ、傾いた立ち絵、目を強めにすると雰囲気が出る
      - apple: 丸いシルエット。顔だけ怖くすると今の印象に近い
      - chicken: 小刻みに動く前提なので、少し横向きの立ち絵が合う
      - fish: 横長で移動感があるので、長体のシルエットが合わせやすい

      敵ごとのURL例:

      const ENEMY_SPRITE_URL_EXAMPLE: Record<EnemyKind, string> = {
        banana:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/banana-demon.png",
        apple:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/apple-killer.png",
        chicken:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/chicken-mad.png",
        fish:
          "https://raw.githubusercontent.com/your-name/your-repo/main/public/chars/fish-fast.png",
      };
      */
      // 敵ごとに見た目を描き分ける。
      const stunnedNow = performance.now() < s.stunUntil;
      s.enemies.forEach((enemy) => {
        const ex = enemy.pos.x * TILE + TILE / 2;
        const ey = enemy.pos.y * TILE + TILE / 2;
        ctx.save();
        ctx.translate(ex, ey);
        if (stunnedNow) ctx.globalAlpha = 0.55;
        // `ctx.save()` と `ctx.restore()` の間では、回転や透明度を敵1体ごとに安全に変えられる。
        if (enemy.kind === "banana") {
          // banana は今の実装だと「傾いた黄バナナ + 目」で表現している。
          // 画像化するなら、この branch の先頭で banana 専用画像を drawImage して return すると移行しやすい。
          ctx.rotate(-0.4);
          ctx.fillStyle = "#f4d03f";
          ctx.beginPath();
          ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#1a1a1a";
          ctx.lineWidth = 1;
          for (let i = 0; i < 8; i++) {
            const hx = -8 + i * 2;
            ctx.beginPath();
            ctx.moveTo(hx, -6);
            ctx.lineTo(hx + 1, -11);
            ctx.stroke();
          }
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(2, -1, 2, 0, Math.PI * 2);
          ctx.arc(6, -1, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c0392b";
          ctx.beginPath();
          ctx.arc(2, -1, 1, 0, Math.PI * 2);
          ctx.arc(6, -1, 1, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.kind === "apple") {
          // apple は丸型なので、正円に近いアイコン画像や顔つきPNGへ差し替えやすい。
          ctx.fillStyle = "#7cb342";
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#3d2817";
          ctx.fillRect(-1, -12, 2, 4);
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-5, -3); ctx.lineTo(-1, -1);
          ctx.moveTo(5, -3); ctx.lineTo(1, -1);
          ctx.stroke();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.moveTo(-4, 4); ctx.lineTo(-2, 2); ctx.lineTo(0, 4);
          ctx.lineTo(2, 2); ctx.lineTo(4, 4); ctx.lineTo(2, 6);
          ctx.lineTo(0, 5); ctx.lineTo(-2, 6);
          ctx.closePath();
          ctx.fill();
        } else if (enemy.kind === "chicken") {
          // chicken は小さく jitter させて落ち着かなさを出している。
          // 画像化後も jitter だけ残すと「狂チキン」感を保ちやすい。
          const jitter = stunnedNow ? 0 : (Math.random() - 0.5) * 1.5;
          ctx.translate(jitter, jitter);
          ctx.fillStyle = "#f5f5f5";
          ctx.beginPath();
          ctx.ellipse(0, 1, 10, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(6, -4, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#e74c3c";
          ctx.beginPath();
          ctx.arc(6, -8, 2, 0, Math.PI * 2);
          ctx.arc(8, -7, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#f39c12";
          ctx.beginPath();
          ctx.moveTo(10, -3); ctx.lineTo(13, -2); ctx.lineTo(10, -1);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(7, -5, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(7 + Math.cos(now / 80) * 0.8, -5 + Math.sin(now / 80) * 0.8, 1, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.kind === "fish") {
          // fish は横長シルエット前提なので、画像も横向き素材の方が収まりやすい。
          // テレポート持ちなので、少し発光した絵にしてもキャラ性が伝わりやすい。
          ctx.fillStyle = "#3498db";
          ctx.beginPath();
          ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-10, 0); ctx.lineTo(-15, -5); ctx.lineTo(-15, 5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(5, -1, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(5, -1, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(8, 2); ctx.lineTo(9, 4); ctx.lineTo(10, 2); ctx.lineTo(11, 4);
          ctx.stroke();
        }
        // スタン中の敵にはマークを出し、状態を視覚的に示す。
        if (stunnedNow) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#ffeb3b";
          ctx.font = "12px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("⚡", 0, -14);
        }
        ctx.restore();
      });

      // 画面端を暗くし、隠れている間は視界をさらに狭く見せる。
      // これを入れることで、ただの迷路ではなくホラーっぽい空気が強くなる。
      const vignetteRadius = s.hidden ? 110 : 220;
      const grad = ctx.createRadialGradient(px, py, 30, px, py, vignetteRadius);
      grad.addColorStop(0, s.hidden ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0)");
      grad.addColorStop(1, s.hidden ? "rgba(0,0,0,0.95)" : "rgba(0,0,0,0.8)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, move, rerender]);

  const reset = () => {
    // 同じ難易度のまま、盤面だけ作り直して再挑戦する。
    // 「難易度設定はそのまま」「配置だけ変わる」という使い方を想定している。
    const d = getActiveDifficulty();
    stateRef.current = generateLevel(d.apples, d.enemies, d.items ?? 3);
    enemySpeedRef.current = d.enemySpeedMs;
    rerender();
  };

  // タイトルへ戻るだけの軽い処理。
  // 難易度選択画面へ戻るときに使う。
  const backToMenu = () => setStarted(false);

  // JSX の中で何度も書かないよう、よく使う値を先に取り出しておく。
  const s = stateRef.current;
  // 今の difficultyId と custom 値から、実際に使う難易度設定を作る。
  const activeDiff = getActiveDifficulty();
  const nowMs = typeof performance !== "undefined" ? performance.now() : 0;
  // バフの残り時間をミリ秒で計算。0未満にはしない。
  const buffShield = Math.max(0, s.shieldUntil - nowMs);
  const buffSlow = Math.max(0, s.slowUntil - nowMs);
  const buffStun = Math.max(0, s.stunUntil - nowMs);

  return (
    // 最上位のラッパー。画面全体の背景色や余白を決める。
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-start gap-3 p-3 bg-background text-foreground">
      {/* ゲームタイトル部分。展示で見たとき最初に目へ入る看板。 */}
      <header className="text-center">
        <h1
          className="text-2xl md:text-4xl font-black tracking-wider"
          style={{
            color: "#f4d03f",
            textShadow: "2px 2px 0 #c0392b, 4px 4px 0 #1a1a1a",
            fontFamily: "'Courier New', monospace",
          }}
        >
          黄鬼
        </h1>
        {/* 一言ルール説明。展示では長文よりも、短い目的表示の方が伝わりやすい。 */}
        <p className="text-xs mt-1 opacity-70">
          🍎 りんごを集めて脱出せよ 🍌
        </p>
      </header>

      {/* `started` が false の間は、ゲーム本編ではなくメニュー画面を表示する。 */}
      {!started ? (
        <div
          className="flex flex-col gap-3 p-4 rounded-lg border-2 w-full max-w-md"
          style={{ borderColor: "#5a2a2a", background: "rgba(0,0,0,0.4)" }}
        >
          {/* 難易度一覧の見出し。 */}
          <h2 className="text-sm font-bold font-mono" style={{ color: "#f4d03f" }}>
            🎮 難易度を選択（Lv1〜Lv10）
          </h2>
          {/* 難易度ボタンの一覧。2列に並べ、長くなってもスクロールできるようにしている。 */}
          <div className="grid grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                // ボタンを押すと、その難易度IDを state に保存する。
                // 保存されるのは `d.id` だけで、実際の数値は後で `getActiveDifficulty()` が組み立てる。
                onClick={() => setDifficultyId(d.id)}
                className="px-2 py-2 rounded text-[11px] font-bold font-mono transition-all text-left"
                style={{
                  // 選択中だけ色を強くして「今どれを選んでいるか」を明確にする。
                  background:
                    difficultyId === d.id
                      ? "linear-gradient(135deg, #f4d03f, #c0392b)"
                      : "rgba(90,42,42,0.5)",
                  color: difficultyId === d.id ? "#1a0a0a" : "#f4d03f",
                  border: difficultyId === d.id ? "2px solid #f4d03f" : "1px solid #5a2a2a",
                }}
              >
                {/* 難易度名そのもの。 */}
                {d.label}
                <div className="text-[9px] opacity-80 mt-0.5 font-normal">
                  {d.id === "custom" ? (
                    // custom のときは、固定ルールではなく下のスライダーで自分で作る。
                    "自分で設定"
                  ) : (
                    <>
                      {/* 通常難易度では、りんご数・アイテム数・敵構成を簡易表示する。 */}
                      {/* 長い文章にせず記号で圧縮し、一覧性を優先している。 */}
                      🍎{d.apples}・🎁{d.items ?? 0}・
                      {(Object.keys(d.enemies) as EnemyKind[])
                        .filter((k) => (d.enemies[k] ?? 0) > 0)
                        .map((k) => `${ENEMY_LABEL[k].split(" ")[0]}${d.enemies[k]}`)
                        .join(" ")}
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* アイテム説明欄。ゲーム開始前に「何を取ると何が起こるか」を伝える。 */}
          <div className="text-[10px] opacity-70 font-mono p-2 rounded" style={{ background: "rgba(0,0,0,0.3)" }}>
            <div className="font-bold mb-0.5" style={{ color: "#f4d03f" }}>🎁 アイテム</div>
            💚 ライフ +1 ／ 🛡️ 8秒シールド ／ ⏱️ 敵を6秒鈍化 ／ ⚡ 敵を3秒停止
          </div>

          {/* custom を選んだときだけ、細かいルール調整パネルを開く。 */}
          {difficultyId === "custom" && (
            <div className="flex flex-col gap-2 p-3 rounded font-mono text-xs" style={{ background: "rgba(0,0,0,0.4)" }}>
              {/* りんご数の調整。 */}
              <div>
                <div className="flex justify-between">
                  <span>🍎 りんごの数</span>
                  <span style={{ color: "#f4d03f" }}>{customApples}個</span>
                </div>
                {/* スライダーを動かすと `customApples` が変わる。 */}
                <input type="range" min={1} max={20} step={1} value={customApples}
                  onChange={(e) => setCustomApples(parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
              </div>
              {/* アイテム数の調整。 */}
              <div>
                <div className="flex justify-between">
                  <span>🎁 アイテム数</span>
                  <span style={{ color: "#f4d03f" }}>{customItems}個</span>
                </div>
                {/* スライダーを動かすと `customItems` が変わる。 */}
                <input type="range" min={0} max={20} step={1} value={customItems}
                  onChange={(e) => setCustomItems(parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
              </div>
              {/* 敵の基本速度の調整。
                  スライダー値と内部速度の向きが逆なので、表示上は「右ほど速い」よう補正している。 */}
              <div>
                <div className="flex justify-between">
                  <span>👹 黄鬼の速さ</span>
                  <span style={{ color: "#f4d03f" }}>
                    {/* 内部値 `customSpeed` から、人が理解しやすい「歩/秒」表示へ変換している。 */}
                    {Math.round((2000 / customSpeed) * 10) / 10}歩/秒
                  </span>
                </div>
                <input type="range" min={10} max={1000} step={20}
                  value={880 - customSpeed}
                  onChange={(e) => setCustomSpeed(880 - parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
                <div className="flex justify-between text-[9px] opacity-60">
                  <span>のろま</span><span>俊敏</span>
                </div>
              </div>
              {/* 敵の種類ごとの数を個別に調整するエリア。 */}
              <div className="border-t pt-2" style={{ borderColor: "#5a2a2a" }}>
                <div className="text-[10px] mb-1.5 opacity-80">
                  👹 敵の数（合計0でも開始可・無敵モード）
                </div>
                {/* 4種類の敵を順番に並べ、それぞれ個別に体数調整できる。 */}
                {(Object.keys(customEnemies) as EnemyKind[]).map((kind) => (
                  <div key={kind} className="mb-1">
                    <div className="flex justify-between text-[10px]">
                      <span>{ENEMY_LABEL[kind]}</span>
                      <span style={{ color: "#f4d03f" }}>{customEnemies[kind]}体</span>
                    </div>
                    {/* 前の値を残しつつ、触った敵種類だけ数を更新する。 */}
                    <input type="range" min={0} max={6} step={1} value={customEnemies[kind]}
                      onChange={(e) => setCustomEnemies((prev) => ({
                        ...prev, [kind]: parseInt(e.target.value),
                      }))}
                      className="w-full accent-yellow-400" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ゲーム開始ボタン。音声の起動もここから始まる。 */}
          <button
            onClick={handleStart}
            disabled={starting}
            className="px-6 py-3 text-lg font-bold rounded-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #f4d03f, #c0392b)",
              color: "#1a0a0a",
              boxShadow: "0 0 20px rgba(192,57,43,0.4)",
            }}
          >
            {/* 起動中は文言を変え、押せない状態だと伝える。 */}
            {starting ? "起動中..." : "▶ ゲーム開始"}
          </button>
        </div>
      ) : (
        /* `started` が true のときの本編画面。
           左にゲーム画面、右に補助UIを置けるようなレイアウト。 */
        <div className="flex flex-col lg:flex-row gap-3 items-start w-full max-w-5xl">
          <div className="flex flex-col gap-2 flex-1 items-center w-full">
            {/* 上部ステータスバー。
                進行度、残機、難易度、隠れ状態、勝敗を小さくまとめて見せる。 */}
            <div className="flex flex-wrap justify-between gap-1 text-xs font-mono px-2 w-full" style={{ maxWidth: cw }}>
              {/* 左から順に、進行度、残機、難易度、隠れ状態、勝敗状態。 */}
              <span>🍎 {s.collected}/{s.totalApples}</span>
              <span>💚 {s.lives}</span>
              <span style={{ color: "#f4d03f" }}>{activeDiff.label}</span>
              <span>{s.hidden ? "🫥 隠れ中" : "🚶 行動中"}</span>
              <span>
                {s.status === "won" ? "✨ クリア!" :
                 s.status === "lost" ? "💀 ゲームオーバー" : "⚠️"}
              </span>
            </div>
            {/* 現在有効な効果の残り時間を表示する。 */}
            <div className="flex gap-2 text-[10px] font-mono px-2 w-full" style={{ maxWidth: cw }}>
              {/* 0より大きい効果だけ表示し、画面を散らかしすぎないようにする。 */}
              {/* `.toFixed(1)` で、小数1桁までの残り秒数へ整えている。 */}
              {buffShield > 0 && <span className="text-cyan-300">🛡️ {(buffShield/1000).toFixed(1)}s</span>}
              {buffSlow > 0 && <span className="text-blue-300">⏱️ {(buffSlow/1000).toFixed(1)}s</span>}
              {buffStun > 0 && <span className="text-yellow-300">⚡ {(buffStun/1000).toFixed(1)}s</span>}
              {/* 一番右には、直近の出来事メッセージを出す。 */}
              {s.lastMessage && <span className="opacity-70 ml-auto">{s.lastMessage}</span>}
            </div>

            {/* 横並び時は、キャンバスの横にD-padを置けるレイアウトにする。 */}
            <div className="flex flex-row gap-3 items-center justify-center w-full">
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                // width / height は「内部の描画サイズ」。
                // CSS の width / height は後ろの style で別に指定し、見た目だけ伸縮している。
                // スマホのスワイプ判定のため、最初に触れた位置を記録する。
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  touchStartRef.current = { x: t.clientX, y: t.clientY };
                }}
                // 指を離したとき、スワイプかタップかを判定する。
                onTouchEnd={(e) => {
                  const start = touchStartRef.current;
                  if (!start) return;
                  const t = e.changedTouches[0];
                  const dx = t.clientX - start.x;
                  const dy = t.clientY - start.y;
                  const ax = Math.abs(dx), ay = Math.abs(dy);
                  if (Math.max(ax, ay) < 20) {
                    // ほとんど動いていなければ「タップ」とみなし、隠れる/出るを切り替える。
                    const st = stateRef.current;
                    if (st.status === "playing") {
                      st.hidden = !st.hidden;
                      st.lastMessage = st.hidden ? "🫥 隠れた" : "🚶 出た";
                      rerender();
                    }
                  } else if (ax > ay) {
                    // 横方向の移動量が大きければ左右移動。
                    move(dx > 0 ? 1 : -1, 0);
                  } else {
                    // 縦方向の移動量が大きければ上下移動。
                    move(0, dy > 0 ? 1 : -1);
                  }
                  touchStartRef.current = null;
                }}
                className="rounded border-2 touch-none block transition-[width,height] duration-150 ease-out"
                style={{
                  borderColor: "#5a2a2a",
                  // 拡大してもドット絵っぽさが残るようにする。
                  imageRendering: "pixelated",
                  // `cw` / `ch` は、端末サイズに合わせて計算済みの表示寸法。
                  width: cw,
                  height: ch,
                }}
              />


              {/* タッチ端末向けの仮想十字キー。 */}
              <div
                // hover できる端末では隠し、スマホ中心にだけ見せる。
                // つまり PC ではキーボード操作、スマホではD-pad操作を主役にしている。
                className={`grid grid-cols-3 select-none touch-none [@media(hover:hover)]:hidden flex-none transition-[width] duration-150 ease-out ${isLandscape ? "gap-3" : "gap-2"}`}
                style={{ width: dpadSlotW }}
              >
                <div />
                <TouchBtn onPress={() => move(0, -1)} label="↑" className={`${isLandscape ? "w-[72px] h-[72px] text-2xl -m-1 p-1" : "w-14 h-14 text-lg"}`} />
                <div />
                <TouchBtn onPress={() => move(-1, 0)} label="←" className={`${isLandscape ? "w-[72px] h-[72px] text-2xl -m-1 p-1" : "w-14 h-14 text-lg"}`} />
                <button
                  // 中央ボタンは「隠れる / 出る」専用。
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const st = stateRef.current;
                    if (st.status !== "playing") return;
                    st.hidden = !st.hidden;
                    st.lastMessage = st.hidden ? "🫥 隠れた" : "🚶 出た";
                    rerender();
                  }}
                  className={`rounded-lg border-2 text-xs font-bold active:scale-90 touch-none select-none flex items-center justify-center ${isLandscape ? "w-[72px] h-[72px] -m-1 p-1" : "w-14 h-14"}`}
                  style={{ background: "rgba(192,57,43,0.25)", borderColor: "#c0392b", color: "#f4d03f" }}
                >
                  {/* 今の状態に合わせて、ボタン名も「隠れ」か「出る」に切り替える。 */}
                  {s.hidden ? "出る" : "隠れ"}
                </button>
                <TouchBtn onPress={() => move(1, 0)} label="→" className={`${isLandscape ? "w-[72px] h-[72px] text-2xl -m-1 p-1" : "w-14 h-14 text-lg"}`} />
                <div />
                <TouchBtn onPress={() => move(0, 1)} label="↓" className={`${isLandscape ? "w-[72px] h-[72px] text-2xl -m-1 p-1" : "w-14 h-14 text-lg"}`} />
                <div />
              </div>
            </div>

            {/* 操作説明。展示ではこれがあるだけで初見の人が迷いにくい。 */}
            <div className="text-[10px] opacity-60 font-mono px-2 text-center">
              矢印/WASD・Shift：隠れる ／ スマホ：スワイプで移動・タップで隠れる
            </div>

            {/* ゲーム終了後の再挑戦ボタンと、常時使えるメニュー戻りボタン。 */}
            <div className="flex gap-2">
              {s.status !== "playing" && (
                // クリア後・ゲームオーバー後だけ再挑戦ボタンを出す。
                <button onClick={reset} className="px-4 py-2 rounded font-bold"
                  style={{ background: "#f4d03f", color: "#1a0a0a" }}>
                  ↻ もう一度
                </button>
              )}
              {/* このボタンはプレイ中でも押せる。 */}
              <button onClick={backToMenu} className="px-4 py-2 rounded font-bold text-xs"
                style={{ background: "rgba(90,42,42,0.6)", color: "#f4d03f", border: "1px solid #5a2a2a" }}>
                ← 難易度選択
              </button>
            </div>
          </div>

          {/* 右側の補助パネル。
              音量調整やアイテム一覧を、必要な人だけ見られるよう details で折りたたみにしている。 */}
          <details className="rounded-lg border-2 font-mono text-xs w-full lg:w-56"
            style={{ borderColor: "#5a2a2a", background: "rgba(0,0,0,0.4)" }}>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold flex items-center justify-between"
              style={{ color: "#f4d03f" }}>
              {/* summary は details の見出し。クリックで開閉できる。 */}
              <span>🎛 ミキサー</span>
              <span className="text-[10px] opacity-70">クリックで開閉</span>
            </summary>
            <div className="p-3 pt-0">
              {([
                ["master", "マスター"],
                ["bgm", "BGM"],
                ["drone", "ドローン"],
                ["heart", "心拍"],
                ["sfx", "SFX"],
              ] as [keyof typeof mix, string][]).map(([k, label]) => (
                // 同じ形のスライダーが5本あるので、配列を回してまとめて描画する。
                <div key={k} className="mb-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span>{label}</span>
                    {/* 0〜1 の実数を、人間にわかりやすい0〜100表示へ変えている。 */}
                    <span>{Math.round(mix[k] * 100)}</span>
                  </div>
                  {/* スライダーを動かすと `mix` の対応項目だけ更新される。 */}
                  <input type="range" min={0} max={1} step={0.01} value={mix[k]}
                    onChange={(e) => setMix((m) => ({ ...m, [k]: parseFloat(e.target.value) }))}
                    className="w-full accent-yellow-400" />
                </div>
              ))}
              {/* 忘れたとき用に、アイテム効果を右側にも再掲する。 */}
              <div className="mt-2 pt-2 border-t text-[10px] leading-relaxed" style={{ borderColor: "#5a2a2a" }}>
                <div className="font-bold mb-1" style={{ color: "#f4d03f" }}>🎁 アイテム</div>
                {(Object.keys(ITEM_LABEL) as ItemKind[]).map((k) => (
                  <div key={k}>{ITEM_LABEL[k]}</div>
                ))}
              </div>
              {/* ブラウザの読み上げが使えるかを確認するためのテストボタン。 */}
              <button
                onClick={() => engineRef.current?.speak("テスト音声です。")}
                className="mt-2 w-full py-1 rounded text-[10px] font-bold"
                style={{ background: "#5a2a2a", color: "#f4d03f" }}>
                🔊 TTSテスト
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
