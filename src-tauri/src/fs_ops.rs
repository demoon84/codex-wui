use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use crate::models::{DirectoryEntry, FileSearchResult, SearchResult};
use crate::utils::expand_tilde_path;

fn canonicalize_workspace_root(workspace_path: Option<&str>) -> Result<PathBuf, String> {
    let Some(raw_workspace) = workspace_path else {
        return Err("workspacePath is required".to_string());
    };

    let workspace = PathBuf::from(expand_tilde_path(raw_workspace));
    let canonical = workspace
        .canonicalize()
        .map_err(|_| "workspacePath does not exist".to_string())?;

    if !canonical.is_dir() {
        return Err("workspacePath is not a directory".to_string());
    }

    Ok(canonical)
}

fn resolve_workspace_scoped_path(
    raw_path: &str,
    workspace_path: Option<&str>,
) -> Result<PathBuf, String> {
    let workspace_root = canonicalize_workspace_root(workspace_path)?;
    let given = PathBuf::from(raw_path);
    let target = if given.is_absolute() {
        given
    } else {
        workspace_root.join(given)
    };

    let normalized = if target.exists() {
        target
            .canonicalize()
            .map_err(|_| "Failed to canonicalize target path".to_string())?
    } else {
        let parent = target
            .parent()
            .ok_or_else(|| "Invalid target path".to_string())?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|_| "Target parent directory does not exist".to_string())?;
        match target.file_name() {
            Some(name) => canonical_parent.join(name),
            None => canonical_parent,
        }
    };

    if !normalized.starts_with(&workspace_root) {
        return Err("Path is outside workspace root".to_string());
    }

    Ok(normalized)
}

fn walk_files(
    dir: &Path,
    base: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<FileSearchResult>,
) {
    if depth > max_depth {
        return;
    }

    let ignore_dirs = [
        "node_modules",
        ".git",
        "dist",
        "dist-electron",
        ".next",
        ".vite",
        "coverage",
        "__pycache__",
        ".cache",
    ];

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            if path.is_dir() {
                if ignore_dirs.contains(&name.as_str()) || name.starts_with('.') {
                    continue;
                }
                out.push(FileSearchResult {
                    name: name.clone(),
                    path: path.to_string_lossy().to_string(),
                    relative_path: rel,
                    is_directory: true,
                });
                walk_files(&path, base, depth + 1, max_depth, out);
            } else {
                out.push(FileSearchResult {
                    name,
                    path: path.to_string_lossy().to_string(),
                    relative_path: rel,
                    is_directory: false,
                });
            }
        }
    }
}

#[tauri::command]
pub fn search_files(workspace_path: String, query: String) -> Vec<FileSearchResult> {
    let base = PathBuf::from(expand_tilde_path(&workspace_path));
    let mut all_files = Vec::new();
    walk_files(&base, &base, 0, 4, &mut all_files);

    let q = query.to_lowercase();
    let mut filtered: Vec<FileSearchResult> = all_files
        .into_iter()
        .filter(|f| {
            f.relative_path.to_lowercase().contains(&q) || f.name.to_lowercase().contains(&q)
        })
        .collect();

    filtered.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return b.is_directory.cmp(&a.is_directory);
        }
        let a_exact = a.name.to_lowercase() == q;
        let b_exact = b.name.to_lowercase() == q;
        if a_exact != b_exact {
            return b_exact.cmp(&a_exact);
        }
        a.relative_path.len().cmp(&b.relative_path.len())
    });

    filtered.into_iter().take(20).collect()
}

