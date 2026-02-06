// Material Theme style file icons with rich colors
import { getIconForFile } from 'vscode-icons-js'

interface FileIconProps {
    filename: string
    isFolder?: boolean
    className?: string
}

// Material Theme inspired icon colors
const ICON_COLORS: Record<string, string> = {
    // JavaScript/TypeScript
    'js': '#f7df1e',
    'jsx': '#61dafb',
    'ts': '#3178c6',
    'tsx': '#3178c6',
    'mjs': '#f7df1e',
    'cjs': '#f7df1e',

    // Web
    'html': '#e34f26',
    'htm': '#e34f26',
    'css': '#1572b6',
    'scss': '#cf649a',
    'sass': '#cf649a',
    'less': '#1d365d',

    // Config
    'json': '#cbcb41',
    'yaml': '#cb171e',
    'yml': '#cb171e',
    'toml': '#9c4121',
    'xml': '#e34f26',
    'env': '#ecd53f',

    // Markdown/Docs
    'md': '#083fa1',
    'mdx': '#1b1f24',
    'txt': '#6d8086',
    'pdf': '#ff0000',

    // Images
    'png': '#a074c4',
    'jpg': '#a074c4',
    'jpeg': '#a074c4',
    'gif': '#a074c4',
    'svg': '#ffb13b',
    'ico': '#cbcb41',
    'webp': '#a074c4',

    // Backend
    'py': '#3572a5',
    'rb': '#cc342d',
    'php': '#777bb4',
    'java': '#b07219',
    'go': '#00add8',
    'rs': '#dea584',
    'c': '#555555',
    'cpp': '#f34b7d',
    'h': '#555555',
    'hpp': '#f34b7d',
    'cs': '#178600',
    'swift': '#f05138',
    'kt': '#a97bff',

    // Shell
    'sh': '#89e051',
    'bash': '#89e051',
    'zsh': '#89e051',
    'fish': '#89e051',
    'ps1': '#012456',

    // Data
    'sql': '#e38c00',
    'db': '#e38c00',
    'sqlite': '#003b57',
    'csv': '#237346',

    // Package managers
    'lock': '#cb3837',

    // Git
    'gitignore': '#f14e32',
    'gitattributes': '#f14e32',

    // Docker
    'dockerfile': '#2496ed',

    // Config files
    'eslintrc': '#4b32c3',
    'prettierrc': '#56b3b4',
    'babelrc': '#f5da55',
    'editorconfig': '#e0efef',

    // Default
    'default': '#6d8086',
}

// Special filename mappings
const SPECIAL_FILES: Record<string, { icon: string; color: string }> = {
    'package.json': { icon: 'npm', color: '#cb3837' },
    'package-lock.json': { icon: 'npm', color: '#cb3837' },
    'tsconfig.json': { icon: 'ts', color: '#3178c6' },
    'tailwind.config.js': { icon: 'tailwind', color: '#38bdf8' },
    'tailwind.config.ts': { icon: 'tailwind', color: '#38bdf8' },
    'vite.config.js': { icon: 'vite', color: '#646cff' },
    'vite.config.ts': { icon: 'vite', color: '#646cff' },
    'postcss.config.js': { icon: 'postcss', color: '#dd3a0a' },
    '.gitignore': { icon: 'git', color: '#f14e32' },
    '.env': { icon: 'env', color: '#ecd53f' },
    '.env.local': { icon: 'env', color: '#ecd53f' },
    'README.md': { icon: 'readme', color: '#083fa1' },
    'LICENSE': { icon: 'license', color: '#d4af37' },
    'Dockerfile': { icon: 'docker', color: '#2496ed' },
    'docker-compose.yml': { icon: 'docker', color: '#2496ed' },
}

