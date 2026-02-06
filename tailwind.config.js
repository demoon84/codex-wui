/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Antigravity exact color palette
                bg: {
                    deep: '#121212',
                    sidebar: '#0d0d0d',
                    card: '#1e1e1e',
                    hover: '#252525',
                    input: '#1a1a1a',
                },
                text: {
                    primary: '#e5e5e5',
                    secondary: '#a0a0a0',
                    muted: '#666666',
                },
                border: {
                    DEFAULT: '#2a2a2a',
                    subtle: '#1f1f1f',
                    hover: '#333333',
                },
                primary: {
                    DEFAULT: '#10a37f',
                    400: '#1bc498',
                    500: '#10a37f',
                    600: '#0d8a6a',
                },
            },
            animation: {
                'fade-in': 'fadeIn 0.3s ease-out forwards',
                'slide-up': 'slideUp 0.3s ease-out forwards',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
            },
        },
    },
    plugins: [],
}
