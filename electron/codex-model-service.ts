import { GoogleGenerativeAI, GenerateContentStreamResult } from '@google/generative-ai'

// Model modes
export type ModelMode = 'planning' | 'fast'

// Response with thinking content
export interface CodexResponse {
    thinking?: string
    content: string
}

// Stream callback types
export interface StreamCallbacks {
    onThinking?: (text: string) => void
    onContent?: (text: string) => void
    onError?: (error: Error) => void
    onComplete?: (response: CodexResponse) => void
}

// Model configurations
const MODELS = {
    planning: 'codex-2.5-flash',  // Has thinking capability
    fast: 'codex-2.0-flash'       // Fast model
}

export class CodexService {
    private client: GoogleGenerativeAI | null = null
    private currentMode: ModelMode = 'planning'

    constructor() {
        const apiKey = process.env.CODEX_API_KEY
        if (apiKey) {
            this.client = new GoogleGenerativeAI(apiKey)
        }
    }

    isConfigured(): boolean {
        return this.client !== null
    }

    setMode(mode: ModelMode) {
        this.currentMode = mode
    }

    getMode(): ModelMode {
        return this.currentMode
    }

    async streamGenerate(prompt: string, callbacks: StreamCallbacks): Promise<void> {
        if (!this.client) {
            callbacks.onError?.(new Error('CODEX_API_KEY not configured'))
            return
        }

        try {
            const model = this.client.getGenerativeModel({
                model: MODELS[this.currentMode],
            })

            // Add Korean instruction
            const fullPrompt = `[반드시 한국어로 답변하세요. 이모지는 사용하지 마세요.]\n\n${prompt}`

            const result: GenerateContentStreamResult = await model.generateContentStream(fullPrompt)

            let thinkingContent = ''
            let responseContent = ''
            let isThinking = true

            for await (const chunk of result.stream) {
                const text = chunk.text()

                if (this.currentMode === 'planning') {
                    // Check for thinking/response separation
                    // Thinking model outputs thinking first, then response
                    if (chunk.candidates?.[0]?.content?.parts) {
                        for (const part of chunk.candidates[0].content.parts) {
                            if ('thought' in part && part.thought) {
                                // This is thinking content
                                thinkingContent += part.text || ''
                                callbacks.onThinking?.(part.text || '')
                            } else if (part.text) {
                                // This is response content
                                isThinking = false
                                responseContent += part.text
                                callbacks.onContent?.(part.text)
                            }
                        }
                    } else if (text) {
                        if (isThinking && text.includes('</think>')) {
                            isThinking = false
                        }
                        if (isThinking) {
                            thinkingContent += text
                            callbacks.onThinking?.(text)
                        } else {
                            responseContent += text
                            callbacks.onContent?.(text)
                        }
                    }
                } else {
                    // Fast mode - no thinking
                    responseContent += text
                    callbacks.onContent?.(text)
                }
            }

            callbacks.onComplete?.({
                thinking: thinkingContent || undefined,
                content: responseContent
            })

        } catch (error) {
            callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
    }

    async generate(prompt: string): Promise<CodexResponse> {
        return new Promise((resolve, reject) => {
            let thinking = ''
            let content = ''

            this.streamGenerate(prompt, {
                onThinking: (text) => { thinking += text },
                onContent: (text) => { content += text },
                onError: reject,
                onComplete: () => resolve({ thinking: thinking || undefined, content })
            })
        })
    }
}

// Singleton instance
let codexService: CodexService | null = null

export function getCodexService(): CodexService {
    if (!codexService) {
        codexService = new CodexService()
    }
    return codexService
}
