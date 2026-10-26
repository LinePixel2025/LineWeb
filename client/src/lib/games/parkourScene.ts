import * as THREE from 'three'
import {
  PARKOUR_LANE_WIDTH,
  PARKOUR_RACE_LENGTH_M,
  parkourLaneCenter,
  parkourPose,
  type ParkourRunState,
} from './parkour'
import {
  createBlobShadow,
  createFinishGateModel,
  createPowerUpModel,
  createRunnerModel,
  createSignModel,
  type RunnerModel,
} from './parkourModels'
import {
  createAsphaltTexture,
  createBarrierTexture,
  createBuildingTexture,
  createFinishTexture,
  createGlowTexture,
  createShadowTexture,
  createSignTexture,
  createSkyTexture,
  createTrainTexture,
} from './parkourTextures'

/** 幽灵跑者的视图数据（由联机页从 DTO 映射，2Hz 更新，场景内插值） */
export interface ParkourGhostView {
  userId: number
  name: string
  colorIndex: number
  distanceM: number
  lane: 0 | 1 | 2
  pose: 'run' | 'jump' | 'slide'
}

interface GhostVisual {
  group: THREE.Group
  model: RunnerModel
  displayDistance: number
  displayX: number
  targetDistance: number
  targetX: number
  pose: 'run' | 'jump' | 'slide'
}

interface EnvironmentItem {
  object: THREE.Object3D
  span: number
}

const ENV_SPAN = 27 * 26
const STREETLIGHT_SPAN = 38 * 20
const GANTRY_SPAN = 120 * 6
const VIEW_DISTANCE = 180
const BEHIND_DISTANCE = 24

function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 霓虹跑酷 three.js 场景。
 * 只负责渲染与相机/特效，不推进游戏规则；页面/视图每帧传入同一份 run 状态。
 */
export class ParkourScene {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly seed: number
  private readonly playerColorIndex: number
  private readonly player: RunnerModel
  private readonly playerShadow: THREE.Mesh
  private readonly shieldGroup: THREE.Group
  private readonly magnetRing: THREE.Mesh
  private readonly dashTrail: THREE.Group
  private readonly obstacleRoot = new THREE.Group()
  private readonly obstacleMeshes = new Map<number, THREE.Object3D>()
  private readonly coinMesh: THREE.InstancedMesh
  private readonly coinDummy = new THREE.Object3D()
  private readonly powerUpRoot = new THREE.Group()
  private readonly powerUpMeshes = new Map<number, THREE.Object3D>()
  private readonly signTemplates: THREE.Group[] = []
  private readonly powerUpTemplates = new Map<'shield' | 'magnet' | 'dash', THREE.Group>()
  private readonly finishGate: THREE.Group
  private readonly finishTexture: THREE.Texture
  private readonly sky: THREE.Mesh
  private readonly skyTexture: THREE.Texture
  private readonly shadowTexture: THREE.Texture
  private readonly glowTexture: THREE.Texture
  private readonly ghostRoot = new THREE.Group()
  private readonly ghosts = new Map<number, GhostVisual>()
  private readonly environment: EnvironmentItem[] = []
  private readonly streetlights: EnvironmentItem[] = []
  private readonly gantries: EnvironmentItem[] = []
  private readonly sharedGeometries: THREE.BufferGeometry[] = []
  private readonly sharedMaterials: THREE.Material[] = []
  private readonly sharedTextures: THREE.Texture[] = []
  private readonly unitBox: THREE.BoxGeometry
  private readonly trainMaterial: THREE.MeshStandardMaterial
  private readonly barrierMaterial: THREE.MeshBasicMaterial
  private readonly pitMaterial: THREE.MeshBasicMaterial
  private readonly pitEdgeMaterial: THREE.MeshBasicMaterial
  private readonly trainLightMaterial: THREE.SpriteMaterial

  private animationTime = 0
  private cameraX = 0
  private cameraY = 3.7
  private cameraFov = 62
  private disposed = false
  private lastFov = 62
  private crashAt = 0

