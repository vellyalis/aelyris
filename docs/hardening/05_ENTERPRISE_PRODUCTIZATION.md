# 05 — Enterprise Productization（認可全面化 + multi-user auth + RBAC）

> 親: [`00_README.md`](00_README.md) ／ P5 governance の続き。**フル enterprise は local-first の範囲外**だが、その seam をここで段階的に敷く。
>
> 決定: 認証モデル = **APIキー/principal**。今回 = **E1 実装 + E2/E3 設計**。

## 0. 背景（実コード事実 / 調査済み）

- auth = 単一ベアラートークン。`api/mod.rs` `AuthConfig{token: Option<String>}`、`auth_middleware` が `router().route_layer()` で**全ルートに適用**（`api/mod.rs:1072`）。principal/role/identity の概念は**無い**。
- 外部面: REST `/sessions*`・`/commands`、WebSocket `/sessions/{id}/stream`(ticket)、`/mux/*`、MCP `/mcp/*`、`/daemon/*`、`/health`。
- governance(P5) は **MCP verb 面のみ**を覆う（`api/mcp.rs:tools_call` choke point）。REST/WS/mux は素通り = P5 監査 #1。
- 監査基盤: `audit.rs`/`db` の `append_audit_journal_event(AuditJournalAppend)`。`agent_id`(actor)/`workspace_id`(tenant)/`correlation_id`(verb)/`kind`/`payload` を載せられる。
- axum 0.8.9。request extensions(`MatchedPath`/`Extension`)で actor 伝播が可能。rate limiter は per-IP(`ConnectInfo`)。TLS 無し(localhost)。

## 1. ゴールと段階

| 段階 | 目的 | 状態 |
|------|------|------|
| **E1** | governance を**全外部面**へ拡張（統一 authorization middleware）。Principal seam を敷設。default allow-all で挙動不変 | ✅ 今回実装 |
| **E2** | **APIキー multi-user auth**。token→principal 解決で実 actor 識別。per-principal rate limit | 📝 設計（次回実装） |
| **E3** | **RBAC role→capability** + **テナント分離**（リソースの tenant スコープ）+ 全call監査 | 📝 設計 |

> 設計の核: P5 で `Governance`(AccessControl/TenantResolver, default allow-all/single-tenant)は配線済。E1 は「適用範囲を全面に」、E2 は「actor を本物に」、E3 は「policy を本物に + リソース分離」。各段で前段の seam にプラグインするだけ。

---

## E1 — governance 全面化（今回実装・挙動不変）

### 設計
1. **`Principal` 型**（`governance`）: `{ actor: String, tenant: String, roles: Vec<String> }`。default = `operator` / `default` / `[]`。
2. **`PrincipalResolver` trait** + `SingleOperator` default: `resolve(token) -> Principal`。E1 の default は token を無視し operator を返す（auth は依然単一トークン）。**E2 がここを APIキー resolver に差し替える**。`Governance` が `resolver` も保持。
3. **`auth_middleware` 拡張**: トークン検証成功後、`resolve_principal(token)` の `Principal` を `req.extensions_mut().insert()`。全ルートに actor が伝播。
4. **`authorization_middleware`（新）**: auth の直後に `route_layer`。`MatchedPath`+method → **capability 名**を導出し `governance.authorize(actor, capability)`。Deny→durable監査+403、Allow→続行。**全ルート**(REST/WS/mux/MCP/daemon/health)を一様に覆う。MCP は加えて `tools_call` で**verb 単位の細粒度 authz**を継続（多層防御、両方 default allow）。
5. **capability 導出**(`derive_capability(method, matched_path)`): 例 `POST /sessions`→`session.create`、`POST /sessions/{id}/input`→`session.input`、`GET /sessions/{id}/stream`→`session.stream`、`POST /mux/workspaces/{id}/panes/split`→`mux.pane.split`、`POST /mcp/tools/call`→`mcp.tools.call`、`POST /daemon/shutdown`→`daemon.shutdown`。未知は `method:path` フォールバック。
6. **監査共有化**: `audit_access_denied` を `api` 層の `pub(crate)` ヘルパに移し、MCP choke point と middleware の両方が使用。

