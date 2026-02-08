import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { setupRuntimeCodexApi } from './runtime/codexApi'
import { I18nProvider } from './i18n'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initGlobalErrorHandlers } from './utils/errorTracker'

initGlobalErrorHandlers()

async function bootstrap() {
    await setupRuntimeCodexApi()
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <ErrorBoundary>
                <I18nProvider>
                    <App />
                </I18nProvider>
            </ErrorBoundary>
        </React.StrictMode>,
    )
}

void bootstrap()
