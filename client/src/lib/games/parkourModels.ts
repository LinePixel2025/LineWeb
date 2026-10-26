import * as THREE from 'three'

/** 霓虹跑酷低模资产：跑者 / 悬空牌 / 道具 / 终点门 / 脚底阴影 */

export interface RunnerColors {
  jacket: number
  accent: number
  pants: number
  skin: number
  hair: number
  shoe: number
}

/** 6 套座位配色（与联机 colorIndex 对齐） */
export const PARKOUR_RUNNER_COLORS: RunnerColors[] = [
  { jacket: 0x22d3ee, accent: 0xf8fafc, pants: 0x0e7490, skin: 0xc98b63, hair: 0x0f172a, shoe: 0xf43f5e },
  { jacket: 0xfb7185, accent: 0xffe4e6, pants: 0x9f1239, skin: 0xd6a07a, hair: 0x1c1210, shoe: 0x38bdf8 },
  { jacket: 0xa3e635, accent: 0xf7fee7, pants: 0x3f6212, skin: 0xb97a56, hair: 0x111827, shoe: 0xfacc15 },
  { jacket: 0xa78bfa, accent: 0xf3e8ff, pants: 0x5b21b6, skin: 0xe0b08a, hair: 0x0b0614, shoe: 0x22d3ee },
  { jacket: 0xfbbf24, accent: 0xfffbeb, pants: 0x92400e, skin: 0xc58a63, hair: 0x1f1305, shoe: 0xf472b6 },
  { jacket: 0xf472b6, accent: 0xffe4f1, pants: 0x9d174d, skin: 0xd9a17f, hair: 0x180b12, shoe: 0x60a5fa },
]

const RUN_PHASE_SCALE = 0.85

export interface RunnerModel {
  group: THREE.Group
  body: THREE.Group
  update: (pose: 'run' | 'jump' | 'slide', phase: number, speed: number) => void
  dispose: () => void
}

function standard(color: number, ghost: boolean, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive === 0x000000 ? 0 : 0.55,
    roughness: 0.72,
    metalness: 0.08,
    transparent: ghost,
    opacity: ghost ? 0.42 : 1,
    depthWrite: !ghost,
  })
}

/** 低模跑者：躯干 + 头 + 四肢 pivot + 飘带；朝 -Z 前进 */
export function createRunnerModel(colorIndex: number, ghost = false): RunnerModel {
  const colors = PARKOUR_RUNNER_COLORS[((colorIndex % PARKOUR_RUNNER_COLORS.length) + PARKOUR_RUNNER_COLORS.length) % PARKOUR_RUNNER_COLORS.length]
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const track = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.push(geometry)
    return geometry
  }
  const material = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    materials.push(m)
    return m
  }

  const jacket = material(standard(colors.jacket, ghost, ghost ? colors.jacket : 0x000000))
  const accent = material(standard(colors.accent, ghost, colors.accent))
  const pants = material(standard(colors.pants, ghost))
  const skin = material(standard(colors.skin, ghost))
  const hair = material(standard(colors.hair, ghost))
  const shoe = material(standard(colors.shoe, ghost, colors.shoe))

  const torso = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.58, 0.26)), jacket)
  torso.position.y = 1.12
  torso.castShadow = false
  body.add(torso)

  const chest = new THREE.Mesh(track(new THREE.BoxGeometry(0.48, 0.07, 0.28)), accent)
  chest.position.set(0, 1.04, -0.005)
  body.add(chest)

  const neck = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 8)), skin)
  neck.position.y = 1.46
  body.add(neck)

  const head = new THREE.Mesh(track(new THREE.SphereGeometry(0.19, 12, 10)), skin)
  head.position.y = 1.62
  body.add(head)

  const hairMesh = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.198, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56)),
    hair,
  )
  hairMesh.position.y = 1.65
  body.add(hairMesh)

  const makeLimb = (
    x: number,
    y: number,
    width: number,
    length: number,
    limbMaterial: THREE.MeshStandardMaterial,
    footMaterial: THREE.MeshStandardMaterial,
    footWidth: number,
    footDepth: number,
  ): { pivot: THREE.Group; foot: THREE.Mesh } => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const limb = new THREE.Mesh(track(new THREE.BoxGeometry(width, length, width)), limbMaterial)
    limb.position.y = -length / 2
    pivot.add(limb)
    const foot = new THREE.Mesh(track(new THREE.BoxGeometry(footWidth, 0.1, footDepth)), footMaterial)
    foot.position.set(0, -length - 0.02, -0.05)
    pivot.add(foot)
    body.add(pivot)
    return { pivot, foot }
  }

  const leftArm = makeLimb(-0.31, 1.34, 0.11, 0.48, jacket, skin, 0.13, 0.16)
  const rightArm = makeLimb(0.31, 1.34, 0.11, 0.48, jacket, skin, 0.13, 0.16)
  const leftLeg = makeLimb(-0.13, 0.78, 0.16, 0.68, pants, shoe, 0.2, 0.3)
  const rightLeg = makeLimb(0.13, 0.78, 0.16, 0.68, pants, shoe, 0.2, 0.3)

  const scarfPivot = new THREE.Group()
  scarfPivot.position.set(0, 1.4, 0.12)
  const scarf = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.05, 0.52)), accent)
  scarf.position.set(0, 0, 0.26)
  scarfPivot.add(scarf)
  body.add(scarfPivot)

  const backpack = new THREE.Mesh(track(new THREE.BoxGeometry(0.3, 0.34, 0.14)), hair)
  backpack.position.set(0, 1.15, 0.19)
  body.add(backpack)

  let phase = 0
  let lastPose: 'run' | 'jump' | 'slide' = 'run'

  const update = (pose: 'run' | 'jump' | 'slide', runPhase: number, speed: number): void => {
    if (lastPose !== pose) {
      lastPose = pose
      if (pose !== 'slide') {
        body.rotation.x = 0
        body.position.y = 0
      }
    }
    phase = runPhase
    if (pose === 'run') {
      const swing = Math.sin(phase) * RUN_PHASE_SCALE
      const pace = Math.min(1.2, 0.55 + speed / 30)
      leftLeg.pivot.rotation.x = swing * pace
      rightLeg.pivot.rotation.x = -swing * pace
      leftArm.pivot.rotation.x = -swing * 0.75
      rightArm.pivot.rotation.x = swing * 0.75
      leftArm.pivot.rotation.z = -0.08
      rightArm.pivot.rotation.z = 0.08
      body.rotation.x = 0.08 + Math.min(0.16, speed / 130)
      body.position.y = Math.abs(Math.sin(phase * 2)) * 0.035
      scarfPivot.rotation.x = -0.2 + Math.sin(phase * 1.7) * 0.12
      scarfPivot.rotation.z = Math.sin(phase * 1.3) * 0.15
      return
    }
    if (pose === 'jump') {
      leftLeg.pivot.rotation.x = 1.05
      rightLeg.pivot.rotation.x = 0.38
      leftArm.pivot.rotation.x = -1.5
      rightArm.pivot.rotation.x = -1.25
      leftArm.pivot.rotation.z = -0.25
      rightArm.pivot.rotation.z = 0.25
      body.rotation.x = -0.12
      body.position.y = 0
      scarfPivot.rotation.x = -0.65
      scarfPivot.rotation.z = Math.sin(phase * 1.9) * 0.22
      return
    }
    body.rotation.x = -1.12
    body.position.y = 0.3
    leftLeg.pivot.rotation.x = -0.35
    rightLeg.pivot.rotation.x = 0.22
    leftArm.pivot.rotation.x = 0.8
    rightArm.pivot.rotation.x = -0.4
    leftArm.pivot.rotation.z = -0.7
    rightArm.pivot.rotation.z = 0.7
    scarfPivot.rotation.x = 0.8
    scarfPivot.rotation.z = Math.sin(phase * 2.2) * 0.2
  }

  const dispose = (): void => {
    for (const geometry of geometries) geometry.dispose()
    for (const m of materials) m.dispose()
  }

  return { group, body, update, dispose }
}