// SVG icons for common file types
const FILE_ICONS: Record<string, (color: string) => JSX.Element> = {
    // TypeScript
    ts: (color) => (
        <svg viewBox="0 0 24 24" fill={color}>
            <path d="M3 3h18v18H3V3zm10.5 11.5v4h-2v-4H9v-1.5h5v1.5h-2.5zm3.5-1.5h2v5.5h-1.5v-4H14V13z" />
        </svg>
    ),
    // JavaScript
    js: (color) => (
        <svg viewBox="0 0 24 24" fill={color}>
            <path d="M3 3h18v18H3V3zm7.5 13.5c0 1.5-1 2.5-2.5 2.5s-2-1-2-1l1-1.5s.5.5 1 .5.5-.5.5-1v-4h2v4.5zm5.5 2.5c-1.5 0-2.5-.5-3-1.5l1.5-1c.25.5.75 1 1.5 1s1-.25 1-.75-.5-.75-1.25-1C14.25 15 13 14.5 13 13c0-1.5 1.25-2.5 2.75-2.5 1.25 0 2 .5 2.5 1.25l-1.5 1c-.25-.5-.5-.75-1-.75s-.75.25-.75.5c0 .5.5.75 1.5 1.25 1.25.5 2 1.25 2 2.5 0 1.5-1.5 2.75-3 2.75z" />
        </svg>
    ),
    // JSON
    json: (color) => (
        <svg viewBox="0 0 24 24" fill={color}>
            <path d="M5 3h2v2H5v5a2 2 0 01-2 2 2 2 0 012 2v5h2v2H5c-1.1 0-2-.9-2-2v-4c0-.55-.45-1-1-1H1v-2h1c.55 0 1-.45 1-1V5c0-1.1.9-2 2-2m14 0c1.1 0 2 .9 2 2v4c0 .55.45 1 1 1h1v2h-1c-.55 0-1 .45-1 1v4c0 1.1-.9 2-2 2h-2v-2h2v-5c0-1.1.9-2 2-2-1.1 0-2-.9-2-2V5h-2V3h2m-7 12a1 1 0 110 2 1 1 0 010-2m-4 0a1 1 0 110 2 1 1 0 010-2m8 0a1 1 0 110 2 1 1 0 010-2z" />
        </svg>
    ),
    // Folder
    folder: (color) => (
        <svg viewBox="0 0 24 24" fill={color}>
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
        </svg>
    ),
    // Default file
    file: (color) => (
        <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
            <path d="M14 2v6h6" />
        </svg>
    ),
}

export function FileIcon({ filename, isFolder = false, className = 'w-4 h-4' }: FileIconProps) {
    // Check for special files first
    const lowerFilename = filename.toLowerCase()
    const specialFile = SPECIAL_FILES[lowerFilename] || SPECIAL_FILES[filename]

    if (specialFile) {
        const IconComponent = FILE_ICONS[specialFile.icon] || FILE_ICONS.file
        return (
            <span className={`inline-flex flex-shrink-0 ${className}`}>
                {IconComponent(specialFile.color)}
            </span>
        )
    }

    if (isFolder) {
        return (
            <span className={`inline-flex flex-shrink-0 ${className}`}>
                {FILE_ICONS.folder('#90a4ae')}
            </span>
        )
    }

    // Get extension
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const color = ICON_COLORS[ext] || ICON_COLORS.default

    // Try to get vscode-icons icon name
    const iconName = getIconForFile(filename)

    // Use CDN for vscode-icons if available
    if (iconName) {
        return (
            <span className={`inline-flex flex-shrink-0 ${className}`}>
                <img
                    src={`https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/icons/${iconName}`}
                    alt={filename}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                        // Fallback to colored dot
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        target.parentElement!.innerHTML = `<span style="width:100%;height:100%;border-radius:2px;background:${color};display:block;"></span>`
                    }}
                />
            </span>
        )
    }

    // Fallback: colored extension indicator
    return (
        <span className={`inline-flex flex-shrink-0 items-center justify-center ${className}`}>
            <span
                className="w-full h-full rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
                style={{ backgroundColor: color }}
            >
                {ext.slice(0, 2).toUpperCase()}
            </span>
        </span>
    )
}

// Get icon color for extension
export function getFileColor(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    return ICON_COLORS[ext] || ICON_COLORS.default
}