### 不変条件（挙動不変の死守）
- default = AllowAll → middleware は常に Allow → 既存挙動・既存 API 統合テスト不変。
- middleware は auth の**後**（未認証は従来通り 401、認可は認証済みにのみ問う）。
- WS upgrade も HTTP リクエストなので auth→authz middleware を通る。ticket 経路も Principal が extensions に入る。

### 受入
- Deny policy を注入 → **REST `POST /sessions` が 403**（MCP だけでなく全面で効く）。default → 通過。
- 既存統合テスト(test_api_3d1*) 全緑。

---

## E2 — APIキー multi-user auth（設計・次回実装）

### データモデル（migration 追加）
```sql
CREATE TABLE IF NOT EXISTS principals (
    id          TEXT PRIMARY KEY,          -- actor id (e.g. "alice")
    key_hash    TEXT NOT NULL UNIQUE,      -- argon2/sha256 of the API key (never store raw)
    tenant      TEXT NOT NULL DEFAULT 'default',
    roles_json  TEXT NOT NULL DEFAULT '[]',-- Vec<String> role names
    disabled    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_principals_key ON principals(key_hash);
```

### 機構
- **`ApiKeyResolver`**(`PrincipalResolver` 実装): `Authorization: Bearer <api-key>` → `hash(key)` → `principals` 行 → `Principal{actor=id, tenant, roles}`。disabled/不一致は `None`（auth 失敗=401）。
- **`AuthConfig` 拡張**: 現 `verify(token)->bool` を「resolver が Some を返すか」に置換可能に。単一トークン互換は default resolver で維持。
- **キー管理 CLI/MCP verb**: `principal.create`(キー発行=平文を1度だけ返す)/`principal.disable`/`principal.list`。発行時のみ平文、保存は hash。
- **per-principal rate limit**: rate limiter key を `IpAddr` → `tenant:actor`(認証後) に。未認証は IP のまま。
- **`tools_call` の actor**: `Principal` extractor(`FromRequestParts`、extensions から取得)で `actor="operator"` 固定を置換 → 本物の actor。

### 受入
- 異なるキー→異なる actor が `authorize`/監査に流れる。disabled キー→401。SSO は後段で `JwtResolver` を足す形（`PrincipalResolver` 差し替え）。

---

## E3 — RBAC + テナント分離（設計）

### RBAC
- **`RolePolicy`**(`AccessControl` 実装): `role → 許可 capability パターン集合`（glob: `session.*`, `aether.task.*`, `*`=admin）。`authorize(actor, verb)` = actor の roles の許可集合に verb がマッチするか。`roles` は Principal(E2) から。
- 例: `admin`=`*` / `operator`=`session.*,aether.*,mux.*` / `readonly`=`*.list,*.get,*.capture,*.recent,*.since,health.*`。
- 設定は TOML or `principals.roles_json`。

### テナント分離
- リソース(session/pane/workspace)に **tenant タグ**。`PtyManager`/mux に owner tenant を記録。
- authorize に加え **resource-tenant チェック**: actor の tenant ≠ リソースの tenant → 403（`session.input` 等で他テナントのセッションを触れない）。
- **最難関**: 既存リソース所有モデル(`PtyManager`/mux/DB)全てに tenant 列/フィールドを足す必要。段階的に session→pane→workspace。

### 全call監査
- `Governance` に `audit_mode: Denials | All`。`All` で allow も `kind="access_allowed"` で記録（サンプリング可）。enterprise audit trail 要件。default=Denials（E1 と同じ・低オーバーヘッド）。

### スコープ外（別 productization）
- マルチノード/分散・SSO(OIDC)直結・metrics export(Prometheus)・mTLS。これらは local-first desktop を越える別プロジェクト。

---

## リスク / 留意
- **セキュリティ核心**: E2/E3 は実装後に必ず security-reviewer + 敵対レビュー。キーは hash 保存・平文は発行時のみ・定時比較。
- **挙動不変の死守**: E1 は default allow-all。E2/E3 を入れても default(single operator/allow-all)では既存挙動を変えない。
- **TLS 無し**: 現状 localhost のみ。remote 公開時は mTLS/TLS が前提（別 PR、[memory: 3D-1 v2d TLS 据え置き] と同じ扱い）。
- **二重 authz(MCP)**: middleware(coarse) + tools_call(fine)。意図的多層防御、両方 default allow で無害。
