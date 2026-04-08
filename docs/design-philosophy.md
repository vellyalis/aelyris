# Aether Terminal — デザイン哲学

## Windows Premium: Macの模倣ではなく、Windows固有の美を極める

### 結論

Windows 11の最新API（Mica/Acrylic）とモダンなUIフレームワーク（Tauri + React）を使えば、
macOS以上の美しさと質感を持つUIは作成可能。

単に「Macの真似」をするのではなく、Windows 11の公式なデザイン言語（Fluent Design System）を
極限まで研ぎ澄ますことで、Macユーザーすら羨む「Aether Terminal」を実現する。

---

## 1. MacのUIが美しく感じる3要素

1. **レイヤーの透明感**
   背景が透けて見えるが、文字はくっきり読める。

2. **タイポグラフィ**
   フォント（San Francisco）のカーニングとウェイトが極めて洗練されている。

3. **物理的アニメーション**
   ウィンドウやボタンの動きが「バネ（Spring）」のように有機的。

---

## 2. Aether TerminalでのWindows Premium実現手法

### ① ウィンドウの外枠を「消す」

Windows標準のタイトルバーを捨て、コンテンツがウィンドウの端まで広がる
「Chrome-less（枠なし）」を採用。

- Tauriで `decorations: false` に設定
- 独自タイトルバー（Mica効果付き）をReactで構築
- ドラッグ、最小化/最大化/閉じるボタンを自前実装

### ② Mica と Acrylic の使い分け

Windows 11で最も美しいのは **Mica**。

**Mica（雲母）:**
- デスクトップ壁紙の色を抽出し、ウィンドウ全体に「落ち着いた透明感」を付与
- パフォーマンス負荷が極めて低い
- 長時間見ていても目が疲れない
- 用途: ウィンドウ全体の背景

**Acrylic（アクリル）:**
- すりガラスのような質感
- 一時的に表示される要素に使うと「奥行き（Z-depth）」が生まれる
- 用途: サイドバー、メニュー、コマンドパレット等

**実装:**
- Rust側（Tauri）で `window-vibrancy` ライブラリを使用
- OSのAPIを叩いてMicaを有効化
- HTML/CSSで `body { background: transparent; }` を設定

### ③ フォントの徹底（Typography）

UIとターミナルでフォントを分離し、それぞれ最適化する。

**UIフォント（サイドバー、設定、ステータスバー）:**
- メイン: Geist（Vercel開発の開発者向けフォント）or Inter（世界最高のUI用フォント）
- 日本語: 源ノ角ゴシック（Source Han Sans JP）→ BIZ UDPゴシック → Noto Sans JP

**ターミナルフォント（コード表示）:**
- メイン: Cascadia Code（Microsoft製、リガチャ対応、Windows同梱）
- 日本語: Cascadia Next JP → Source Han Sans JP → monospace

**設定:**
- `font-feature-settings: "calt" 1` でリガチャ有効化
- フォント、サイズ、行間、リガチャON/OFFはすべてユーザーカスタマイズ可能

### ④ 物理ベースのアニメーション

Mac特有の「スッと動いてピタッと止まる」バネ挙動をMotion（旧Framer Motion）で実装。

**基本パラメータ:**
```
transition: { type: "spring", stiffness: 300, damping: 30 }
```

**適用箇所:**
- ターミナルパネルのリサイズ
- サイドバーの開閉
- コマンドパレットの表示/非表示
- タブの切り替え

**禁止事項:**
- osu!lazer的な過剰演出はしない
- 「質量（Mass）」を感じるわずかな揺れに留める
- 道具としての「心地よさ」を追求する

---

## 3. Windows Premium UXの具体ルール

### 角丸（Rounded Corners）
- 8-12px を全UIに統一適用
- Win11ネイティブウィンドウと調和させる
- ボタン、カード、サイドバー、入力欄すべてに一貫して適用

### Reveal Highlight（Fluent Designの真髄）
- マウスをホバーした時に、マウス位置から光が漏れるグロー効果
- ボタン、リスト項目、タブに一貫適用
- CSS: `radial-gradient` + `pointer-events` でマウス追従する光源を生成
- 「気づくか気づかないか」の閾値が正解。派手にしない

### ダークモードの色設計
- 完全な黒 (#000000) は使わない
- わずかに青み/紫みを帯びた深いグレーをMica背景に敷く
- Catppuccin Mochaパレットをベースに調整
- 高級感と可読性の両立

### GPUアクセラレーション
- アニメーション対象は `opacity`, `transform` (x, y, scale) のみ
- `width`/`height` の直接アニメーション禁止
- `will-change` で事前にGPUレイヤー化を宣言
- 60fps以上を常に維持

---

## 4. 目指すゴール

「ただそこにあるだけで美しい」ターミナル。

Micaの透明感 ＋ 完璧なタイポグラフィ ＋ AIとの対話を融合させた究極の道具。
Macユーザーが「そのターミナル、Windowsにしかないの？ 羨ましい」と言わせる。

最初の1ページ: Tauri v2 + window-vibrancy で
「ただそこにあるだけで美しい、透明な空のウィンドウ」を出すところから始める。
