import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { evaluateExpression, type AngleMode } from '../lib/calculator/evaluate'
import { formatCalculatorValue } from '../lib/calculator/format'
import {
  appendCalculatorHistory,
  clearCalculatorHistory,
  readCalculatorHistory,
  type CalculatorHistoryEntry,
} from '../lib/calculator/history'
import { CalculatorError } from '../lib/calculator/tokenizer'

interface KeySpec {
  label: string
  token?: string
  action?: 'equals' | 'clear' | 'backspace' | 'sign' | 'mplus' | 'mminus' | 'mr' | 'mc'
  variant?: 'num' | 'op' | 'fn' | 'eq' | 'mem' | 'sci'
  title?: string
}

const SCI_KEYS: KeySpec[] = [
  { label: 'sin', token: 'sin(', variant: 'sci' },
  { label: 'cos', token: 'cos(', variant: 'sci' },
  { label: 'tan', token: 'tan(', variant: 'sci' },
  { label: 'log', token: 'log(', variant: 'sci' },
  { label: 'ln', token: 'ln(', variant: 'sci' },
  { label: 'asin', token: 'asin(', variant: 'sci' },
  { label: 'acos', token: 'acos(', variant: 'sci' },
  { label: 'atan', token: 'atan(', variant: 'sci' },
  { label: '√', token: 'sqrt(', variant: 'sci' },
  { label: 'xʸ', token: '^', variant: 'sci' },
  { label: '(', token: '(', variant: 'sci' },
  { label: ')', token: ')', variant: 'sci' },
  { label: 'π', token: 'pi', variant: 'sci' },
  { label: 'e', token: 'e', variant: 'sci' },
  { label: 'n!', token: '!', variant: 'sci' },
  { label: 'MC', action: 'mc', variant: 'mem' },
  { label: 'MR', action: 'mr', variant: 'mem' },
  { label: 'M+', action: 'mplus', variant: 'mem' },
  { label: 'M−', action: 'mminus', variant: 'mem' },
  { label: 'AC', action: 'clear', variant: 'mem', title: '清空' },
]

const MAIN_KEYS: KeySpec[] = [
  { label: '7', token: '7', variant: 'num' },
  { label: '8', token: '8', variant: 'num' },
  { label: '9', token: '9', variant: 'num' },
  { label: '⌫', action: 'backspace', variant: 'fn', title: '退格' },
  { label: '÷', token: '/', variant: 'op' },
  { label: '4', token: '4', variant: 'num' },
  { label: '5', token: '5', variant: 'num' },
  { label: '6', token: '6', variant: 'num' },
  { label: '%', token: '%', variant: 'fn' },
  { label: '×', token: '*', variant: 'op' },
  { label: '1', token: '1', variant: 'num' },
  { label: '2', token: '2', variant: 'num' },
  { label: '3', token: '3', variant: 'num' },
  { label: '.', token: '.', variant: 'num' },
  { label: '−', token: '-', variant: 'op' },
  { label: '±', action: 'sign', variant: 'fn' },
  { label: '0', token: '0', variant: 'num' },
  { label: '(', token: '(', variant: 'fn' },
  { label: ')', token: ')', variant: 'fn' },
  { label: '+', token: '+', variant: 'op' },
]

