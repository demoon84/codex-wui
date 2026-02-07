// Official VS Code theme color values
export interface Theme {
    id: string
    name: string
    colors: {
        bgDeep: string
        bgSidebar: string
        bgCard: string
        bgHover: string
        bgInput: string
        textPrimary: string
        textSecondary: string
        textMuted: string
        primary: string
        primaryDark: string
        border: string
        borderSubtle: string
        accent1: string
        accent2: string
        accent3: string
        statusBarBg: string
    }
}

export const THEMES: Theme[] = [
    // Light Mode
    {
        id: 'light',
        name: 'Light',
        colors: {
            bgDeep: '#F8F9FA',      // Main background - very light gray
            bgSidebar: '#EBEDF0',   // Sidebar - slightly darker
            bgCard: '#E4E6E9',      // Cards/bubbles - visible gray
            bgHover: '#D8DADD',     // Hover state
            bgInput: '#FFFFFF',     // Input fields - white
            textPrimary: '#1C1E21', // Primary text - near black
            textSecondary: '#606770', // Secondary text
            textMuted: '#8A8D91',   // Muted text
            primary: '#1877F2',     // Primary blue (Facebook-style)
            primaryDark: '#166FE5', // Darker blue
            border: '#CED0D4',      // Border color
            borderSubtle: '#E4E6E9', // Subtle border
            accent1: '#1877F2',     // Blue accent
            accent2: '#31A24C',     // Green accent
            accent3: '#FA383E',     // Red accent
            statusBarBg: '#1877F2', // Status bar - primary blue
        }
    },
    // Dark Mode
    {
        id: 'dark',
        name: 'Dark',
        colors: {
            bgDeep: '#1E1E1E',      // Main background - VS Code dark
            bgSidebar: '#252526',   // Sidebar - slightly lighter
            bgCard: '#2D2D2D',      // Cards/panels
            bgHover: '#3C3C3C',     // Hover state
            bgInput: '#3C3C3C',     // Input fields
            textPrimary: '#D4D4D4', // Primary text - light gray
            textSecondary: '#9CDCFE', // Secondary text - light blue
            textMuted: '#6A6A6A',   // Muted text
            primary: '#0078D4',     // Primary blue (VS Code blue)
            primaryDark: '#0066B8', // Darker blue
            border: '#3C3C3C',      // Border color
            borderSubtle: '#2D2D2D', // Subtle border
            accent1: '#569CD6',     // Blue accent
            accent2: '#4EC9B0',     // Teal accent
            accent3: '#CE9178',     // Orange accent
            statusBarBg: '#007ACC', // Status bar - blue
        }
    },
]

// Apply theme to CSS variables
export function applyTheme(theme: Theme): void {
    const root = document.documentElement
    root.style.setProperty('--color-bg-deep', theme.colors.bgDeep)
    root.style.setProperty('--color-bg-sidebar', theme.colors.bgSidebar)
    root.style.setProperty('--color-bg-card', theme.colors.bgCard)
    root.style.setProperty('--color-bg-hover', theme.colors.bgHover)
    root.style.setProperty('--color-bg-input', theme.colors.bgInput)
    root.style.setProperty('--color-text-primary', theme.colors.textPrimary)
    root.style.setProperty('--color-text-secondary', theme.colors.textSecondary)
    root.style.setProperty('--color-text-muted', theme.colors.textMuted)
    root.style.setProperty('--color-primary', theme.colors.primary)
    root.style.setProperty('--color-primary-dark', theme.colors.primaryDark)
    root.style.setProperty('--color-border', theme.colors.border)
    root.style.setProperty('--color-border-subtle', theme.colors.borderSubtle)

    // Store theme preference
    localStorage.setItem('selected-theme', theme.id)

    // Update Windows titleBarOverlay color
    if (window.codexApi?.updateTitleBarOverlay) {
        window.codexApi.updateTitleBarOverlay(theme.colors.bgSidebar, theme.colors.textSecondary)
    }
}

// Get saved theme or default
export function getSavedTheme(): Theme {
    const savedId = localStorage.getItem('selected-theme')
    return THEMES.find(t => t.id === savedId) || THEMES[0]
}
