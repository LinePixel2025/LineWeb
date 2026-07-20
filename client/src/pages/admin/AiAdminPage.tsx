import { useState, useEffect, useCallback } from 'react'
import LiquidGlass from '../../components/glass/LiquidGlass'
import api from '../../lib/api'

interface AiConfigData {
  id: number
  provider: string
  model: string
  apiKey: string       // 脱敏后的 key（sk-…xxxx）
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

  // 表单状态
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('gpt-4o-mini')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [isEnabled, setIsEnabled] = useState(false)
  const [formError, setFormError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  // 是否显示 API Key 明文输入（保存后脱敏，用户再加新 chunk 才能改）
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

  // 切换提供商时自动填充默认 Base URL 和模型
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
    if (!apiKey.trim() && !apiKeyModified) {
      // apiKey 为空且未修改，说明原配置就没有 key
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
      // 如果用户修改了 API Key（输入了新值），才发送
      if (apiKeyModified && apiKey.trim()) {
        body.apiKey = apiKey.trim()
      }

      const result = await api.put<AiConfigData>('/ai/config', body)
      setConfig(result)
      setApiKey(result.apiKey)
      setApiKeyModified(false)
      setSavedMsg('✅ 配置已保存')
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-spinner"><div className="spinner" /></div>
      </div>
    )
  }

  const preset = PROVIDER_PRESETS.find(p => p.value === provider)
  const modelOptions = preset && preset.models.length > 0
    ? preset.models
    : (model ? [model] : [])

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">AI 助手配置</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              fontSize: '0.8rem',
              padding: '3px 10px',
              borderRadius: '9999px',
              background: isEnabled ? 'rgba(82,196,26,0.2)' : 'rgba(255,255,255,0.06)',
              color: isEnabled ? '#52c41a' : 'var(--lg-text-tertiary)',
              fontWeight: 500,
            }}
          >
            {isEnabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      <LiquidGlass variant="blur" className="admin-page-table-wrap" style={{ padding: 'var(--lg-space-6)' }}>
        {/* 启用开关 */}
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>启用 AI 助手</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--lg-text-tertiary)' }}>
              开启后，网站首页右下角将显示 AI 聊天按钮
            </div>
          </div>
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            style={{
              width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer',
              background: isEnabled ? 'var(--lg-accent)' : 'rgba(255,255,255,0.12)',
              position: 'relative', transition: 'background var(--lg-transition)',
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
                transition: 'left var(--lg-transition)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            />
          </button>
        </div>

        {/* 提供商选择 */}
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>AI 提供商</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {PROVIDER_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => handleProviderChange(p.value)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: provider === p.value ? '1.5px solid var(--lg-accent)' : '1px solid rgba(255,255,255,0.1)',
                  background: provider === p.value ? 'rgba(41,151,255,0.1)' : 'rgba(255,255,255,0.04)',
                  color: provider === p.value ? 'var(--lg-accent)' : 'var(--lg-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: provider === p.value ? 600 : 400,
                  transition: 'all var(--lg-transition)',
                  fontFamily: 'var(--lg-font)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 模型名称 */}
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>模型</label>
          {modelOptions.length > 0 ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {modelOptions.map(m => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: model === m ? '1.5px solid var(--lg-accent)' : '1px solid rgba(255,255,255,0.1)',
                    background: model === m ? 'rgba(41,151,255,0.1)' : 'rgba(255,255,255,0.04)',
                    color: model === m ? 'var(--lg-accent)' : 'var(--lg-text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontFamily: 'var(--lg-font-mono), monospace',
                    transition: 'all var(--lg-transition)',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : null}
          <input
            className="admin-modal-input"
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={provider === 'custom' ? '输入模型名称，如 gpt-4o-mini' : '自定义模型名（可选）'}
            style={{ marginTop: modelOptions.length > 0 ? '0' : '0' }}
          />
        </div>

        {/* API Key */}
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>API Key</label>
          <input
            className="admin-modal-input"
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
          <div style={{ fontSize: '0.78rem', color: 'var(--lg-text-tertiary)', marginTop: '4px' }}>
            {config?.apiKey && !apiKeyModified
              ? `当前: ${config.apiKey}`
              : 'API Key 仅保存在服务器，不会暴露给前端'}
          </div>
        </div>

        {/* Base URL */}
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Base URL（可选）</label>
          <input
            className="admin-modal-input"
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={provider === 'openai' ? '默认 https://api.openai.com/v1' : '自定义 API 端点（用于代理/中转）'}
          />
          <div style={{ fontSize: '0.78rem', color: 'var(--lg-text-tertiary)', marginTop: '4px' }}>
            留空使用官方默认端点；使用代理时填写中转地址
          </div>
        </div>

        {/* System Prompt */}
        <div style={{ marginBottom: '24px' }}>
          <label style={labelStyle}>System Prompt</label>
          <textarea
            className="admin-modal-input"
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={5}
            style={{ resize: 'vertical', minHeight: '100px', fontFamily: 'var(--lg-font)' }}
            placeholder="输入系统提示词…"
          />
          <div style={{ fontSize: '0.78rem', color: 'var(--lg-text-tertiary)', marginTop: '4px' }}>
            系统会自动在末尾拼接当前网站的文章列表和页面信息作为上下文
          </div>
        </div>

        {/* 错误 & 成功提示 */}
        {formError && (
          <div style={{ color: 'var(--lg-text-danger)', fontSize: '0.85rem', marginBottom: '16px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,77,79,0.1)' }}>
            {formError}
          </div>
        )}
        {savedMsg && (
          <div style={{ color: '#52c41a', fontSize: '0.85rem', marginBottom: '16px' }}>
            {savedMsg}
          </div>
        )}

        {/* 保存按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={saving || !model.trim()}
            style={{
              padding: '10px 28px',
              borderRadius: '9999px',
              fontWeight: 600,
              fontSize: '0.9rem',
              background: saving ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, var(--lg-accent), #40a9ff)',
              color: '#fff',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--lg-font)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </LiquidGlass>

      {/* 提示信息 */}
      <LiquidGlass variant="blur" style={{ padding: 'var(--lg-space-5)', marginTop: '20px' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--lg-text-tertiary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: 'var(--lg-text-secondary)', marginBottom: '8px' }}>💡 配置说明</div>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <li><strong>OpenAI</strong>：使用 OpenAI 官方 API，需在 platform.openai.com 获取 Key</li>
            <li><strong>DeepSeek</strong>：国产高性价比模型，在 platform.deepseek.com 获取 Key</li>
            <li><strong>通义千问</strong>：阿里云模型，在 dashscope.aliyun.com 获取 Key</li>
            <li><strong>自定义</strong>：任何兼容 OpenAI API 格式的服务（如 OneAPI、LobeHub 等中转）</li>
            <li>配置保存后即刻生效，无需重启服务</li>
            <li>AI 会自动获取网站的公开文章和页面信息作为回答上下文</li>
          </ul>
        </div>
      </LiquidGlass>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontWeight: 600,
  fontSize: '0.9rem',
  color: 'var(--lg-text-secondary)',
}
