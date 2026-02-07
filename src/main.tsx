import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { setupRuntimeCodexApi } from './runtime/codexApi'

async function bootstrap() {
    await setupRuntimeCodexApi()
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    )
}

void bootstrap()
