/**
 * 我的世界 —— three.js 体素渲染器
 *
 * 职责边界：页面负责输入采集与物理推进（引擎纯函数），本模块只负责「把世界画出来」：
 *   - 区块网格：16×16×64 一块，只生成与透明方块相邻的面（背面剔除式的面剔除），
 *     不透明 / 半透明（水、玻璃）分两张网格；编辑后只重建受影响区块；
 *   - 材质：单图集 + 顶点色烘焙的朝向明暗（顶 1.0 / 侧 0.8·0.6 / 底 0.55），
 *     MeshBasicMaterial（无灯光），昼夜用整体 tint 模拟；
 *   - 天空：背景色 + 雾随昼夜插值，云层为一张程序化噪声透明贴图缓慢平移；
 *   - 选块框：黑色线框盒（对齐原版的方块选中轮廓）；
 *   - 远端玩家：方头方脑的盒子小人（配色由 userId 哈希决定）+ 头顶名字，
 *     位置朝向按最近一次上报做插值平滑。
 *
 * 依赖 DOM / WebGL，不参与 vitest / 服务端自检。
 */

import * as THREE from 'three'
import {
  MC_CHUNK_COUNT,
  MC_CHUNK_SIZE,
  MC_DAY_LENGTH_MS,
  MC_WORLD_HEIGHT,
  MC_WORLD_SIZE,
  mcBlockIndex,
  mcGetBlock,
  mcIsTransparent,
  type McRayHit,
  type McWorld,
} from './minecraft'
import { MC_ATLAS_COLS, MC_ATLAS_ROWS, buildMinecraftAtlas, mcBlockFaceTile } from './minecraftTextures'

/** 远端玩家的渲染状态（页面只传 DTO，插值在渲染器内部完成） */
export interface McRemotePlayerView {
  userId: number
  username: string
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

interface FaceDef {
  /** 面法线（也是邻格偏移） */
  dir: [number, number, number]
  /** 四个角（单位立方体坐标），索引 (0,1,2) (2,1,3) 两个三角形，CCW 朝外 */
  corners: Array<[number, number, number]>
  /** 面明暗（对齐原版的朝向着色） */
  shade: number
  /** face 参数：0 顶 1 底 2 侧 */
  faceKind: 0 | 1 | 2
}

const FACES: FaceDef[] = [
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 0], [1, 1, 1]], shade: 1.0, faceKind: 0 },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], shade: 0.55, faceKind: 1 },
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]], shade: 0.6, faceKind: 2 },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]], shade: 0.6, faceKind: 2 },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], shade: 0.8, faceKind: 2 },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], shade: 0.8, faceKind: 2 },
]

/** 侧面贴图的 UV 朝向：角点顺序对应 (0,0) (1,0) (0,1) (1,1) */
const CORNER_UV: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]]

const DAY_SKY = new THREE.Color(0x8ecafc)
const NIGHT_SKY = new THREE.Color(0x0b1026)
const DAY_FOG = new THREE.Color(0xc4dcf2)
const NIGHT_FOG = new THREE.Color(0x0e1428)
const UNDERWATER_FOG = new THREE.Color(0x1d3f8f)
const FOG_NEAR = 60
const FOG_FAR = 170
const UNDERWATER_FOG_NEAR = 0
const UNDERWATER_FOG_FAR = 22

interface ChunkMeshes {
  opaque: THREE.Mesh | null
  alpha: THREE.Mesh | null
}

interface RemoteAvatar {
  group: THREE.Group
  head: THREE.Group
  legPivots: [THREE.Group, THREE.Group]
  nameSprite: THREE.Sprite
  /** 当前渲染位置（插值中间态） */
  current: { x: number; y: number; z: number; yaw: number; pitch: number }
  target: { x: number; y: number; z: number; yaw: number; pitch: number }
  walkPhase: number
  /** 上一次的位置（估算步速用） */
  prev: { x: number; z: number }
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

export class MinecraftScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  world: McWorld

