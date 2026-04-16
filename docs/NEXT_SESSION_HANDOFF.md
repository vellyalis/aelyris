# 次セッション引き継ぎ — UI品質200%化

**最終セッション日: 2026-04-16**
**ブランチ: master**

## 現状

- テスト: 255件全パス
- バイナリ: 14.8MB (native-terminal.exe)
- 機能: 全完了 (Warp+Scape融合)
- **問題: UIの見た目がTauri版の10%未満。ゴミ。**

## 道具は揃っている

3本のWGSLシェーダー完成済み:
- `glyph.wgsl` — テキスト
- `rect.wgsl` — 角丸SDF
- `gradient_rect.wgsl` — **グラデーション+シャドウ (未活用)**

`GradientRectInstance` コンストラクタ:
- `shadowed(pos, size, color, radius, blur, alpha)`
- `gradient_v(pos, size, top, bottom, radius)`
- `gold_button(pos, size, radius)` — 18Kゴールド

`render_frame_full(view, glyphs, rects, gradient_rects, clear)` で統合描画。

## やること (優先順)

### 1. 全UIにGradientRectInstance適用

`docs/DESIGN_SYSTEM_NATIVE.md` の値を厳密適用:

| コンポーネント | ファイル | 内容 |
|--------------|---------|------|
| パレット | ui/palette.rs | GLASS_DENSE + shadow(24px) |
| ダイアログ | ui/dialog.rs | GLASS_SOLID + shadow(24px) + ゴールドボタン |
| Toast | ui/toast.rs | GLASS_THICK + shadow(16px) |
| エージェントカード | native/render.rs | gradient背景+ストライプ+glow |
| コンテキストメニュー | native/render.rs | GLASS_THICK + shadow(16px) |

### 2. コンピュートシェーダーブラー

パレット/ダイアログの `backdrop-filter: blur(20px)` 相当。
2パスガウシアン (水平→垂直)、1/4ダウンサンプリング。

### 3. フォント改善

IBM Plex Sans weight 400/500/600 対応。

### 4. spacing厳密適用

DESIGN_SYSTEM_NATIVE.md のトークンを全build()に適用。

### 5. エージェントカード (Scape品質)

gradient背景 + 3px左ストライプ + inner glow + ホバーtransform(-2px)。

### 6. スクロールバー

カスタム描画 (サム rgba(255,255,255,0.15), radius 4px)。

## 参考

- `docs/DESIGN_SYSTEM_NATIVE.md` — Tauri版CSS全トークン
- `docs/requirements-v2-native.md` — V2要件定義書
- `C:/Users/owner/Desktop/scape/aether-v*.png` — Tauri版スクショ (比較用)
- `src/styles/global.css` — Tauri版CSS原本 (まだリポジトリにある)