  constructor(canvas: HTMLCanvasElement, seed: number, playerColorIndex = 0) {
    this.canvas = canvas
    this.seed = seed >>> 0 || 1
    this.playerColorIndex = playerColorIndex
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x070814, 1)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x070814)
    this.scene.fog = new THREE.Fog(0x1a102e, 38, 150)

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 420)
    this.cameraFov = 62

    // 共享纹理
    const asphaltTexture = createAsphaltTexture()
    this.skyTexture = createSkyTexture()
    this.shadowTexture = createShadowTexture()
    this.glowTexture = createGlowTexture()
    this.finishTexture = createFinishTexture()
    const buildingCool = createBuildingTexture('cool')
    const buildingWarm = createBuildingTexture('warm')
    const trainTexture = createTrainTexture()
    const barrierTexture = createBarrierTexture()
    this.sharedTextures.push(
      asphaltTexture,
      this.skyTexture,
      this.shadowTexture,
      this.glowTexture,
      this.finishTexture,
      buildingCool,
      buildingWarm,
      trainTexture,
      barrierTexture,
    )

    // 共享几何 / 材质
    const unitBox = new THREE.BoxGeometry(1, 1, 1)
    const unitPlane = new THREE.PlaneGeometry(1, 1)
    this.sharedGeometries.push(unitBox, unitPlane)

    const asphaltMaterial = new THREE.MeshStandardMaterial({
      map: asphaltTexture,
      color: 0x9098b8,
      roughness: 0.93,
      metalness: 0.08,
    })
    const laneMaterial = new THREE.MeshBasicMaterial({ color: 0x2dd4bf })
    const laneEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0x65e6ff, transparent: true, opacity: 0.75 })
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.9 })
    const buildingMaterials = [
      new THREE.MeshBasicMaterial({ map: buildingCool }),
      new THREE.MeshBasicMaterial({ map: buildingWarm }),
    ]
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x172033, roughness: 0.7, metalness: 0.5 })
    const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
    const gantryMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b1220,
      emissive: 0x1e40af,
      emissiveIntensity: 0.25,
      roughness: 0.6,
      metalness: 0.4,
    })
    const neonMaterial = new THREE.MeshBasicMaterial({ color: 0x65e6ff })
    const trainMaterial = new THREE.MeshStandardMaterial({
      map: trainTexture,
      color: 0xbcd8ff,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.18,
      roughness: 0.48,
      metalness: 0.45,
    })
    const barrierMaterial = new THREE.MeshBasicMaterial({ map: barrierTexture })
    const pitMaterial = new THREE.MeshBasicMaterial({ color: 0x01020a })
    const pitEdgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffb703 })
    const coinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xffb703,
      emissiveIntensity: 0.85,
      metalness: 0.55,
      roughness: 0.28,
    })
    const glowSpriteMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffcf8a,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    })
    this.sharedMaterials.push(
      asphaltMaterial,
      laneMaterial,
      laneEdgeMaterial,
      sidewalkMaterial,
      ...buildingMaterials,
      poleMaterial,
      lampMaterial,
      gantryMaterial,
      neonMaterial,
      trainMaterial,
      barrierMaterial,
      pitMaterial,
      pitEdgeMaterial,
      coinMaterial,
      glowSpriteMaterial,
      shadowMaterial,
    )
    this.unitBox = unitBox
    this.trainMaterial = trainMaterial
    this.barrierMaterial = barrierMaterial
    this.pitMaterial = pitMaterial
    this.pitEdgeMaterial = pitEdgeMaterial
    this.trainLightMaterial = glowSpriteMaterial

    // 天空球
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(360, 32, 16),
      new THREE.MeshBasicMaterial({
        map: this.skyTexture,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    )
    this.sky.renderOrder = -100
    this.scene.add(this.sky)

    // 赛道
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 30_040), asphaltMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, 0, -14_980)
    this.scene.add(ground)
    this.sharedGeometries.push(ground.geometry)

    const laneLineGeometry = new THREE.BoxGeometry(0.055, 0.012, 30_040)
    this.sharedGeometries.push(laneLineGeometry)
    for (const x of [-PARKOUR_LANE_WIDTH / 2, PARKOUR_LANE_WIDTH / 2]) {
      const line = new THREE.Mesh(laneLineGeometry, laneMaterial)
      line.position.set(x, 0.018, -14_980)
      this.scene.add(line)
    }
    const edgeGeometry = new THREE.BoxGeometry(0.05, 0.018, 30_040)
    this.sharedGeometries.push(edgeGeometry)
    for (const x of [-3.62, 3.62]) {
      const edge = new THREE.Mesh(edgeGeometry, laneEdgeMaterial)
      edge.position.set(x, 0.02, -14_980)
      this.scene.add(edge)
    }
    const sidewalkGeometry = new THREE.BoxGeometry(1.7, 0.13, 30_040)
    this.sharedGeometries.push(sidewalkGeometry)
    for (const x of [-4.5, 4.5]) {
      const sidewalk = new THREE.Mesh(sidewalkGeometry, sidewalkMaterial)
      sidewalk.position.set(x, 0.065, -14_980)
      this.scene.add(sidewalk)
    }

    // 灯光
    this.scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x160e26, 1.25))
    const keyLight = new THREE.DirectionalLight(0xffd7bc, 1.4)
    keyLight.position.set(8, 20, 12)
    this.scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x6d8dff, 0.55)
    rimLight.position.set(-10, 8, -12)
    this.scene.add(rimLight)

    // 玩家与阴影
    this.player = createRunnerModel(playerColorIndex, false)
    this.scene.add(this.player.group)
    this.playerShadow = createBlobShadow(this.shadowTexture)
    this.scene.add(this.playerShadow)

    // 护盾 / 磁铁 / 冲刺特效
    this.shieldGroup = new THREE.Group()
    const shieldMaterial = new THREE.MeshBasicMaterial({
      color: 0x65e6ff,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const shieldWire = new THREE.MeshBasicMaterial({
      color: 0x65e6ff,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
    this.sharedMaterials.push(shieldMaterial, shieldWire)
    const shieldSphere = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), shieldMaterial)
    const shieldWireMesh = new THREE.Mesh(new THREE.SphereGeometry(1.18, 12, 8), shieldWire)
    this.sharedGeometries.push(shieldSphere.geometry, shieldWireMesh.geometry)
    this.shieldGroup.add(shieldSphere, shieldWireMesh)
    this.shieldGroup.visible = false
    this.scene.add(this.shieldGroup)

    const magnetMaterial = new THREE.MeshBasicMaterial({
      color: 0xf472b6,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.sharedMaterials.push(magnetMaterial)
    this.magnetRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.025, 6, 40), magnetMaterial)
    this.sharedGeometries.push(this.magnetRing.geometry)
    this.magnetRing.rotation.x = Math.PI / 2
    this.magnetRing.visible = false
    this.scene.add(this.magnetRing)

    this.dashTrail = new THREE.Group()
    const dashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb703,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.sharedMaterials.push(dashMaterial)
    const trailGeometry = new THREE.BoxGeometry(0.06, 0.025, 3.1)
    this.sharedGeometries.push(trailGeometry)
    for (const x of [-0.3, 0.3]) {
      const trail = new THREE.Mesh(trailGeometry, dashMaterial)
      trail.position.set(x, 0.9, 2)
      this.dashTrail.add(trail)
    }
    this.dashTrail.visible = false
    this.scene.add(this.dashTrail)

    // 障碍 / 金币 / 道具 / 终点
    this.scene.add(this.obstacleRoot, this.powerUpRoot, this.ghostRoot)
    const coinGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.055, 14)
    this.sharedGeometries.push(coinGeometry)
    this.coinMesh = new THREE.InstancedMesh(coinGeometry, coinMaterial, 512)
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.coinMesh.frustumCulled = false
    this.coinMesh.count = 0
    this.scene.add(this.coinMesh)

    this.signTemplates.push(
      createSignModel(createSignTexture('NIGHT RUN', '#65e6ff'), 0x65e6ff),
      createSignModel(createSignTexture('NEON CITY', '#f472b6'), 0xf472b6),
      createSignModel(createSignTexture('2088', '#fbbf24'), 0xfbbf24),
    )
    for (const template of this.signTemplates) template.visible = false
    this.powerUpTemplates.set('shield', createPowerUpModel('shield'))
    this.powerUpTemplates.set('magnet', createPowerUpModel('magnet'))
    this.powerUpTemplates.set('dash', createPowerUpModel('dash'))
    for (const template of this.powerUpTemplates.values()) template.visible = false

    this.finishGate = createFinishGateModel(this.finishTexture)
    this.finishGate.position.set(0, 0, -PARKOUR_RACE_LENGTH_M)
    this.scene.add(this.finishGate)

    // 环境（楼体 / 路灯 / 龙门架）
    this.buildEnvironment(buildingMaterials, poleMaterial, lampMaterial, gantryMaterial, neonMaterial, glowSpriteMaterial)
    this.resize()
  }

  private buildEnvironment(
    buildingMaterials: THREE.Material[],
    poleMaterial: THREE.Material,
    lampMaterial: THREE.Material,
    gantryMaterial: THREE.Material,
    neonMaterial: THREE.Material,
    glowMaterial: THREE.SpriteMaterial,
  ): void {
    const rng = makeRng(this.seed ^ 0x9e3779b9)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 26; i += 1) {
        const width = 7 + rng() * 8
        const height = 11 + rng() * 42
        const depth = 7 + rng() * 9
        const mesh = new THREE.Mesh(this.unitBox, buildingMaterials[(i + (side > 0 ? 1 : 0)) % 2])
        mesh.scale.set(width, height, depth)
        mesh.position.set(
          side * (11.5 + rng() * 9 + width / 2),
          height / 2,
          26 - i * 27 - rng() * 10,
        )
        this.scene.add(mesh)
        this.environment.push({ object: mesh, span: ENV_SPAN })
      }
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 20; i += 1) {
        const group = new THREE.Group()
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 6), poleMaterial)
        pole.position.y = 2.1
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.24), lampMaterial)
        lamp.position.y = 4.22
        const glow = new THREE.Sprite(glowMaterial)
        glow.position.y = 4.28
        glow.scale.set(2.2, 2.2, 1)
        group.add(pole, lamp, glow)
        group.position.set(side * 4.85, 0, 16 - i * 38 - (side > 0 ? 9 : 0))
        this.scene.add(group)
        this.streetlights.push({ object: group, span: STREETLIGHT_SPAN })
        this.sharedGeometries.push(pole.geometry, lamp.geometry)
      }
    }
    for (let i = 0; i < 6; i += 1) {
      const group = new THREE.Group()
      const beam = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.4, 0.5), gantryMaterial)
      beam.position.y = 5.5
      const neon = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.08, 0.08), neonMaterial)
      neon.position.set(0, 5.2, 0.25)
      group.add(beam, neon)
      for (const x of [-4.8, 4.8]) {
        const support = new THREE.Mesh(new THREE.BoxGeometry(0.28, 5.5, 0.28), gantryMaterial)
        support.position.set(x, 2.75, 0)
        group.add(support)
        this.sharedGeometries.push(support.geometry)
      }
      group.position.set(0, 0, -40 - i * 120)
      this.scene.add(group)
      this.gantries.push({ object: group, span: GANTRY_SPAN })
      this.sharedGeometries.push(beam.geometry, neon.geometry)
    }
  }

  /** 每帧更新（dt 秒；run 由页面/引擎推进） */
  update(run: ParkourRunState, ghostViews: ParkourGhostView[], dt: number): void {
    if (this.disposed) return
    const safeDt = Math.min(0.1, Math.max(0, dt))
    this.animationTime += safeDt
    const playerZ = -run.distanceM

    // 玩家
    const pose = run.alive ? parkourPose(run) : 'run'
    this.player.update(pose, run.elapsedMs / 1000 * (6 + run.speed * 0.55), run.speed)
    this.player.group.position.set(run.laneX, run.y, playerZ)
    if (!run.alive) {
      this.crashAt += safeDt
      if (run.cause === 'pit') {
        this.player.group.position.y = Math.max(-2.2, -this.crashAt * 3.2)
      } else {
        this.player.group.rotation.z = Math.min(1.3, this.crashAt * 3.5)
        this.player.group.rotation.x = Math.min(1.1, this.crashAt * 3)
      }
    } else {
      this.crashAt = 0
      this.player.group.rotation.set(0, 0, 0)
    }
    this.playerShadow.position.set(run.laneX, 0.014, playerZ)
    const shadowScale = Math.max(0.4, 1 - run.y * 0.22)
    this.playerShadow.scale.setScalar(shadowScale)
    ;(this.playerShadow.material as THREE.MeshBasicMaterial).opacity = run.alive ? 0.72 : 0.25

    // 护盾 / 磁铁 / 冲刺
    this.shieldGroup.position.set(run.laneX, run.y + 0.9, playerZ)
    this.shieldGroup.visible = run.shield && run.alive
    this.shieldGroup.rotation.y = this.animationTime * 0.8
    this.magnetRing.position.set(run.laneX, run.y + 0.85, playerZ)
    this.magnetRing.visible = run.elapsedMs < run.magnetUntil
    this.magnetRing.rotation.z = this.animationTime * 1.8
    this.dashTrail.position.set(run.laneX, run.y, playerZ)
    this.dashTrail.visible = run.elapsedMs < run.dashUntil && run.alive

    // 环境回收
    for (const item of this.environment) {
      if (item.object.position.z > playerZ + 55) item.object.position.z -= item.span
    }
    for (const item of this.streetlights) {
      if (item.object.position.z > playerZ + 40) item.object.position.z -= item.span
    }
    for (const item of this.gantries) {
      if (item.object.position.z > playerZ + 45) item.object.position.z -= item.span
    }

    this.syncObstacles(run)
    this.syncCoins(run)
    this.syncPowerUps(run)
    this.syncGhosts(ghostViews, run, safeDt)

    this.finishGate.visible = run.mode === 'race'
    this.updateCamera(run, safeDt)
    this.sky.position.set(this.camera.position.x, 0, playerZ - 8)
  }

  private syncObstacles(run: ParkourRunState): void {
    const visible = new Set<number>()
    for (const obstacle of run.obstacles) {
      if (obstacle.zEnd < run.distanceM - BEHIND_DISTANCE) continue
      if (obstacle.zStart > run.distanceM + VIEW_DISTANCE) continue
      visible.add(obstacle.id)
      let object = this.obstacleMeshes.get(obstacle.id)
      if (!object) {
        object = this.createObstacleObject(obstacle.kind, obstacle.id)
        this.obstacleMeshes.set(obstacle.id, object)
        this.obstacleRoot.add(object)
      }
      const x = parkourLaneCenter(obstacle.lane)
      const centerZ = -((obstacle.zStart + obstacle.zEnd) / 2)
      if (obstacle.kind === 'train') {
        const group = object as THREE.Group
        group.position.set(x, 0, centerZ)
        const body = group.children[0] as THREE.Mesh
        body.scale.set(2.25, 2.8, Math.max(1, obstacle.zEnd - obstacle.zStart))
        body.position.y = 1.4
        const frontZ = (obstacle.zEnd - obstacle.zStart) / 2 + 0.08
        const lightA = group.children[1] as THREE.Sprite
        const lightB = group.children[2] as THREE.Sprite
        lightA.position.set(-0.62, 1.0, frontZ)
        lightB.position.set(0.62, 1.0, frontZ)
      } else if (obstacle.kind === 'barrier') {
        const mesh = object as THREE.Mesh
        mesh.position.set(x, 0.55, centerZ)
        mesh.scale.set(2.05, 1.1, Math.max(0.3, obstacle.zEnd - obstacle.zStart))
      } else if (obstacle.kind === 'sign') {
        const group = object as THREE.Group
        group.position.set(x, 2.2, centerZ)
        group.scale.setScalar(1)
      } else {
        const group = object as THREE.Group
        group.position.set(x, 0.012, centerZ)
        const slab = group.children[0] as THREE.Mesh
        const edgeFront = group.children[1] as THREE.Mesh
        const edgeBack = group.children[2] as THREE.Mesh
        const length = Math.max(1, obstacle.zEnd - obstacle.zStart)
        slab.scale.set(2.18, 0.025, length)
        edgeFront.scale.set(2.18, 0.055, 0.14)
        edgeBack.scale.set(2.18, 0.055, 0.14)
        edgeFront.position.z = length / 2
        edgeBack.position.z = -length / 2
      }
    }
    for (const [id, object] of Array.from(this.obstacleMeshes.entries())) {
      if (visible.has(id)) continue
      this.obstacleRoot.remove(object)
      this.obstacleMeshes.delete(id)
    }
  }

  private createObstacleObject(
    kind: 'train' | 'barrier' | 'sign' | 'pit',
    id: number,
  ): THREE.Object3D {
    if (kind === 'train') {
      const group = new THREE.Group()
      const body = new THREE.Mesh(this.unitBox, this.trainMaterial)
      group.add(body)
      for (let i = 0; i < 2; i += 1) {
        const light = new THREE.Sprite(this.trainLightMaterial)
        light.scale.set(0.65, 0.65, 1)
        group.add(light)
      }
      return group
    }
    if (kind === 'barrier') {
      return new THREE.Mesh(this.unitBox, this.barrierMaterial)
    }
    if (kind === 'sign') {
      const template = this.signTemplates[id % this.signTemplates.length]
      const clone = template.clone(true)
      clone.visible = true
      return clone
    }
    const group = new THREE.Group()
    const slab = new THREE.Mesh(this.unitBox, this.pitMaterial)
    const edgeFront = new THREE.Mesh(this.unitBox, this.pitEdgeMaterial)
    const edgeBack = new THREE.Mesh(this.unitBox, this.pitEdgeMaterial)
    group.add(slab, edgeFront, edgeBack)
    return group
  }

  private syncCoins(run: ParkourRunState): void {
    let count = 0
    for (const pickup of run.pickups) {
      if (pickup.kind !== 'coin' || pickup.taken) continue
      if (pickup.z < run.distanceM - BEHIND_DISTANCE || pickup.z > run.distanceM + VIEW_DISTANCE) continue
      if (count >= 512) break
      const bob = Math.sin(this.animationTime * 3.4 + pickup.z * 0.55) * 0.06
      this.coinDummy.position.set(parkourLaneCenter(pickup.lane), pickup.y + bob, -pickup.z)
      this.coinDummy.rotation.set(Math.PI / 2, this.animationTime * 2.5 + pickup.z * 0.22, 0)
      this.coinDummy.scale.setScalar(1)
      this.coinDummy.updateMatrix()
      this.coinMesh.setMatrixAt(count, this.coinDummy.matrix)
      count += 1
    }
    this.coinMesh.count = count
    this.coinMesh.instanceMatrix.needsUpdate = true
  }

  private syncPowerUps(run: ParkourRunState): void {
    const visible = new Set<number>()
    for (const pickup of run.pickups) {
      if (pickup.kind === 'coin' || pickup.taken) continue
      if (pickup.z < run.distanceM - BEHIND_DISTANCE || pickup.z > run.distanceM + VIEW_DISTANCE) continue
      visible.add(pickup.id)
      let object = this.powerUpMeshes.get(pickup.id)
      if (!object) {
        const template = this.powerUpTemplates.get(pickup.kind)
        if (!template) continue
        const clone = template.clone(true)
        clone.visible = true
        object = clone
        this.powerUpMeshes.set(pickup.id, object)
        this.powerUpRoot.add(object)
      }
      object.position.set(
        parkourLaneCenter(pickup.lane),
        pickup.y + Math.sin(this.animationTime * 2.6 + pickup.z) * 0.12,
        -pickup.z,
      )
      object.rotation.y = this.animationTime * 1.6 + pickup.z * 0.1
    }
    for (const [id, object] of Array.from(this.powerUpMeshes.entries())) {
      if (visible.has(id)) continue
      this.powerUpRoot.remove(object)
      this.powerUpMeshes.delete(id)
    }
  }

  private syncGhosts(views: ParkourGhostView[], run: ParkourRunState, dt: number): void {
    const seen = new Set<number>()
    for (const view of views) {
      seen.add(view.userId)
      let ghost = this.ghosts.get(view.userId)
      if (!ghost) {
        const model = createRunnerModel(view.colorIndex, true)
        const group = new THREE.Group()
        group.add(model.group)
        this.ghostRoot.add(group)
        ghost = {
          group,
          model,
          displayDistance: view.distanceM,
          displayX: parkourLaneCenter(view.lane),
          targetDistance: view.distanceM,
          targetX: parkourLaneCenter(view.lane),
          pose: view.pose,
        }
        this.ghosts.set(view.userId, ghost)
      }
      ghost.targetDistance = view.distanceM
      ghost.targetX = parkourLaneCenter(view.lane)
      ghost.pose = view.pose
      ghost.displayDistance += (ghost.targetDistance - ghost.displayDistance) * Math.min(1, dt * 6)
      ghost.displayX += (ghost.targetX - ghost.displayX) * Math.min(1, dt * 10)
      ghost.group.position.set(ghost.displayX, 0, -ghost.displayDistance)
      // 只渲染领先的幽灵；落后/并排的对手交给顶部排名轨，避免出现在相机与玩家之间
      ghost.group.visible =
        ghost.displayDistance > run.distanceM + 1
        && ghost.displayDistance < run.distanceM + VIEW_DISTANCE
      ghost.model.update(ghost.pose, this.animationTime * 8 + view.userId * 0.7, 20)
    }
    for (const [userId, ghost] of Array.from(this.ghosts.entries())) {
      if (seen.has(userId)) continue
      this.ghostRoot.remove(ghost.group)
      ghost.model.dispose()
      this.ghosts.delete(userId)
    }
  }

  private updateCamera(run: ParkourRunState, dt: number): void {
    const playerZ = -run.distanceM
    const dash = run.elapsedMs < run.dashUntil
    const targetX = run.laneX * 0.48
    const targetY = 3.75 + run.y * 0.12
    const lerp = 1 - Math.exp(-dt * 8)
    this.cameraX += (targetX - this.cameraX) * lerp
    this.cameraY += (targetY - this.cameraY) * lerp
    let shakeX = 0
    let shakeY = 0
    if (run.lastHitAt > 0 && run.elapsedMs - run.lastHitAt < 260) {
      const decay = 1 - (run.elapsedMs - run.lastHitAt) / 260
      shakeX = (Math.random() - 0.5) * 0.34 * decay
      shakeY = (Math.random() - 0.5) * 0.28 * decay
    }
    this.camera.position.set(this.cameraX + shakeX, this.cameraY + shakeY, playerZ + 7.6)
    this.camera.lookAt(run.laneX * 0.34, 1.05 + run.y * 0.1, playerZ - 13)
    const targetFov = dash ? 72 : 62
    this.cameraFov += (targetFov - this.cameraFov) * Math.min(1, dt * 5)
    if (Math.abs(this.cameraFov - this.lastFov) > 0.05) {
      this.camera.fov = this.cameraFov
      this.camera.updateProjectionMatrix()
      this.lastFov = this.cameraFov
    }
  }

  resize(): void {
    const parent = this.canvas.parentElement
    const width = parent?.clientWidth || window.innerWidth
    const height = parent?.clientHeight || window.innerHeight
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    if (this.disposed) return
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const ghost of this.ghosts.values()) {
      ghost.model.dispose()
    }
    this.ghosts.clear()
    for (const template of this.signTemplates) this.disposeObject(template)
    for (const template of this.powerUpTemplates.values()) this.disposeObject(template)
    this.disposeObject(this.scene)
    this.renderer.dispose()
  }

  private disposeObject(root: THREE.Object3D): void {
    const textures = new Set<THREE.Texture>()
    const materials = new Set<THREE.Material>()
    const geometries = new Set<THREE.BufferGeometry>()
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      const sprite = object as THREE.Sprite
      const material = mesh.material ?? sprite.material
      if (!material) return
      const list = Array.isArray(material) ? material : [material]
      for (const item of list) {
        materials.add(item)
        for (const key of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
          const texture = (item as unknown as Record<string, unknown>)[key]
          if (texture instanceof THREE.Texture) textures.add(texture)
        }
      }
    })
    for (const texture of textures) texture.dispose()
    for (const material of materials) material.dispose()
    for (const geometry of geometries) geometry.dispose()
  }
}
