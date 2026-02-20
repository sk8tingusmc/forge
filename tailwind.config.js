/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // GitHub dark theme tokens
        bg: '#0d1117',
        surface: '#161b22',
        'surface-hover': '#1c2128',
        'border-primary': '#21262d',
        'border-subtle': '#30363d',
        'text-primary': '#e6edf3',
        'text-secondary': '#8b949e',
        'text-muted': '#484f58',
        // Agent brand colors
        'agent-claude': '#60a5fa',
        'agent-gemini': '#a855f7',
        'agent-codex': '#22c55e',
        'agent-copilot': '#f97316',
        'agent-qwen': '#ec4899',
        'agent-llm': '#10b981',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
