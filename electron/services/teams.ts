/**
 * Send a message to a Microsoft Teams channel via an Incoming Webhook URL.
 * The message is formatted as an Adaptive Card with a title and markdown body.
 */
export async function sendToTeams(
    webhookUrl: string,
    title: string,
    content: string,
): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!webhookUrl.trim()) {
        return { success: false, error: 'Webhook URL is empty' };
    }

    // Truncate content to stay under Teams' 28KB payload limit
    const truncated =
        content.length > 24_000
            ? `${content.slice(0, 24_000)}...\n\n(truncated — original length: ${content.length} chars)`
            : content;

    const payload = {
        type: 'message',
        attachments: [
            {
                contentType: 'application/vnd.microsoft.card.adaptive',
                contentUrl: null,
                content: {
                    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                    type: 'AdaptiveCard',
                    version: '1.4',
                    body: [
                        {
                            type: 'TextBlock',
                            text: title,
                            weight: 'Bolder',
                            size: 'Medium',
                            wrap: true,
                        },
                        {
                            type: 'TextBlock',
                            text: truncated,
                            wrap: true,
                            fontType: 'Default',
                        },
                        {
                            type: 'TextBlock',
                            text: '— Sent from Codex WUI',
                            isSubtle: true,
                            size: 'Small',
                            horizontalAlignment: 'Right',
                        },
                    ],
                },
            },
        ],
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const status = response.status;
        if (status >= 200 && status < 300) {
            return { success: true, status };
        } else {
            const body = await response.text();
            return { success: false, error: `HTTP ${status}: ${body}` };
        }
    } catch (err: any) {
        return { success: false, error: `Request failed: ${err.message}` };
    }
}