export default function CalculatorPage() {
  const [expression, setExpression] = useState('')
  const [result, setResult] = useState('0')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<AngleMode>('DEG')
  const [memory, setMemory] = useState(0)
  const [history, setHistory] = useState<CalculatorHistoryEntry[]>(() => readCalculatorHistory())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [justEvaluated, setJustEvaluated] = useState(false)
  const [copied, setCopied] = useState(false)

  const currentValue = useCallback((): number | null => {
    if (!expression.trim()) return null
    try {
      return evaluateExpression(expression, mode)
    } catch {
      return null
    }
  }, [expression, mode])

  const calculate = useCallback(() => {
    if (!expression.trim()) return
    try {
      const value = evaluateExpression(expression, mode)
      const formatted = formatCalculatorValue(value)
      setResult(formatted)
      setError('')
      setJustEvaluated(true)
      setHistory((prev) => appendCalculatorHistory(prev, expression, formatted))
    } catch (err) {
      const message = err instanceof CalculatorError ? err.message : '表达式无法计算'
      setError(message)
      setResult('错误')
      setJustEvaluated(false)
    }
  }, [expression, mode])

  const applyKey = useCallback((key: KeySpec) => {
    setCopied(false)
    if (key.action === 'clear') {
      setExpression('')
      setResult('0')
      setError('')
      setJustEvaluated(false)
      return
    }
    if (key.action === 'backspace') {
      setExpression((prev) => prev.slice(0, -1))
      setError('')
      setJustEvaluated(false)
      return
    }
    if (key.action === 'sign') {
      setExpression((prev) => (prev.startsWith('-') ? prev.slice(1) : `-${prev}`))
      setError('')
      return
    }
    if (key.action === 'equals') {
      calculate()
      return
    }
    if (key.action === 'mc') {
      setMemory(0)
      return
    }
    if (key.action === 'mr') {
      if (!memory) return
      const text = formatCalculatorValue(memory)
      setExpression((prev) => (justEvaluated ? text : prev + text))
      setJustEvaluated(false)
      return
    }
    if (key.action === 'mplus' || key.action === 'mminus') {
      const value = currentValue() ?? (result !== '错误' ? Number(result) : null)
      if (value === null || !Number.isFinite(value)) return
      setMemory((prev) => key.action === 'mplus' ? prev + value : prev - value)
      return
    }
    if (!key.token) return

    const token = key.token
    const operator = ['+', '-', '*', '/', '^', '%', '!'].includes(token)
    const startsNew = justEvaluated && !operator
    setExpression((prev) => {
      if (token === 'pi' || token === 'e') {
        return `${startsNew ? '' : prev}${token === 'pi' ? 'π' : 'e'}`
      }
      if (justEvaluated && operator) {
        return `${result !== '错误' ? result : prev}${token}`
      }
      return startsNew ? token : prev + token
    })
    setJustEvaluated(false)
    setError('')
  }, [calculate, currentValue, justEvaluated, memory, result])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key
      const simple = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '+', '-', '*', '/', '^', '!', '%', '(', ')']
      if (simple.includes(key)) {
        event.preventDefault()
        applyKey({ label: key, token: key, variant: 'num' })
        return
      }
      if (key === 'Enter' || key === '=') {
        event.preventDefault()
        calculate()
        return
      }
      if (key === 'Backspace') {
        event.preventDefault()
        applyKey({ label: '⌫', action: 'backspace', variant: 'fn' })
        return
      }
      if (key === 'Escape') {
        event.preventDefault()
        applyKey({ label: 'AC', action: 'clear', variant: 'mem' })
        return
      }
      if (key.toLowerCase() === 'p') {
        event.preventDefault()
        applyKey({ label: 'π', token: 'pi', variant: 'sci' })
      }
      if (key.toLowerCase() === 'e') {
        event.preventDefault()
        applyKey({ label: 'e', token: 'e', variant: 'sci' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyKey, calculate])

  const copyResult = async () => {
    if (!result || result === '错误') return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('复制失败，请手动选择结果')
    }
  }

  const useHistory = (entry: CalculatorHistoryEntry) => {
    setExpression(entry.expression)
    setResult(entry.result)
    setError('')
    setJustEvaluated(true)
    setHistoryOpen(false)
  }

  return (
    <div className="gh-page-container">
      <div className="calc-shell">
        <header className="calc-header">
          <div>
            <p className="calc-eyebrow"><Link to="/">← 首页</Link></p>
            <h1 className="calc-title">科学计算器</h1>
            <p className="calc-subtitle">三角函数、对数、幂、阶乘、括号与记忆寄存器</p>
          </div>
          <div className="calc-header-actions">
            <button type="button" className="gh-badge gh-badge--accent" onClick={() => setMode((m) => m === 'DEG' ? 'RAD' : 'DEG')}>
              {mode}
            </button>
            {memory !== 0 && <span className="gh-badge" title="记忆寄存器">M</span>}
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => setHistoryOpen(true)}>
              历史
            </button>
          </div>
        </header>

        <div className="calc-display-wrap" aria-live="polite" role="status">
          <div className="calc-expression">{expression || '0'}</div>
          <div className="calc-display" title={result}>
            {error || result}
          </div>
          <div className="calc-display-meta">
            <button type="button" className="calc-copy" onClick={() => void copyResult()}>
              {copied ? '已复制' : '复制结果'}
            </button>
            <span>{mode} · {memory !== 0 ? 'M' : '无记忆'}</span>
          </div>
        </div>

        <div className="calc-sci-grid">
          {SCI_KEYS.map((key) => (
            <button
              key={`${key.label}-${key.action ?? key.token}`}
              type="button"
              className={`calc-btn calc-btn--${key.variant ?? 'fn'}`}
              aria-label={key.title ?? key.label}
              onClick={() => applyKey(key)}
            >
              {key.label}
            </button>
          ))}
        </div>

        <div className="calc-main-grid">
          {MAIN_KEYS.map((key) => (
            <button
              key={`${key.label}-${key.token ?? key.action}`}
              type="button"
              className={`calc-btn calc-btn--${key.variant ?? 'num'}`}
              aria-label={key.title ?? key.label}
              onClick={() => applyKey(key)}
            >
              {key.label}
            </button>
          ))}
          <button
            type="button"
            className="calc-btn calc-btn--eq calc-btn--equals"
            aria-label="等于"
            onClick={() => applyKey({ label: '=', action: 'equals', variant: 'eq' })}
          >
            =
          </button>
        </div>

        <p className="calc-note">
          DEG/RAD 仅影响三角函数与反三角函数；百分号为后缀 ÷100，阶乘仅支持 2–170 的整数。历史最多保存 50 条。
        </p>
      </div>

      {historyOpen && (
        <div className="gh-dialog-overlay" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setHistoryOpen(false)
        }}>
          <div className="gh-dialog" role="dialog" aria-modal="true" aria-label="计算历史">
            <h3 className="gh-dialog-title">计算历史</h3>
            {history.length === 0 ? (
              <p className="gh-text-secondary">还没有计算记录。</p>
            ) : (
              <div className="calc-history-list">
                {history.map((entry) => (
                  <button
                    key={`${entry.at}-${entry.expression}`}
                    type="button"
                    className="calc-history-item"
                    onClick={() => useHistory(entry)}
                  >
                    <span className="calc-history-expression">{entry.expression}</span>
                    <strong>{entry.result}</strong>
                  </button>
                ))}
              </div>
            )}
            <div className="gh-dialog-actions">
              {history.length > 0 && (
                <button
                  type="button"
                  className="gh-btn gh-btn--ghost gh-btn--md"
                  onClick={() => { clearCalculatorHistory(); setHistory([]) }}
                >
                  清空历史
                </button>
              )}
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => setHistoryOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
