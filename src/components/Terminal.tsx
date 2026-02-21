import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { CLI_COLORS } from '../constants'

interface TerminalProps {
  ptyId: string
  cliType: string
  active?: boolean
  onReady?: () => void
}

export default function Terminal({ ptyId, cliType, active = true, onReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const isAttachedRef = useRef(false)

  const accentColor = CLI_COLORS[cliType] ?? '#8b949e'

  // Initialize terminal once
  useEffect(() => {
    if (!containerRef.current || termRef.current) return

    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: accentColor,
        cursorAccent: '#0d1117',
        black: '#484f58',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ff7b72',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
        selectionBackground: '#264f78',
      },
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      scrollback: 10000,
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    const links = new WebLinksAddon((_, url) => window.shell.openExternal(url))

    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(links)

    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    // Forward keystrokes to PTY
    term.onData((data) => {
      window.shell.write(ptyId, data)
    })

    // Attach IPC data listener
    const offData = window.shell.onData((id: string, data: string) => {
      if (id === ptyId) term.write(data)
    })
    isAttachedRef.current = true

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (fitRef.current) {
        fitRef.current.fit()
        const dims = fitRef.current.proposeDimensions()
        if (dims) window.shell.resize(ptyId, dims.cols, dims.rows)
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)

    onReady?.()

    return () => {
      offData()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      isAttachedRef.current = false
    }
  }, [ptyId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Fit when becoming active
  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => {
        fitRef.current?.fit()
        const dims = fitRef.current?.proposeDimensions()
        if (dims) window.shell.resize(ptyId, dims.cols, dims.rows)
      }, 50)
    }
  }, [active, ptyId])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#0d1117' }}
    />
  )
}
