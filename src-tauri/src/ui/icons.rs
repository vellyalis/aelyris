//! Nerd Font icon mapping for file types, git status, and UI elements.
//!
//! Icons use Unicode codepoints from Nerd Fonts (https://www.nerdfonts.com/).
//! Falls back to simple ASCII characters if the font doesn't support them.

/// Get the Nerd Font icon character for a file extension.
pub fn file_icon(name: &str, is_dir: bool) -> char {
    if is_dir {
        return dir_icon(name);
    }
    let ext = name.rsplit('.').next().unwrap_or("");
    match ext.to_lowercase().as_str() {
        // Programming languages
        "rs" => '\u{e7a8}',       // Rust
        "py" => '\u{e73c}',       // Python
        "js" => '\u{e74e}',       // JavaScript
        "ts" => '\u{e628}',       // TypeScript
        "tsx" | "jsx" => '\u{e7ba}', // React
        "go" => '\u{e627}',       // Go
        "rb" => '\u{e739}',       // Ruby
        "java" => '\u{e738}',     // Java
        "kt" | "kts" => '\u{e634}', // Kotlin
        "swift" => '\u{e755}',    // Swift
        "c" | "h" => '\u{e61e}',  // C
        "cpp" | "cxx" | "cc" | "hpp" => '\u{e61d}', // C++
        "cs" => '\u{f031b}',      // C#
        "php" => '\u{e73d}',      // PHP
        "lua" => '\u{e620}',      // Lua
        "zig" => '\u{e6a9}',      // Zig
        "ex" | "exs" => '\u{e62d}', // Elixir
        "hs" | "lhs" => '\u{e777}', // Haskell
        "sh" | "bash" | "zsh" => '\u{e795}', // Shell
        "ps1" | "psm1" => '\u{ebc7}', // PowerShell

        // Web
        "html" | "htm" => '\u{e736}', // HTML
        "css" | "scss" | "sass" | "less" => '\u{e749}', // CSS
        "vue" => '\u{e6a0}',      // Vue
        "svelte" => '\u{e697}',   // Svelte
        "wasm" => '\u{e6a1}',     // WebAssembly

        // Config / Data
        "json" => '\u{e60b}',     // JSON
        "yaml" | "yml" => '\u{e6a8}', // YAML
        "toml" => '\u{e6b2}',     // TOML
        "xml" => '\u{e619}',      // XML
        "csv" => '\u{f0219}',     // CSV
        "sql" => '\u{e706}',      // SQL
        "graphql" | "gql" => '\u{e662}', // GraphQL
        "env" | "env.local" | "env.example" => '\u{f0a09}', // Env
        "ini" | "cfg" => '\u{e615}', // Config

        // Docs
        "md" | "mdx" => '\u{e73e}', // Markdown
        "txt" => '\u{f0219}',     // Text
        "pdf" => '\u{eaeb}',      // PDF
        "doc" | "docx" => '\u{eaeb}', // Word

        // Image
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico" | "bmp" => '\u{f03e}', // Image

        // Package / Build
        "lock" => '\u{f023}',     // Lock
        "whl" | "tar" | "gz" | "zip" | "7z" | "rar" => '\u{f187}', // Archive
        "wgsl" | "glsl" | "hlsl" | "frag" | "vert" => '\u{e7a8}', // Shader

        // Git
        "gitignore" | "gitmodules" | "gitattributes" => '\u{e702}', // Git

        // Docker / Infra
        "dockerfile" => '\u{e7b0}', // Docker
        "tf" | "hcl" => '\u{e69a}', // Terraform
        "nix" => '\u{f313}',       // Nix

        _ => match name.to_lowercase().as_str() {
            "cargo.toml" | "cargo.lock" => '\u{e7a8}', // Rust
            "package.json" => '\u{e71e}',    // npm
            "tsconfig.json" => '\u{e628}',   // TypeScript
            "dockerfile" => '\u{e7b0}',      // Docker
            "makefile" | "cmake" | "cmakelists.txt" => '\u{e673}', // Make
            "license" | "license.md" => '\u{f0219}', // License
            "readme" | "readme.md" => '\u{e73e}', // Readme
            _ => '\u{f15b}',  // Default file icon
        },
    }
}

/// Get icon for directory names.
fn dir_icon(name: &str) -> char {
    match name.to_lowercase().as_str() {
        ".git" => '\u{e702}',
        "src" | "lib" | "source" => '\u{f07b}',
        "test" | "tests" | "__tests__" | "spec" => '\u{f0668}',
        "docs" | "doc" | "documentation" => '\u{f02d}',
        "node_modules" => '\u{e71e}',
        "target" => '\u{e7a8}',
        ".github" => '\u{e709}',
        ".vscode" => '\u{e70c}',
        "dist" | "build" | "out" => '\u{f187}',
        "assets" | "images" | "img" | "static" => '\u{f03e}',
        "config" | "configs" | ".config" => '\u{e615}',
        _ => '\u{f07b}', // Default folder icon
    }
}

/// Git status icon.
pub fn git_status_icon(status: char) -> char {
    match status {
        'M' | '~' => '\u{f040}',  // Modified (pencil)
        'A' | '+' => '\u{f067}',  // Added (plus)
        'D' | '-' => '\u{f068}',  // Deleted (minus)
        'R' => '\u{f064}',        // Renamed (arrow)
        '?' => '\u{f128}',        // Untracked (question)
        '!' => '\u{f06a}',        // Conflicted (exclamation)
        _ => '\u{f128}',
    }
}

/// Agent status icon.
pub fn agent_status_icon(status: &str) -> char {
    match status {
        "Idle" => '\u{f111}',         // Circle
        "Thinking..." => '\u{f110}',  // Spinner
        "Coding" => '\u{f121}',       // Code
        "Needs Input" => '\u{f059}',  // Question circle
        "Done" => '\u{f058}',         // Check circle
        _ => '\u{f111}',
    }
}

/// UI element icons.
pub fn ui_icon(name: &str) -> char {
    match name {
        "close" => '\u{f00d}',        // ×
        "minimize" => '\u{f2d1}',     // —
        "maximize" => '\u{f2d0}',     // □
        "restore" => '\u{f2d2}',      // ⊡
        "add" => '\u{f067}',          // +
        "search" => '\u{f002}',       // ��
        "settings" => '\u{f013}',     // ⚙
        "git-branch" => '\u{e725}',   // branch
        "folder" => '\u{f07b}',       // 📁
        "folder-open" => '\u{f07c}',  // 📂
        "file" => '\u{f15b}',         // 📄
        "terminal" => '\u{f120}',     // >_
        "split-h" => '\u{f0db}',      // ⬜⬜
        "split-v" => '\u{f0c9}',      // ⬜/⬜
        "refresh" => '\u{f021}',      // ↻
        "save" => '\u{f0c7}',         // 💾
        "undo" => '\u{f0e2}',         // ↩
        "redo" => '\u{f01e}',         // ↪
        "copy" => '\u{f0c5}',         // 📋
        "paste" => '\u{f0ea}',        // 📋
        "kanban" => '\u{f00a}',       // ⊞
        "help" => '\u{f059}',         // ?
        "info" => '\u{f05a}',         // ℹ
        "warning" => '\u{f071}',      // ⚠
        "error" => '\u{f057}',        // ✖
        "success" => '\u{f058}',      // ✓
        "chevron-right" => '\u{f054}', // >
        "chevron-down" => '\u{f078}',  // v
        "arrow-right" => '\u{f061}',   // →
        "arrow-left" => '\u{f060}',    // ←
        _ => '\u{f128}',              // ?
    }
}
