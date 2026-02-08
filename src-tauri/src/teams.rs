use serde_json::json;

/// Send a message to a Microsoft Teams channel via an Incoming Webhook URL.
/// The message is formatted as an Adaptive Card with a title and markdown body.
#[tauri::command]
pub async fn send_to_teams(
    webhook_url: String,
    title: String,
    content: String,
) -> serde_json::Value {
    if webhook_url.trim().is_empty() {
        return json!({ "success": false, "error": "Webhook URL is empty" });
    }

    // Truncate content to stay under Teams' 28KB payload limit
    let truncated = if content.len() > 24_000 {
        format!("{}...\n\n(truncated — original length: {} chars)", &content[..24_000], content.len())
    } else {
        content.clone()
    };

    // Build Adaptive Card payload
    let payload = json!({
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "contentUrl": null,
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": title,
                        "weight": "Bolder",
                        "size": "Medium",
                        "wrap": true
                    },
                    {
                        "type": "TextBlock",
                        "text": truncated,
                        "wrap": true,
                        "fontType": "Default"
                    },
                    {
                        "type": "TextBlock",
                        "text": "— Sent from Codex WUI",
                        "isSubtle": true,
                        "size": "Small",
                        "horizontalAlignment": "Right"
                    }
                ]
            }
        }]
    });

    let client = reqwest::Client::new();
    match client
        .post(&webhook_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            if status >= 200 && status < 300 {
                json!({ "success": true, "status": status })
            } else {
                json!({ "success": false, "error": format!("HTTP {}: {}", status, body) })
            }
        }
        Err(e) => {
            json!({ "success": false, "error": format!("Request failed: {}", e) })
        }
    }
}