  private readonly canvas: HTMLCanvasElement
  private readonly atlasTexture: THREE.CanvasTexture
  private readonly opaqueMaterial: THREE.MeshBasicMaterial
  private readonly alphaMaterial: THREE.MeshBasicMaterial
  private readonly chunks = new Map<string, ChunkMeshes>()
  /** 待重建区块队列（去重），每帧按预算处理 */
  private readonly remeshQueue: number[] = []
  private readonly queuedChunks = new Set<number>()
  private readonly selectionBox: THREE.LineSegments
  private readonly cloudMesh: THREE.Mesh
  private readonly avatars = new Map<number, RemoteAvatar>()

  private dayEnabled = true
  private daylight = 1
  private underwater = false
  private disposed = false

  constructor(canvas: HTMLCanvasElement, world: McWorld) {
    this.canvas = canvas
    this.world = world
    // 移动端（粗指针）把像素比压到 1.5，避免高分屏 + 全屏体素渲染掉帧
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2))
    this.renderer.setClearColor(DAY_SKY)

    this.scene = new THREE.Scene()
    this.scene.background = DAY_SKY.clone()
    this.scene.fog = new THREE.Fog(DAY_FOG.clone(), FOG_NEAR, FOG_FAR)

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400)
    this.camera.rotation.order = 'YXZ'

    // 图集纹理：NearestFilter 保持像素风，关闭 mipmap 防止边缘渗色
    this.atlasTexture = new THREE.CanvasTexture(buildMinecraftAtlas())
    this.atlasTexture.magFilter = THREE.NearestFilter
    this.atlasTexture.minFilter = THREE.NearestFilter
    this.atlasTexture.generateMipmaps = false
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace

    this.opaqueMaterial = new THREE.MeshBasicMaterial({ map: this.atlasTexture, vertexColors: true })
    this.alphaMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    // 选块框：比方块略大的黑色线框
    const boxGeometry = new THREE.BoxGeometry(1.002, 1.002, 1.002)
    this.selectionBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeometry),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 }),
    )
    boxGeometry.dispose()
    this.selectionBox.visible = false
    this.scene.add(this.selectionBox)

    this.cloudMesh = this.buildClouds()
    this.scene.add(this.cloudMesh)

    // 初始区块全部入队（每帧预算式构建，靠近相机的优先）
    this.queueAllChunks()
    this.resize()
  }

  // === 世界 / 区块 ===

  private queueAllChunks(): void {
    for (let cx = 0; cx < MC_CHUNK_COUNT; cx += 1) {
      for (let cz = 0; cz < MC_CHUNK_COUNT; cz += 1) {
        this.enqueueChunk(cx, cz)
      }
    }
  }

  private enqueueChunk(cx: number, cz: number): void {
    if (cx < 0 || cx >= MC_CHUNK_COUNT || cz < 0 || cz >= MC_CHUNK_COUNT) return
    const id = cx * MC_CHUNK_COUNT + cz
    if (this.queuedChunks.has(id)) return
    this.queuedChunks.add(id)
    this.remeshQueue.push(id)
  }

  /** 应用一次方块修改：更新体素数据并重建受影响区块（含边界邻块） */
  applyBlockEdit(x: number, y: number, z: number, block: number): void {
    if (y < 0 || y >= MC_WORLD_HEIGHT) return
    if (x < 0 || x >= MC_WORLD_SIZE || z < 0 || z >= MC_WORLD_SIZE) return
    this.world.data[mcBlockIndex(x, y, z)] = block
    const cx = Math.floor(x / MC_CHUNK_SIZE)
    const cz = Math.floor(z / MC_CHUNK_SIZE)
    this.enqueueChunk(cx, cz)
    // 边界方块要同步重建相邻区块（面剔除跨区块可见）
    const localX = x - cx * MC_CHUNK_SIZE
    const localZ = z - cz * MC_CHUNK_SIZE
    if (localX === 0) this.enqueueChunk(cx - 1, cz)
    if (localX === MC_CHUNK_SIZE - 1) this.enqueueChunk(cx + 1, cz)
    if (localZ === 0) this.enqueueChunk(cx, cz - 1)
    if (localZ === MC_CHUNK_SIZE - 1) this.enqueueChunk(cx, cz + 1)
  }

  /** 替换整个世界（联机重新开局 / 单机新世界）：清空网格并全部入队 */
  setWorld(world: McWorld): void {
    this.world = world
    for (const meshes of this.chunks.values()) {
      this.disposeChunkMeshes(meshes)
    }
    this.chunks.clear()
    this.remeshQueue.length = 0
    this.queuedChunks.clear()
    this.queueAllChunks()
  }

  /**
   * 处理重建队列：每帧最多 budget 个区块（或 8ms 时间盒）。
   * 队列按入队序处理，初始加载时先中间后边缘（入队顺序即行列序，中心先于角落不明显，
   * 但 144 块在预算下 1-2 秒内即可完成，玩家出生时脚下区块最早完成）。
   */
  processRemeshQueue(budget: number = 6): void {
    const deadline = performance.now() + 8
    let processed = 0
    while (this.remeshQueue.length > 0 && processed < budget) {
      if (processed > 0 && performance.now() > deadline) break
      const id = this.remeshQueue.shift()
      if (id === undefined) break
      this.queuedChunks.delete(id)
      const cx = Math.floor(id / MC_CHUNK_COUNT)
      const cz = id % MC_CHUNK_COUNT
      this.buildChunk(cx, cz)
      processed += 1
    }
  }

  get pendingChunks(): number {
    return this.remeshQueue.length
  }

  private buildChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz)
    const existing = this.chunks.get(key)
    if (existing) this.disposeChunkMeshes(existing)

    const baseX = cx * MC_CHUNK_SIZE
    const baseZ = cz * MC_CHUNK_SIZE

    const opaquePositions: number[] = []
    const opaqueUvs: number[] = []
    const opaqueColors: number[] = []
    const opaqueIndices: number[] = []
    const alphaPositions: number[] = []
    const alphaUvs: number[] = []
    const alphaColors: number[] = []
    const alphaIndices: number[] = []

    for (let lx = 0; lx < MC_CHUNK_SIZE; lx += 1) {
      const x = baseX + lx
      for (let lz = 0; lz < MC_CHUNK_SIZE; lz += 1) {
        const z = baseZ + lz
        for (let y = 0; y < MC_WORLD_HEIGHT; y += 1) {
          const block = this.world.data[mcBlockIndex(x, y, z)]
          if (block === 0) continue
          const isAlpha = block === 10 || block === 11 // 水 / 玻璃
          const positions = isAlpha ? alphaPositions : opaquePositions
          const uvs = isAlpha ? alphaUvs : opaqueUvs
          const colors = isAlpha ? alphaColors : opaqueColors
          const indices = isAlpha ? alphaIndices : opaqueIndices

          for (const face of FACES) {
            const neighbor = mcGetBlock(this.world, x + face.dir[0], y + face.dir[1], z + face.dir[2])
            // 面剔除：邻格不透明 → 遮挡；邻格与自己相同（水-水 / 玻璃-玻璃）→ 内面不画
            if (neighbor === block || !mcIsTransparent(neighbor)) continue

            const tile = mcBlockFaceTile(block, face.faceKind)
            const col = tile % MC_ATLAS_COLS
            const row = Math.floor(tile / MC_ATLAS_COLS)
            const startIndex = positions.length / 3
            for (let i = 0; i < 4; i += 1) {
              const corner = face.corners[i]
              positions.push(x + corner[0], y + corner[1], z + corner[2])
              const [uu, vv] = CORNER_UV[i]
              // 半透明贴图（水）在侧面略降顶端，制造「水面低于方块顶」的视觉
              uvs.push((col + uu) / MC_ATLAS_COLS, 1 - (row + 1 - vv) / MC_ATLAS_ROWS)
              colors.push(face.shade, face.shade, face.shade)
            }
            indices.push(startIndex, startIndex + 1, startIndex + 2, startIndex + 2, startIndex + 1, startIndex + 3)
          }
        }
      }
    }

    const meshes: ChunkMeshes = { opaque: null, alpha: null }
    if (opaqueIndices.length > 0) {
      meshes.opaque = this.makeChunkMesh(opaquePositions, opaqueUvs, opaqueColors, opaqueIndices, this.opaqueMaterial)
      this.scene.add(meshes.opaque)
    }
    if (alphaIndices.length > 0) {
      meshes.alpha = this.makeChunkMesh(alphaPositions, alphaUvs, alphaColors, alphaIndices, this.alphaMaterial)
      meshes.alpha.renderOrder = 1
      this.scene.add(meshes.alpha)
    }
    this.chunks.set(key, meshes)
  }

  private makeChunkMesh(
    positions: number[],
    uvs: number[],
    colors: number[],
    indices: number[],
    material: THREE.MeshBasicMaterial,
  ): THREE.Mesh {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.matrixAutoUpdate = false
    return mesh
  }

  private disposeChunkMeshes(meshes: ChunkMeshes): void {
    for (const mesh of [meshes.opaque, meshes.alpha]) {
      if (!mesh) continue
      this.scene.remove(mesh)
      mesh.geometry.dispose()
    }
  }

  // === 云层 ===

  private buildClouds(): THREE.Mesh {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const image = ctx?.createImageData(size, size)
    if (!ctx || !image) throw new Error('无法创建云层画布')
    // 确定性块状云：值噪声阈值化（复用引擎噪声，保证视觉一致）
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // 2×2 聚块（云是像素团块感）
        const nx = Math.floor(x / 2)
        const ny = Math.floor(y / 2)
        const n =
          0.6 * this.valueNoiseWrap(nx / 16, ny / 16, 17)
          + 0.4 * this.valueNoiseWrap(nx / 7, ny / 7, 91)
        const index = (y * size + x) * 4
        if (n > 0.58) {
          image.data[index] = 255
          image.data[index + 1] = 255
          image.data[index + 2] = 255
          image.data[index + 3] = 190
        } else {
          image.data[index + 3] = 0
        }
      }
    }
    ctx.putImageData(image, 0, 0)
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2, 2)
    const geometry = new THREE.PlaneGeometry(800, 800)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      fog: false,
      opacity: 0.55,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(MC_WORLD_SIZE / 2, 82, MC_WORLD_SIZE / 2)
    mesh.renderOrder = 2
    return mesh
  }

  /** 平铺噪声：用模周期采样近似无缝（云贴图重复时的接缝不明显即可） */
  private valueNoiseWrap(x: number, y: number, seed: number): number {
    const fx = x - Math.floor(x)
    const fy = y - Math.floor(y)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const smooth = (t: number): number => t * t * (3 - 2 * t)
    const sx = smooth(fx)
    const sy = smooth(fy)
    const h = (a: number, b: number): number => {
      const ha = Math.imul(((a % 16) + 16) % 16 + 1, 374761393)
      const hb = Math.imul(((b % 16) + 16) % 16 + 1, 668265263)
      let h2 = (ha ^ hb ^ Math.imul(seed, 2654435761)) >>> 0
      h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177) >>> 0
      return (h2 & 0xffff) / 0xffff
    }
    const a = h(x0, y0)
    const b = h(x0 + 1, y0)
    const c = h(x0, y0 + 1)
    const d = h(x0 + 1, y0 + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }

  // === 相机 / 选块 / 状态 ===

  updateCamera(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.camera.position.set(x, y, z)
    this.camera.rotation.y = yaw
    this.camera.rotation.x = pitch
  }

  setSelection(hit: McRayHit | null): void {
    if (!hit) {
      this.selectionBox.visible = false
      return
    }
    this.selectionBox.visible = true
    this.selectionBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
  }

  setDayEnabled(enabled: boolean): void {
    this.dayEnabled = enabled
  }

  setUnderwater(underwater: boolean): void {
    if (this.underwater === underwater) return
    this.underwater = underwater
  }

  /** 每帧推进：云层漂移 + 昼夜色彩（dayTimeMs 由页面累计并传入） */
  tick(dtSeconds: number, dayTimeMs: number): void {
    this.processRemeshQueue()

    // 云层缓慢向东漂移
    const cloudMaterial = this.cloudMesh.material as THREE.MeshBasicMaterial
    if (cloudMaterial.map) {
      cloudMaterial.map.offset.x = (cloudMaterial.map.offset.x + dtSeconds * 0.0015) % 1
    }

    // 昼夜：dayTimeMs ∈ [0, DAY_LENGTH_MS)，0 = 日出
    let light: number
    if (this.dayEnabled) {
      const t = (dayTimeMs % MC_DAY_LENGTH_MS) / MC_DAY_LENGTH_MS
      light = THREE.MathUtils.clamp(Math.sin(t * Math.PI * 2) * 1.4 + 0.35, 0.18, 1)
    } else {
      light = 1
    }
    this.daylight = light
    const dayFactor = (light - 0.18) / 0.82

    const sky = NIGHT_SKY.clone().lerp(DAY_SKY, dayFactor)
    const fogColor = this.underwater
      ? UNDERWATER_FOG.clone().multiplyScalar(0.3 + 0.7 * dayFactor)
      : NIGHT_FOG.clone().lerp(DAY_FOG, dayFactor)
    ;(this.scene.background as THREE.Color).copy(sky)
    const fog = this.scene.fog as THREE.Fog
    fog.color.copy(fogColor)
    if (this.underwater) {
      fog.near = UNDERWATER_FOG_NEAR
      fog.far = UNDERWATER_FOG_FAR
    } else {
      fog.near = FOG_NEAR
      fog.far = FOG_FAR
    }

    // 世界 tint（顶点色 × 材质色）+ 云层亮度
    this.opaqueMaterial.color.setScalar(light)
    this.alphaMaterial.color.setScalar(light)
    cloudMaterial.color.setScalar(0.4 + 0.6 * dayFactor)
    cloudMaterial.opacity = 0.2 + 0.35 * dayFactor
  }

  /** 渲染一帧（页面在自己的 RAF 循环中调用） */
  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  resize(): void {
    const parent = this.canvas.parentElement
    const width = parent?.clientWidth || window.innerWidth
    const height = parent?.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  // === 远端玩家 ===

  setRemotePlayers(players: McRemotePlayerView[], selfUserId: number): void {
    if (this.disposed) return
    const seen = new Set<number>()
    for (const player of players) {
      if (player.userId === selfUserId) continue
      seen.add(player.userId)
      let avatar = this.avatars.get(player.userId)
      if (!avatar) {
        avatar = this.createAvatar(player)
        this.avatars.set(player.userId, avatar)
        this.scene.add(avatar.group)
      }
      avatar.target = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch }
    }
    // 移除已离开的玩家
    for (const [userId, avatar] of Array.from(this.avatars.entries())) {
      if (!seen.has(userId)) {
        this.scene.remove(avatar.group)
        this.disposeAvatar(avatar)
        this.avatars.delete(userId)
      }
    }
  }

  private createAvatar(player: McRemotePlayerView): RemoteAvatar {
    const group = new THREE.Group()
    const hue = (player.userId * 0.6180339887) % 1
    const shirt = new THREE.Color().setHSL(hue, 0.55, 0.45)
    const pants = new THREE.Color().setHSL(hue, 0.35, 0.22)
    const skin = new THREE.Color(0xc79b76)
    const hairColor = new THREE.Color().setHSL(hue, 0.3, 0.15)

    const box = (w: number, h: number, d: number, color: THREE.Color): THREE.Mesh => {
      const geometry = new THREE.BoxGeometry(w, h, d)
      const material = new THREE.MeshBasicMaterial({ color })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.matrixAutoUpdate = false
      return mesh
    }

    // 身体（0.675 + 0.675 + 0.45 ≈ 1.8，与碰撞盒一致；group 原点在脚底）
    const body = box(0.5, 0.675, 0.25, shirt)
    body.position.set(0, 1.0125, 0)
    body.updateMatrix()
    group.add(body)

    const armGeometryColor = skin
    const leftArm = box(0.2, 0.675, 0.2, armGeometryColor)
    const rightArm = box(0.2, 0.675, 0.2, armGeometryColor)
    leftArm.position.set(-0.35, 1.0125, 0)
    rightArm.position.set(0.35, 1.0125, 0)
    leftArm.updateMatrix()
    rightArm.updateMatrix()
    group.add(leftArm, rightArm)

    // 腿：pivot 在髋部，走路时绕 pivot 摆动
    const makeLeg = (side: -1 | 1): THREE.Group => {
      const pivot = new THREE.Group()
      pivot.position.set(side * 0.13, 0.675, 0)
      const leg = box(0.22, 0.675, 0.22, pants)
      leg.position.set(0, -0.3375, 0)
      leg.updateMatrix()
      pivot.add(leg)
      group.add(pivot)
      return pivot
    }
    const legPivots: [THREE.Group, THREE.Group] = [makeLeg(-1), makeLeg(1)]

    // 头：pivot 在颈部（俯仰绕颈部转）
    const headPivot = new THREE.Group()
    headPivot.position.set(0, 1.35, 0)
    const head = box(0.45, 0.45, 0.45, skin)
    head.position.set(0, 0.225, 0)
    head.updateMatrix()
    const hair = box(0.47, 0.16, 0.47, hairColor)
    hair.position.set(0, 0.43, 0)
    hair.updateMatrix()
    headPivot.add(head, hair)
    group.add(headPivot)

    // 名字牌
    const nameSprite = this.createNameSprite(player.username)
    nameSprite.position.set(0, 2.15, 0)
    group.add(nameSprite)

    return {
      group,
      head: headPivot,
      legPivots,
      nameSprite,
      current: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
      target: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
      walkPhase: 0,
      prev: { x: player.x, z: player.z },
    }
  }

  private createNameSprite(username: string): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, 256, 64)
      ctx.font = 'bold 32px system-ui, sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(username.slice(0, 12), 128, 34)
    }
    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(1.5, 0.375, 1)
    sprite.renderOrder = 3
    return sprite
  }

  private disposeAvatar(avatar: RemoteAvatar): void {
    avatar.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        ;(object.material as THREE.MeshBasicMaterial).dispose()
      }
    })
    ;(avatar.nameSprite.material as THREE.SpriteMaterial).map?.dispose()
    ;(avatar.nameSprite.material as THREE.SpriteMaterial).dispose()
  }

  /** 每帧把远端玩家朝目标位置插值（含走路摆腿与头部俯仰） */
  tickAvatars(dtSeconds: number): void {
    for (const avatar of this.avatars.values()) {
      const k = Math.min(1, dtSeconds * 8)
      avatar.current.x += (avatar.target.x - avatar.current.x) * k
      avatar.current.y += (avatar.target.y - avatar.current.y) * k
      avatar.current.z += (avatar.target.z - avatar.current.z) * k
      // 角度按最短方向插值
      let dy = avatar.target.yaw - avatar.current.yaw
      while (dy > Math.PI) dy -= Math.PI * 2
      while (dy < -Math.PI) dy += Math.PI * 2
      avatar.current.yaw += dy * Math.min(1, dtSeconds * 10)
      avatar.current.pitch += (avatar.target.pitch - avatar.current.pitch) * Math.min(1, dtSeconds * 10)

      avatar.group.position.set(avatar.current.x, avatar.current.y, avatar.current.z)
      avatar.group.rotation.y = avatar.current.yaw
      avatar.head.rotation.x = -avatar.current.pitch

      // 步速估算 → 摆腿
      const moved = Math.hypot(avatar.current.x - avatar.prev.x, avatar.current.z - avatar.prev.z)
      avatar.prev = { x: avatar.current.x, z: avatar.current.z }
      const speed = moved / Math.max(dtSeconds, 1e-4)
      if (speed > 0.3) {
        avatar.walkPhase += dtSeconds * Math.min(speed * 2.2, 12)
        const swing = Math.sin(avatar.walkPhase) * 0.55
        avatar.legPivots[0].rotation.x = swing
        avatar.legPivots[1].rotation.x = -swing
      } else {
        avatar.legPivots[0].rotation.x *= 0.8
        avatar.legPivots[1].rotation.x *= 0.8
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const meshes of this.chunks.values()) {
      this.disposeChunkMeshes(meshes)
    }
    this.chunks.clear()
    for (const avatar of this.avatars.values()) {
      this.disposeAvatar(avatar)
    }
    this.avatars.clear()
    this.atlasTexture.dispose()
    this.opaqueMaterial.dispose()
    this.alphaMaterial.dispose()
    ;(this.cloudMesh.material as THREE.MeshBasicMaterial).map?.dispose()
    ;(this.cloudMesh.material as THREE.MeshBasicMaterial).dispose()
    this.cloudMesh.geometry.dispose()
    this.selectionBox.geometry.dispose()
    ;(this.selectionBox.material as THREE.LineBasicMaterial).dispose()
    this.renderer.dispose()
  }
}
