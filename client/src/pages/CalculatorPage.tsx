import { useState, useCallback } from 'react'

type Operator = '+' | '-' | '*' | '/' | null

export default function CalculatorPage() {
  const [display, setDisplay] = useState('0')
  const [prevValue, setPrevValue] = useState<number | null>(null)
  const [operator, setOperator] = useState<Operator>(null)
  const [waitingForOperand, setWaitingForOperand] = useState(false)

  const inputDigit = useCallback((digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit)
      setWaitingForOperand(false)
    } else {
      setDisplay(p => p === '0' ? digit : p + digit)
    }
  }, [waitingForOperand])

  const inputDecimal = useCallback(() => {
    if (waitingForOperand) { setDisplay('0.'); setWaitingForOperand(false); return }
    if (!display.includes('.')) setDisplay(p => p + '.')
  }, [display, waitingForOperand])

  const clear = useCallback(() => {
    setDisplay('0'); setPrevValue(null); setOperator(null); setWaitingForOperand(false)
  }, [])

  const performOperation = useCallback((nextOperator: Operator) => {
    const cur = parseFloat(display)
    if (prevValue === null) {
      setPrevValue(cur)
    } else if (operator) {
      const r = calc(prevValue, cur, operator)
      setDisplay(String(r))
      setPrevValue(r)
    }
    setWaitingForOperand(true)
    setOperator(nextOperator)
  }, [display, prevValue, operator])

  const equals = useCallback(() => {
    const cur = parseFloat(display)
    if (prevValue === null || operator === null) return
    const r = calc(prevValue, cur, operator)
    setDisplay(String(r)); setPrevValue(null); setOperator(null); setWaitingForOperand(true)
  }, [display, prevValue, operator])

  const percentage = () => setDisplay(p => String(parseFloat(p) / 100))
  const negate = () => setDisplay(p => String(-parseFloat(p)))
  const clearEntry = () => setDisplay('0')

  return (
    <div className="page container" style={{ display: 'flex', justifyContent: 'center', paddingTop: 'calc(var(--lg-nav-height) + 40px)' }}>
      <div className="lg-surface-strong" style={{
        width: '100%', maxWidth: '340px', padding: '24px',
        animation: 'glassRise 0.5s ease-out',
      }}>
        {/* Display */}
        <div style={{
          textAlign: 'right', padding: '20px 8px 16px', marginBottom: '12px',
          minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        }}>
          <div className="text-tertiary" style={{ fontSize: '0.85rem', minHeight: '20px' }}>
            {prevValue !== null && `${prevValue} ${operator || ''}`}
          </div>
          <div style={{
            fontSize: 'clamp(1.8rem, 8vw, 2.8rem)', fontWeight: 300,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'var(--lg-text-primary)',
          }}>
            {display}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          <CalBtn label="AC" onClick={clear} variant="fn" />
          <CalBtn label="C" onClick={clearEntry} variant="fn" />
          <CalBtn label="%" onClick={percentage} variant="fn" />
          <CalBtn label="÷" onClick={() => performOperation('/')} variant="op" />
          <CalBtn label="7" onClick={() => inputDigit('7')} />
          <CalBtn label="8" onClick={() => inputDigit('8')} />
          <CalBtn label="9" onClick={() => inputDigit('9')} />
          <CalBtn label="×" onClick={() => performOperation('*')} variant="op" />
          <CalBtn label="4" onClick={() => inputDigit('4')} />
          <CalBtn label="5" onClick={() => inputDigit('5')} />
          <CalBtn label="6" onClick={() => inputDigit('6')} />
          <CalBtn label="−" onClick={() => performOperation('-')} variant="op" />
          <CalBtn label="1" onClick={() => inputDigit('1')} />
          <CalBtn label="2" onClick={() => inputDigit('2')} />
          <CalBtn label="3" onClick={() => inputDigit('3')} />
          <CalBtn label="+" onClick={() => performOperation('+')} variant="op" />
          <CalBtn label="±" onClick={negate} variant="fn" />
          <CalBtn label="0" onClick={() => inputDigit('0')} />
          <CalBtn label="." onClick={inputDecimal} />
          <CalBtn label="=" onClick={equals} variant="eq" />
        </div>
      </div>
    </div>
  )
}

function CalBtn({ label, onClick, variant = 'num' }: {
  label: string; onClick: () => void; variant?: 'num' | 'fn' | 'op' | 'eq'
}) {
  const isEq = variant === 'eq'
  return (
    <button
      onClick={onClick}
      style={{
        background: isEq ? 'linear-gradient(135deg, var(--lg-accent), #40a9ff)' : 'var(--lg-glass-bg)',
        color: isEq ? 'white' : variant === 'op' ? 'var(--lg-accent)' : 'var(--lg-text-primary)',
        border: isEq ? 'none' : '1px solid var(--lg-glass-border)',
        borderRadius: '9999px',
        padding: '16px 0',
        fontSize: '1.15rem',
        fontWeight: variant === 'fn' ? 400 : 500,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        fontFamily: 'var(--lg-font)',
        boxShadow: isEq ? '0 2px 8px var(--lg-accent-glow)' : 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.15)' }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
    >
      {label}
    </button>
  )
}

function calc(a: number, b: number, op: Operator): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b !== 0 ? a / b : NaN
    default: return b
  }
}
