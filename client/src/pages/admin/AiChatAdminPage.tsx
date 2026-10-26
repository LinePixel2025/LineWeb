import { useState, useEffect, useCallback } from 'react'
import { GitHubButton, GitHubAlert } from '../../components/ui'
import api from '../../lib/api'

/**
 * AI 对话（DeepSeek）设置页（/admin/ai-chat，能力 ai:configure）
 *
 * 与「AI 助手配置」（/admin/ai）相互独立：这里管理的是 /deepseek 对话页
 * 使用的模型、API Key 与每用户每日提问上限。
 */

interface AiChatConfigData {
  id: number
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  systemPrompt: string
  dailyLimit: number
  isEnabled: boolean
  searchEnabled: boolean
  searchProvider: string
  searchApiKey: string
  updatedAt: string
}

const SEARCH_PROVIDER_PRESETS: { value: string; label: string; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek 搜索', hint: 'DeepSeek 官方自研搜索（2026-10 开放，/v1/tools/search），可直接填写 DeepSeek API Key' },
  { value: 'bocha', label: '博查 Bocha', hint: '国内可用，中文结果好（open.bochaai.com 申请 Key）' },
  { value: 'tavily', label: 'Tavily', hint: '海外搜索 API（tavily.com 申请 tvly- 开头的 Key）' },
]