/** 悬空霓虹广告牌（两根细柱 + 发光面板） */
export function createSignModel(texture: THREE.Texture, accent = 0x65e6ff): THREE.Group {
  const group = new THREE.Group()
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b1020,
    emissive: accent,
    emissiveIntensity: 0.18,
    roughness: 0.5,
  })
  const panelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.2, 0.12), frameMaterial)
  group.add(frame)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 1.08), panelMaterial)
  panel.position.z = 0.066
  group.add(panel)
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 1.35), glowMaterial)
  glow.position.z = 0.07
  group.add(glow)
  const poleMaterial = new THREE.MeshBasicMaterial({ color: 0x1e293b })
  for (const x of [-1.12, 1.12]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.8, 6), poleMaterial)
    // 面板中心放到 y=2.2 时，立柱正好从地面伸到面板下沿
    pole.position.set(x, -1.3, 0)
    group.add(pole)
  }
  return group
}

/** 道具：护盾 / 磁铁 / 冲刺 */
export function createPowerUpModel(kind: 'shield' | 'magnet' | 'dash'): THREE.Group {
  const group = new THREE.Group()
  const palette = {
    shield: { color: 0x65e6ff, emissive: 0x22d3ee },
    magnet: { color: 0xff6bc1, emissive: 0xf472b6 },
    dash: { color: 0xffc857, emissive: 0xff9f1c },
  } as const
  const color = palette[kind]
  const material = new THREE.MeshStandardMaterial({
    color: color.color,
    emissive: color.emissive,
    emissiveIntensity: 1.1,
    roughness: 0.25,
    metalness: 0.3,
  })
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: color.color,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  if (kind === 'shield') {
    const shield = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), material)
    shield.scale.y = 1.2
    group.add(shield)
  } else if (kind === 'magnet') {
    const magnet = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.09, 8, 16, Math.PI * 1.45), material)
    magnet.rotation.z = Math.PI * 0.28
    group.add(magnet)
    const barMaterial = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, emissive: 0x94a3b8, emissiveIntensity: 0.3 })
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.1), barMaterial)
    bar.position.y = -0.16
    group.add(bar)
  } else {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 5), material)
    arrow.rotation.x = Math.PI
    group.add(arrow)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 20), material)
    ring.rotation.x = Math.PI / 2
    ring.position.y = -0.3
    group.add(ring)
  }

  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), glowMaterial)
  group.add(halo)
  return group
}

/** 终点门：两根霓虹立柱 + 横幅 */
export function createFinishGateModel(texture: THREE.Texture): THREE.Group {
  const group = new THREE.Group()
  const pillarMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b1020,
    emissive: 0x65e6ff,
    emissiveIntensity: 0.45,
    roughness: 0.35,
  })
  for (const x of [-4.6, 4.6]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.2, 0.5), pillarMaterial)
    pillar.position.set(x, 2.6, 0)
    group.add(pillar)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.4, 0.6), pillarMaterial)
  beam.position.set(0, 5.25, 0)
  group.add(beam)
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 1.6),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
  )
  banner.position.set(0, 4.25, 0.05)
  group.add(banner)
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x65e6ff,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 2.2), glowMaterial)
  glow.position.set(0, 4.25, -0.02)
  group.add(glow)
  return group
}

/** 玩家脚底柔和阴影（跟随跳跃高度缩放） */
export function createBlobShadow(texture: THREE.Texture): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.012
  mesh.renderOrder = 2
  return mesh
}
