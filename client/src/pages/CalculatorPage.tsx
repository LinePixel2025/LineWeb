import { useState, useCallback, useEffect, useRef } from 'react'

type Operator = '+' | '-' | '*' | '/' | null

function calc(a: number, b: number, op: Operator): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b !== 0 ? a / b : NaN
    default: return b
  }
}

function formatDisplay(n: number): string {
  if (!isFinite(n)) return 'Error'
  const s = String(n)
  if (s.length > 14) return n.toExponential(6)
  return s
}

export default function CalculatorPage() {
  const [display, setDisplay] = useState('0')
  const [prevValue, setPrevValue] = useState<number | null>(null)
  const [operator, setOperator] = useState<Operator>(null)
  const [waitingForOperand, setWaitingForOperand] = useState(false)
  const [expression, setExpression] = useState('')
  const [justCalculated, setJustCalculated] = useState(false)
  const displayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (displayRef.current) {
      displayRef.current.scrollLeft = displayRef.current.scrollWidth
    }
  }, [display])

  const inputDigit = useCallback((digit: string) => {
    if (justCalculated) {
      setDisplay(digit)
      setExpression('')
      setPrevValue(null)
      setOperator(null)
      setJustCalculated(false)
      setWaitingForOperand(false)
      return
    }
    if (waitingForOperand) {
      setDisplay(digit)
      setWaitingForOperand(false)
    } else {
      setDisplay(p => {
        if (p === '0' && digit !== '.') return digit
        if (p.replace(/[^0-9.]/g, '').length >= 15) return p
        return p + digit
      })
    }
  }, [waitingForOperand, justCalculated])

  const inputDecimal = useCallback(() => {
    if (justCalculated) {
      setDisplay('0.')
      setExpression('')
      setPrevValue(null)
      setOperator(null)
      setJustCalculated(false)
      setWaitingForOperand(false)
      return
    }
    if (waitingForOperand) {
      setDisplay('0.')
      setWaitingForOperand(false)
      return
    }
    if (!display.includes('.')) setDisplay(p => p + '.')
  }, [display, waitingForOperand, justCalculated])

  const clear = useCallback(() => {
    setDisplay('0')
    setPrevValue(null)
    setOperator(null)
    setWaitingForOperand(false)
    setExpression('')
    setJustCalculated(false)
  }, [])

  const backspace = useCallback(() => {
    if (justCalculated || waitingForOperand) return
    setDisplay(p => p.length > 1 ? p.slice(0, -1) : '0')
  }, [justCalculated, waitingForOperand])

  const performOperation = useCallback((nextOperator: Operator) => {
    setJustCalculated(false)
    const cur = parseFloat(display)
    if (prevValue === null) {
      setPrevValue(cur)
      setExpression(`${cur} ${nextOperator}`)
    } else if (operator) {
      const r = calc(prevValue, cur, operator)
      if (!isFinite(r)) {
        setDisplay('Error')
        setPrevValue(null)
        setOperator(null)
        setWaitingForOperand(true)
        setExpression('')
        return
      }
      setDisplay(formatDisplay(r))
      setPrevValue(r)
      setExpression(`${formatDisplay(r)} ${nextOperator}`)
    } else {
      setExpression(`${prevValue} ${nextOperator}`)
    }
    setWaitingForOperand(true)
    setOperator(nextOperator)
  }, [display, prevValue, operator])

  const equals = useCallback(() => {
    if (prevValue === null || operator === null) {
      if (!justCalculated) setJustCalculated(true)
      return
    }
    const cur = parseFloat(display)
    const r = calc(prevValue, cur, operator)
    if (!isFinite(r)) {
      setDisplay('Error')
      setExpression(`${prevValue} ${operator} ${cur} =`)
      setPrevValue(null)
      setOperator(null)
      setWaitingForOperand(true)
      setJustCalculated(false)
      return
    }
    setExpression(`${prevValue} ${operator} ${cur} =`)
    setDisplay(formatDisplay(r))
    setPrevValue(r)
    setOperator(null)
    setWaitingForOperand(true)
    setJustCalculated(true)
  }, [display, prevValue, operator, justCalculated])

  const percentage = useCallback(() => {
    const v = parseFloat(display)
    if (prevValue !== null && operator) {
      const pct = prevValue * (v / 100)
      setDisplay(formatDisplay(pct))
    } else {
      setDisplay(String(v / 100))
    }
    setJustCalculated(false)
  }, [display, prevValue, operator])

  const negate = useCallback(() => {
    if (display === '0') return
    setDisplay(p => p.startsWith('-') ? p.slice(1) : '-' + p)
    setJustCalculated(false)
  }, [display])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key >= '0' && e.key <= '9') { inputDigit(e.key); return }
      if (e.key === '.') { inputDecimal(); return }
      if (e.key === '+') { performOperation('+'); return }
      if (e.key === '-') { performOperation('-'); return }
      if (e.key === '*') { performOperation('*'); return }
      if (e.key === '/') { e.preventDefault(); performOperation('/'); return }
      if (e.key === 'Enter' || e.key === '=') { equals(); return }
      if (e.key === 'Backspace') { backspace(); return }
      if (e.key === 'Escape') { clear(); return }
      if (e.key === '%') { percentage(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [inputDigit, inputDecimal, performOperation, equals, backspace, clear, percentage])

  return (
    <div className="gh-page-container">
      <div className="gh-box" style={{ maxWidth: '360px', margin: '0 auto', padding: '20px' }}>
        <div className="calc-display-wrap">
          <div className="calc-expression">
            {expression || '\u00A0'}
          </div>
          <div className="calc-display" ref={displayRef}>
            {display}
          </div>
        </div>

        <div className="calc-grid">
          <CalcBtn label="AC" onClick={clear} variant="fn" />
          <CalcBtn label="⌫" onClick={backspace} variant="fn" />
          <CalcBtn label="%" onClick={percentage} variant="fn" />
          <CalcBtn label="÷" onClick={() => performOperation('/')} variant="op" />

          <CalcBtn label="7" onClick={() => inputDigit('7')} />
          <CalcBtn label="8" onClick={() => inputDigit('8')} />
          <CalcBtn label="9" onClick={() => inputDigit('9')} />
          <CalcBtn label="×" onClick={() => performOperation('*')} variant="op" />

          <CalcBtn label="4" onClick={() => inputDigit('4')} />
          <CalcBtn label="5" onClick={() => inputDigit('5')} />
          <CalcBtn label="6" onClick={() => inputDigit('6')} />
          <CalcBtn label="−" onClick={() => performOperation('-')} variant="op" />

          <CalcBtn label="1" onClick={() => inputDigit('1')} />
          <CalcBtn label="2" onClick={() => inputDigit('2')} />
          <CalcBtn label="3" onClick={() => inputDigit('3')} />
          <CalcBtn label="+" onClick={() => performOperation('+')} variant="op" />

          <CalcBtn label="±" onClick={negate} variant="fn" />
          <CalcBtn label="0" onClick={() => inputDigit('0')} />
          <CalcBtn label="." onClick={inputDecimal} />
          <CalcBtn label="=" onClick={equals} variant="eq" />
        </div>
      </div>
    </div>
  )
}

function CalcBtn({ label, onClick, variant = 'num' }: {
  label: string
  onClick: () => void
  variant?: 'num' | 'fn' | 'op' | 'eq'
}) {
  return (
    <button
      className={`calc-btn calc-btn--${variant}`}
      onClick={onClick}
      aria-label={label}
    >
      {label}
    </button>
  )
}