const PROVIDER_PRESETS: { value: string; label: string; models: string[]; baseUrl?: string }[] = [
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'], baseUrl: 'https://api.deepseek.com' },
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'], baseUrl: 'https://api.openai.com/v1' },
  { value: 'qwen', label: '通义千问', models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen-plus'], baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'custom', label: '自定义', models: [] },
]

export default function AiChatAdminPage() {
  const [config, setConfig] = useState<AiChatConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [provider, setProvider] = useState('deepseek')
  const [model, setModel] = useState('deepseek-chat')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [dailyLimit, setDailyLimit] = useState(20)
  const [isEnabled, setIsEnabled] = useState(false)
  const [searchEnabled, setSearchEnabled] = useState(false)
  const [searchProvider, setSearchProvider] = useState('bocha')
  const [searchApiKey, setSearchApiKey] = useState('')
  const [formError, setFormError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const [apiKeyModified, setApiKeyModified] = useState(false)
  const [searchApiKeyModified, setSearchApiKeyModified] = useState(false)

  const fetchConfig = useCallback(() => {
    setLoading(true)
    api.get<AiChatConfigData>('/ai-chat/config')
      .then(cfg => {
        setConfig(cfg)
        setProvider(cfg.provider)
        setModel(cfg.model)
        setApiKey(cfg.apiKey)
        setBaseUrl(cfg.baseUrl || '')
        setSystemPrompt(cfg.systemPrompt)
        setDailyLimit(cfg.dailyLimit)
        setIsEnabled(cfg.isEnabled)
        setSearchEnabled(cfg.searchEnabled ?? false)
        setSearchProvider(cfg.searchProvider || 'bocha')
        setSearchApiKey(cfg.searchApiKey || '')
        setApiKeyModified(false)
        setSearchApiKeyModified(false)
      })
      .catch(err => {
        console.error('获取 AI 对话配置失败:', err)
        setFormError('获取配置失败：' + (err instanceof Error ? err.message : '未知错误'))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const handleProviderChange = (value: string) => {
    setProvider(value)
    const preset = PROVIDER_PRESETS.find(p => p.value === value)
    if (preset?.baseUrl) {
      setBaseUrl(preset.baseUrl)
    }
    if (preset && preset.models.length > 0) {
      setModel(preset.models[0])
    }
  }

  const handleSave = async () => {
    if (!model.trim()) {
      setFormError('请输入模型名称')
      return
    }
    const limit = Number(dailyLimit)
    if (!Number.isInteger(limit) || limit < 0 || limit > 100000) {
      setFormError('每日提问上限需为 0–100000 的整数（0 = 不限）')
      return
    }
    const hasSearchKey = Boolean(
      (config?.searchApiKey && !searchApiKeyModified) ||
      (searchApiKeyModified && searchApiKey.trim()),
    )
    if (searchEnabled && !hasSearchKey) {
      setFormError('启用联网搜索前请填写搜索 API Key')
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
        dailyLimit: limit,
        isEnabled,
        searchEnabled,
        searchProvider,
      }
      body.baseUrl = baseUrl.trim() ? baseUrl.trim() : null
      if (apiKeyModified && apiKey.trim()) {
        body.apiKey = apiKey.trim()
      }
      if (searchApiKeyModified && searchApiKey.trim()) {
        body.searchApiKey = searchApiKey.trim()
      }

      const result = await api.put<AiChatConfigData>('/ai-chat/config', body)
      setConfig(result)
      setApiKey(result.apiKey)
      setSearchApiKey(result.searchApiKey)
      setSearchProvider(result.searchProvider)
      setSearchEnabled(result.searchEnabled)
      setApiKeyModified(false)
      setSearchApiKeyModified(false)
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

  return (
    <div>
      <div className="gh-page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>AI 对话设置</h1>
          <p>配置 DeepSeek 对话功能的模型、Key 与每日提问上限（与首页 AI 助手相互独立）</p>
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
            <div style={{ fontWeight: 600 }}>启用 AI 对话</div>
            <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
              开启后，登录用户可在「功能页面 → DeepSeek 对话」使用（/deepseek）
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
            aria-label={isEnabled ? '禁用 AI 对话' : '启用 AI 对话'}
          >
            <span
              style={{
                position: 'absolute', top: '3px',
                left: isEnabled ? '27px' : '3px',
                width: '22px', height: '22px', borderRadius: '50%',
                background: 'var(--gh-bg)',
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
            placeholder="输入模型名称，如 deepseek-chat"
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
          <label style={labelStyle}>Base URL</label>
          <input
            className="gh-input gh-input--full"
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com"
          />
          <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
            任何 OpenAI 兼容端点；使用代理/中转时填写中转地址
          </div>
        </div>

        {/* 每日提问上限 */}
        <div style={{ marginBottom: 'var(--gh-space-4)' }}>
          <label style={labelStyle}>每日提问上限（每用户）</label>
          <input
            className="gh-input gh-input--full"
            type="number"
            min={0}
            max={100000}
            step={1}
            value={dailyLimit}
            onChange={e => setDailyLimit(e.target.value === '' ? 0 : Number(e.target.value))}
          />
          <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
            每个登录用户每天（北京时间 0 点重置）最多提问的次数；填 0 表示不限次数。
            发送失败的消息不计数。
          </div>
        </div>

        {/* System Prompt */}
        <div style={{ marginBottom: 'var(--gh-space-5)' }}>
          <label style={labelStyle}>System Prompt</label>
          <textarea
            className="gh-input gh-input--full"
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={4}
            style={{ resize: 'vertical', minHeight: '80px', fontFamily: 'var(--gh-font)' }}
            placeholder="留空使用默认提示词"
          />
          <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
            这是通用对话（不注入站点上下文）；提示词决定 AI 的角色与语气
          </div>
        </div>

        {/* 联网搜索 */}
        <div style={{ marginBottom: 'var(--gh-space-5)', paddingTop: 'var(--gh-space-4)', borderTop: '1px solid var(--gh-border-muted)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 'var(--gh-space-3)',
          }}>
            <div>
              <div style={{ fontWeight: 600 }}>联网搜索</div>
              <div className="gh-text-tertiary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                开启后，登录用户可在对话页打开「联网搜索」，回答前先检索网页资料。
                可选用 DeepSeek 官方搜索（与对话模型同 Key）或博查 / Tavily 等第三方服务。
              </div>
            </div>
            <button
              onClick={() => setSearchEnabled(!searchEnabled)}
              style={{
                width: '52px', height: '28px', borderRadius: '14px', border: 'none', cursor: 'pointer',
                background: searchEnabled ? 'var(--gh-accent)' : 'var(--gh-border)',
                position: 'relative', transition: 'background var(--gh-transition)',
                flexShrink: 0, marginLeft: 'var(--gh-space-3)',
              }}
              aria-label={searchEnabled ? '禁用联网搜索' : '启用联网搜索'}
            >
              <span
                style={{
                  position: 'absolute', top: '3px',
                  left: searchEnabled ? '27px' : '3px',
                  width: '22px', height: '22px', borderRadius: '50%',
                  background: 'var(--gh-bg)',
                  transition: 'left var(--gh-transition)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            </button>
          </div>

          <div style={{ marginBottom: 'var(--gh-space-3)' }}>
            <label style={labelStyle}>搜索服务</label>
            <div style={{ display: 'flex', gap: 'var(--gh-space-2)', flexWrap: 'wrap' }}>
              {SEARCH_PROVIDER_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setSearchProvider(p.value)}
                  title={p.hint}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 'var(--gh-radius)',
                    border: searchProvider === p.value ? '1.5px solid var(--gh-accent)' : '1px solid var(--gh-border)',
                    background: searchProvider === p.value ? 'var(--gh-accent-soft)' : 'var(--gh-canvas)',
                    color: searchProvider === p.value ? 'var(--gh-accent)' : 'var(--gh-text-secondary)',
                    cursor: 'pointer', fontSize: 'var(--gh-text-sm)',
                    fontWeight: searchProvider === p.value ? 600 : 400,
                    fontFamily: 'var(--gh-font)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
              {SEARCH_PROVIDER_PRESETS.find(p => p.value === searchProvider)?.hint}
            </div>
          </div>

          <div style={{ marginBottom: 'var(--gh-space-3)' }}>
            <label style={labelStyle}>搜索 API Key</label>
            <input
              className="gh-input gh-input--full"
              type="password"
              value={searchApiKey}
              onChange={e => {
                setSearchApiKey(e.target.value)
                setSearchApiKeyModified(true)
              }}
              onFocus={() => {
                if (!searchApiKeyModified) {
                  setSearchApiKey('')
                  setSearchApiKeyModified(true)
                }
              }}
              placeholder={config?.searchApiKey && !searchApiKeyModified ? '已设置（点击输入新 Key 替换）' : '输入搜索服务 API Key'}
            />
            <div style={{ fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)', marginTop: '4px' }}>
              {config?.searchApiKey && !searchApiKeyModified
                ? `当前: ${config.searchApiKey}`
                : 'Key 仅保存在服务器；未配置时对话页的「联网搜索」按钮不可用'}
            </div>
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
            <li><strong>DeepSeek</strong>：在 platform.deepseek.com 获取 Key；deepseek-chat / deepseek-reasoner 为纯文本模型</li>
            <li><strong>联网搜索</strong>：DeepSeek 官方 API 不自带搜索，需在博查（open.bochaai.com）或 Tavily（tavily.com）申请搜索 Key；搜索按次计费，与模型 Key 分开</li>
            <li><strong>图片提问</strong>：需要模型支持视觉输入（多模态）。DeepSeek 官方 API 暂不支持图片，如需图片理解，请把 Base URL 与模型改为支持视觉的 OpenAI 兼容端点（如通义千问 qwen-vl 系列、GLM-4V 等）</li>
            <li>图片附件统一转 WebP 存储并计入上传者的网盘空间配额（与聊天图片口径一致）</li>
            <li>此配置与「AI 助手配置」（/admin/ai）相互独立，互不影响</li>
            <li>配置保存后即刻生效，无需重启服务</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
