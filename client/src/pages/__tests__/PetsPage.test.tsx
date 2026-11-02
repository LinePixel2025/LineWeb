import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import PetsPage from '../PetsPage'
import type { PetDto, PetsView } from '../../types/pet'

// api 库整体 mock：按用例设置 GET /pets 的返回
const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  default: {
    get: apiMocks.get,
    post: apiMocks.post,
  },
}))

// 积分上下文 mock：余额充足，applyLocalDelta 只做记录
vi.mock('../../contexts/PointsContext', () => ({
  usePoints: () => ({
    balance: 1000,
    applyLocalDelta: vi.fn(),
    refresh: vi.fn(async () => null),
  }),
}))

function renderPetsPage() {
  return render(
    <MemoryRouter>
      <PetsPage />
    </MemoryRouter>,
  )
}

const baseCatalog: PetsView['catalog'] = {
  species: [
    { key: 'cat', name: '小猫', defaultName: '咪咪', emoji: '🐱', description: '爱晒太阳的小懒猫' },
    { key: 'dog', name: '小狗', defaultName: '旺旺', emoji: '🐶', description: '尾巴摇个不停的忠犬' },
    { key: 'bird', name: '小鸟', defaultName: '啾啾', emoji: '🐦', description: '会唱歌的小家伙' },
  ],
  outfits: [
    { key: 'hat_red', slot: 'hat', name: '红色小帽', emoji: '🧢', price: 120, minLevel: 2, description: '带绒球的小红帽' },
    { key: 'bowtie', slot: 'neck', name: '红蝴蝶结', emoji: '🎀', price: 80, minLevel: 1, description: '乖巧的蝴蝶结' },
  ],
  costs: { summon: 200, feed: 10, bathe: 15, play: 20 },
  careActions: [
    { key: 'feed', name: '喂食', emoji: '🍖', minLevel: 1, cost: 10, description: '饱食度回满' },
    { key: 'bathe', name: '洗澡', emoji: '🛁', minLevel: 2, cost: 15, description: '清洁回满' },
    { key: 'play', name: '玩耍', emoji: '🎾', minLevel: 3, cost: 20, description: '心情大涨' },
  ],
  tricks: [
    { key: 'dance', name: '跳舞', emoji: '💃', minLevel: 2, description: '左右摇摆' },
    { key: 'flip', name: '后空翻', emoji: '🤸', minLevel: 4, description: '帅气空翻' },
  ],
  maxLevel: 10,
  levelCostBase: 50,
  decayPerHour: { hunger: 6, cleanliness: 4, mood: 3 },
  graceHours: 24,
}

const gonePet: PetDto = {
  id: 1,
  species: 'cat',
  name: '咪咪',
  level: 3,
  status: 'gone',
  hunger: 0,
  cleanliness: 0,
  mood: 0,
  decayPerHour: { hunger: 6, cleanliness: 4, mood: 3 },
  zeroAtMs: Date.now() - 26 * 3_600_000,
  graceHours: 24,
  equipped: { hat: null, neck: null, face: null, back: null, aura: null },
  ownedOutfits: ['bowtie'],
  unlockedActions: ['dance'],
  nextLevelCost: 80,
  touchReady: true,
}

describe('PetsPage', () => {
  beforeEach(() => {
    apiMocks.get.mockReset()
    apiMocks.post.mockReset()
  })

  it('从未养过宠物时渲染召唤卡：三种宠物、花费与召唤按钮可见', async () => {
    apiMocks.get.mockResolvedValue({ pet: null, catalog: baseCatalog, points: 1000 } satisfies PetsView)
    const { container } = renderPetsPage()

    expect(await screen.findByRole('heading', { name: '召唤一只小宠物' })).toBeInTheDocument()
    // 卡片名称带 emoji 前缀（如 "🐱 小猫"），用正则匹配
    expect(screen.getByText(/小猫/)).toBeInTheDocument()
    expect(screen.getByText(/小狗/)).toBeInTheDocument()
    expect(screen.getByText(/小鸟/)).toBeInTheDocument()
    expect(screen.getByText(/200 积分/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '召唤' })).toBeEnabled()
    // 立绘 SVG 已渲染（三种各一只）
    expect(container.querySelectorAll('.gh-pet-summon-card .gh-pet-sprite svg').length).toBe(3)
  })

  it('宠物离家出走时渲染出走文案与重新召唤按钮', async () => {
    apiMocks.get.mockResolvedValue({ pet: gonePet, catalog: baseCatalog, points: 1000 } satisfies PetsView)
    renderPetsPage()

    expect(await screen.findByText(/离家出走了/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新召唤' })).toBeEnabled()
    // 出走空状态不渲染照顾界面
    expect(screen.queryByText('状态')).not.toBeInTheDocument()
  })
})
