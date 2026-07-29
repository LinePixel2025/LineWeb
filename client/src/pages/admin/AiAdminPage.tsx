import { useState, useEffect, useCallback } from 'react'
import { GitHubButton, GitHubAlert } from '../../components/ui'
import api from '../../lib/api'

interface AiConfigData {
  id: number
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  systemPrompt: string
  isEnabled: boolean
  updatedAt: string
}

const PROVIDER_PRESETS: { value: string; label: string; models: string[]; baseUrl?: string }[] = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'], baseUrl: 'https://api.deepseek.com' },
  { value: 'qwen', label: '通义千问', models: ['qwen-turbo', 'qwen-plus', 'qwen-max'], baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'custom', label: '自定义', models: [] },
]

const DEFAULT_SYSTEM_PROMPT = `你是 LineWeb 网站的 AI 助手，你可以回答关于网站内容、文章、功能等问题。请用中文回答，保持友好、专业的语气。如果用户问到网站没有的信息，请如实告知。`

export default function AiAdminPage() {
  const [config, setConfig] = useState<AiConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4o-mini')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [isEnabled, setIsEnabled] = useState(false)
  const [formError, setFormError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const [apiKeyModified, setApiKeyModified] = useState(false)

  const fetchConfig = useCallback(() => {
    setLoading(true)
    api.get<AiConfigData>('/ai/config')
      .then(cfg => {
        setConfig(cfg)
        setProvider(cfg.provider)
        setModel(cfg.model)
        setApiKey(cfg.apiKey)
        setBaseUrl(cfg.baseUrl || '')
        setSystemPrompt(cfg.systemPrompt)
        setIsEnabled(cfg.isEnabled)
        setApiKeyModified(false)
      })
      .catch(err => {
        console.error('获取 AI 配置失败:', err)
        setFormError('获取配置失败：' + (err instanceof Error ? err.message : '未知错误'))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const handleProviderChange = (value: string) => {
    setProvider(value)
    const preset = PROVIDER_PRESETS.find(p => p.value === value)
    if (preset?.baseUrl && !baseUrl) {
      setBaseUrl(preset.baseUrl)
    }
    if (preset && preset.models.length > 0 && (!model || model === getCurrentPresetDefaultModel())) {
      setModel(preset.models[0])
    }
  }

  const getCurrentPresetDefaultModel = () => {
    const preset = PROVIDER_PRESETS.find(p => p.value === provider)
    return preset?.models[0] || ''
  }

  const handleSave = async () => {
    if (!model.trim()) {
      setFormError('请输入模型名称')
      return
    }
    setSaving(true)
    setFormError('')
    setSavedMsg('')

    try {
      const body: Record<string, unknown> = {
        provider: provider.trim(),
        model: model.trim(),
        systemPrompt: systemPrompt.trim(),
        isEnabled,
      }
      if (baseUrl.trim()) {
        body.baseUrl = baseUrl.trim()
      } else {
        body.baseUrl = null
      }
      if (apiKeyModified && apiKey.trim()) {
        body.apiKey = apiKey.trim()
      }

      const result = await api.put<AiConfigData>('/ai/config', body)
      setConfig(result)
      setApiKey(result.apiKey)
      setApiKeyModified(false)
      setSavedMsg('配置已保存')
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--gh-space-7)' }}>
        <div className="gh-spinner" />
      </div>
    )
  }

  const preset = PROVIDER_PRESETS.find(p => p.value === provider)
  const modelOptions = preset && preset.models.length > 0
    ? preset.models
    : (model ? [model] : [])

  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 'var(--gh-space-2)',
    fontWeight: 600, fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text)',
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 'var(--gh-text-sm)',
    fontFamily: 'var(--gh-font)',
    color: 'var(--gh-text)',
    background: 'var(--gh-canvas)',
    border: '1px solid var(--gh-border)',
    borderRadius: 'var(--gh-radius)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>AI 助手配置</h1>
          <p>配置网站 AI 聊天助手</p>
        </div>
        <span style={{
          fontSize: 'var(--gh-text-xs)', fontWeight: 500, padding: '3px 10px',
          borderRadius: 'var(--gh-radius)',
          background: isEnabled ? 'var(--gh-success-soft)' : 'var(--gh-canvas-inset)',
          color: isEnabled ? 'var(--gh-success)' : 'var(--gh-text-tertiary)',
        }}>
          {isEnabled ? '已启用' : '已禁用'}
        </span>
      </div>

      <div className="gh-box">
        {/* 启用开关 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 'var(--gh-space-5)', paddingBottom: 'var(--gh-space-4)',
          borderBottom: '1px solid var(--gh-border-muted)',
        }}>
          <div>
            <div style={{ fontWeight: 600 }}>启用 AI 助手</div>
            <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
              开启后，网站首页右下角将显示 AI 聊天按钮
            </div>
          </div>
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            style={{
              width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer',
              background: isEnabled ? 'var(--gh-accent)' : 'var(--gh-border)',
              position: 'relative', transition: 'background var(--gh-transition)',
              flexShrink: 0,
            }}
            aria-label={isEnabled ? '禁用 AI 助手' : '启用 AI 助手'}
          >
            <span
              style={{
                position: 'absolute', top: '3px',
                left: isEnabled ? '27px' : '3px',
                width: '22px', height: '22px', borderRadius: '50%',
                background: '#fff',
                transition: 'left var(--gh-transition)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            />
          </button>
        </div>

        {/* 提供商选择 */}
        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={labelStyle}>AI 提供商</label>
          <div style={{ display: 'flex', gap: 'var(--gh-space-2)', flexWrap: 'wrap' }}>
            {PROVIDER_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => handleProviderChange(p.value)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--gh-radius)',
                  border: provider === p.value ? '1.5px solid var(--gh-accent)' : '1px solid var(--gh-border)',
                  background: provider === p.value ? 'var(--gh-accent-soft)' : 'var(--gh-canvas)',
                  color: provider === p.value ? 'var(--gh-accent)' : 'var(--gh-text-secondary)',
                  cursor: 'pointer', fontSize: 'var(--gh-text-sm)',
                  fontWeight: provider === p.value ? 600 : 400,
                  fontFamily: 'var(--gh-font)',
                  transition: 'all var(--gh-transition)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 模型名称 */}
        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={labelStyle}>模型</label>
          {modelOptions.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--gh-space-2)', flexWrap: 'wrap', marginBottom: 'var(--gh-space-2)' }}>
              {modelOptions.map(m => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 'var(--gh-radius)',
                    border: model === m ? '1.5px solid var(--gh-accent)' : '1px solid var(--gh-border)',
                    background: model === m ? 'var(--gh-accent-soft)' : 'var(--gh-canvas)',
                    color: model === m ? 'var(--gh-accent)' : 'var(--gh-text-secondary)',
                    cursor: 'pointer', fontSize: 'var(--gh-text-xs)',
                    fontFamily: 'var(--gh-font-mono)',
                    transition: 'all var(--gh-transition)',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <input
            className="gh-input gh-input--full"
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={provider === 'custom' ? '输入模型名称，如 gpt-4o-mini' : '自定义模型名（可选）'}
          />
        </div>

        {/* API Key */}
        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={labelStyle}>API Key</label>
          <input
            className="gh-input gh-input--full"
            type="password"
            value={apiKey}
            onChange={e => {
              setApiKey(e.target.value)
              setApiKeyModified(true)
            }}
            onFocus={() => {
              if (!apiKeyModified) {
                setApiKey('')
                setApiKeyModified(true)
              }
            }}
            placeholder={config?.apiKey && !apiKeyModified ? '已设置（点击输入新 Key 替换）' : '输入 API Key'}
          />
          <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
            {config?.apiKey && !apiKeyModified
              ? `当前: ${config.apiKey}`
              : 'API Key 仅保存在服务器，不会暴露给前端'}
          </div>
        </div>

        {/* Base URL */}
        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={labelStyle}>Base URL（可选）</label>
          <input
            className="gh-input gh-input--full"
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={provider === 'openai' ? '默认 https://api.openai.com/v1' : '自定义 API 端点（用于代理/中转）'}
          />
          <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
            留空使用官方默认端点；使用代理时填写中转地址
          </div>
        </div>

        {/* System Prompt */}
        <div style={{ marginBottom: 'var(--gh-space-5)' }}>
          <label style={labelStyle}>System Prompt</label>
          <textarea
            className="gh-input gh-input--full"
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={5}
            style={{ resize: 'vertical', minHeight: '100px', fontFamily: 'var(--gh-font)' }}
            placeholder="输入系统提示词…"
          />
          <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
            系统会自动在末尾拼接当前网站的文章列表和页面信息作为上下文
          </div>
        </div>

        {/* 错误 & 成功提示 */}
        {formError && (
          <GitHubAlert variant="danger">{formError}</GitHubAlert>
        )}
        {savedMsg && (
          <GitHubAlert variant="success">{savedMsg}</GitHubAlert>
        )}

        {/* 保存按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--gh-space-4)' }}>
          <GitHubButton variant="primary" size="md" onClick={handleSave} disabled={saving || !model.trim()}>
            {saving ? '保存中…' : '保存配置'}
          </GitHubButton>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="gh-box" style={{ marginTop: 'var(--gh-space-4)' }}>
        <div style={{ fontSize: 'var(--gh-text-sm)', color: 'var(--gh-text-secondary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: 'var(--gh-text)', marginBottom: 'var(--gh-space-2)' }}>
            💡 配置说明
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <li><strong>OpenAI</strong>：使用 OpenAI 官方 API，需在 platform.openai.com 获取 Key</li>
            <li><strong>DeepSeek</strong>：国产高性价比模型，在 platform.deepseek.com 获取 Key</li>
            <li><strong>通义千问</strong>：阿里云模型，在 dashscope.aliyun.com 获取 Key</li>
            <li><strong>自定义</strong>：任何兼容 OpenAI API 格式的服务（如 OneAPI、LobeHub 等中转）</li>
            <li>配置保存后即刻生效，无需重启服务</li>
            <li>AI 会自动获取网站的公开文章和页面信息作为回答上下文</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
