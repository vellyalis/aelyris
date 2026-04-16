# Aether Terminal — Native Design System (wgpu移植用)

Tauri版CSSから抽出したピクセルパーフェクトなデザイントークン。
全てのUI描画はこのドキュメントの値を使用すること。

## ガラス階層 (7段階)

| レベル | RGBA | 用途 |
|--------|------|------|
| glass-clear | (12,12,12, 0.02) | ターミナル中央、最大透過 |
| glass-ground | (10,10,10, 0.85) | サイドバーレール、最暗 |
| glass-frame | (16,16,16, 0.45) | ヘッダー、ステータスバー |
| glass-standard | (20,20,20, 0.55) | 左パネル |
| glass-dense | (22,22,22, 0.62) | 右パネル |
| glass-thick | (28,28,28, 0.72) | カード、浮き上がり面 |
| glass-solid | (26,26,26, 0.82) | モーダル、ダイアログ |

## アクセントカラー (18Kゴールド)

| トークン | 値 |
|---------|-----|
| gold | #c8a050 |
| gold-dim | rgba(200,160,80, 0.4) |
| gold-subtle | rgba(200,160,80, 0.2) |
| gold-glow | rgba(200,160,80, 0.35) |

## テキスト階層

| トークン | RGBA |
|---------|------|
| text-primary | (255,255,255, 0.88) |
| text-secondary | (255,255,255, 0.5) |
| text-muted | (255,255,255, 0.3) |

## ボーダー

| トークン | RGBA |
|---------|------|
| border | (255,255,255, 0.06) |
| border-strong | (255,255,255, 0.1) |

## フォントサイズ

| トークン | px |
|---------|-----|
| text-2xs | 9 |
| text-xs | 10 |
| text-sm | 11 |
| text-md | 12 |
| text-base | 13 |
| text-lg | 14 |
| text-xl | 15 |
| text-2xl | 17 |

## スペーシング

| トークン | px |
|---------|-----|
| space-1 | 2 |
| space-2 | 4 |
| space-3 | 6 |
| space-4 | 8 |
| space-5 | 10 |
| space-6 | 12 |
| space-8 | 16 |

## レイアウト寸法

| 要素 | px |
|------|-----|
| ヘッダー高さ | 48 |
| タブバー高さ | 28 |
| ステータスバー高さ | 24 |
| サイドバー幅 | 180 (min 120, max 360) |
| 右パネル幅 | 320 (min 260, max 400) |
| 角丸-sm | 4 |
| 角丸 | 8 |
| 角丸-lg | 12 |

## 影

| レベル | 定義 |
|--------|------|
| shadow-sm | 0 1px 2px rgba(0,0,0, 0.3) |
| shadow-md | 0 4px 12px rgba(0,0,0, 0.4), 0 1px 3px rgba(0,0,0, 0.3) |
| shadow-lg | 0 8px 24px rgba(0,0,0, 0.5), 0 2px 8px rgba(0,0,0, 0.3) |
| glow-gold | 0 0 16px rgba(200,160,80, 0.35) |

## ステータスカラー

| 状態 | 色 |
|------|-----|
| idle | #4ade80 |
| edit | #fbbf24 |
| thinking | #cba6f7 |
| error | #f38ba8 |
| done | #89b4fa |

## 光漏れエフェクト

- 左上: radial-gradient(circle, rgba(200,160,80, 0.08), transparent 70%)
- 右下: radial-gradient(circle, rgba(148,226,213, 0.05), transparent 70%)