#[tauri::command]
pub fn read_file_content(file_path: String, workspace_path: Option<String>) -> serde_json::Value {
    let resolved = match resolve_workspace_scoped_path(&file_path, workspace_path.as_deref()) {
        Ok(path) => path,
        Err(error) => return serde_json::json!({ "success": false, "error": error }),
    };

    match fs::read_to_string(&resolved) {
        Ok(content) => serde_json::json!({ "success": true, "content": content }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn write_file(
    file_path: String,
    content: String,
    workspace_path: Option<String>,
) -> serde_json::Value {
    let resolved = match resolve_workspace_scoped_path(&file_path, workspace_path.as_deref()) {
        Ok(path) => path,
        Err(error) => return serde_json::json!({ "success": false, "error": error }),
    };

    match fs::write(&resolved, content) {
        Ok(_) => serde_json::json!({ "success": true }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn list_directory(dir_path: String, workspace_path: Option<String>) -> serde_json::Value {
    let resolved = match resolve_workspace_scoped_path(&dir_path, workspace_path.as_deref()) {
        Ok(path) => path,
        Err(error) => return serde_json::json!({ "success": false, "error": error }),
    };

    match fs::read_dir(&resolved) {
        Ok(entries) => {
            let mut result = Vec::new();
            for entry in entries.flatten() {
                let path = entry.path();
                let metadata = fs::metadata(&path).ok();
                result.push(DirectoryEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    is_directory: path.is_dir(),
                    size: metadata.map(|m| m.len()).unwrap_or(0),
                });
            }
            serde_json::json!({ "success": true, "entries": result })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn file_exists(file_path: String, workspace_path: Option<String>) -> bool {
    match resolve_workspace_scoped_path(&file_path, workspace_path.as_deref()) {
        Ok(path) => Path::new(&path).exists(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn web_search(query: String) -> serde_json::Value {
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1",
        urlencoding::encode(&query)
    );

    match reqwest::get(url).await {
        Ok(res) => match res.json::<Value>().await {
            Ok(data) => {
                let mut results: Vec<SearchResult> = Vec::new();
                if let Some(abs) = data.get("Abstract").and_then(|v| v.as_str()) {
                    if !abs.is_empty() {
                        results.push(SearchResult {
                            title: data
                                .get("Heading")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&query)
                                .to_string(),
                            url: data
                                .get("AbstractURL")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            snippet: abs.to_string(),
                        });
                    }
                }
                if let Some(topics) = data.get("RelatedTopics").and_then(|v| v.as_array()) {
                    for topic in topics.iter().take(5) {
                        if let (Some(text), Some(url)) = (
                            topic.get("Text").and_then(|v| v.as_str()),
                            topic.get("FirstURL").and_then(|v| v.as_str()),
                        ) {
                            results.push(SearchResult {
                                title: text.split(" - ").next().unwrap_or(text).to_string(),
                                url: url.to_string(),
                                snippet: text.to_string(),
                            });
                        }
                    }
                }
                serde_json::json!({ "success": true, "results": results })
            }
            Err(e) => {
                serde_json::json!({ "success": false, "error": e.to_string(), "results": [] })
            }
        },
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string(), "results": [] }),
    }
}

#[tauri::command]
pub fn open_in_editor(file_path: String, editor: Option<String>) -> serde_json::Value {
    let expanded_path = expand_tilde_path(&file_path);
    let path = Path::new(&expanded_path);
    if !path.exists() {
        return serde_json::json!({ "success": false, "error": "File does not exist" });
    }

    // Determine which editor to try
    let editors_to_try: Vec<&str> = if let Some(ref ed) = editor {
        vec![ed.as_str()]
    } else {
        vec!["code", "cursor"]
    };

    // Try each editor
    for ed in &editors_to_try {
        let result = Command::new(ed).arg(&expanded_path).spawn();
        if result.is_ok() {
            return serde_json::json!({ "success": true, "editor": ed });
        }
    }

    // Fallback: open with system default
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(&expanded_path).spawn()
    } else if cfg!(target_os = "linux") {
        Command::new("xdg-open").arg(&expanded_path).spawn()
    } else {
        Command::new("cmd")
            .args(["/C", "start", "", &expanded_path])
            .spawn()
    };

    match result {
        Ok(_) => serde_json::json!({ "success": true, "editor": "system" }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}
