import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PARKOUR_DASH_MULT,
  PARKOUR_LANES,
  PARKOUR_LANE_WIDTH,
  PARKOUR_ONLINE_MAX_SPEED,
  PARKOUR_PLAYER_HEIGHT,
  PARKOUR_RACE_LENGTH_M,
  PARKOUR_SLIDE_HEIGHT,
  createParkourRun,
  parkourLaneCenter,
  parkourPose,
  parkourScore,
  parkourSpeed,
  requestParkourJump,
  requestParkourLane,
  setParkourSlide,
  stepParkour,
  type ParkourRunState,
} from '../parkour'
import {
  GAME_PARKOUR_ONLINE_ROUTE,
  GAME_PARKOUR_ROUTE,
  getGameCatalogEntry,
  isGamePlayable,
} from '../catalog'

function stepMany(run: ParkourRunState, frames: number): void {
  for (let i = 0; i < frames; i += 1) stepParkour(run, 1000 / 60)
}

function addObstacle(
  run: ParkourRunState,
  kind: 'train' | 'barrier' | 'sign' | 'pit',
  lane: 0 | 1 | 2,
  zStart: number,
  zEnd: number,
  bottom: number,
  top: number,
): void {
  run.obstacles.push({ id: run.nextObstacleId++, kind, lane, zStart, zEnd, bottom, top })
}

function stripHeader(source: string): string {
  const index = source.indexOf('*/')
  return index >= 0 ? source.slice(index + 2) : source
}

describe('parkour engine', () => {
  it('keeps the three-lane constants aligned', () => {
    expect(PARKOUR_LANES).toBe(3)
    expect(PARKOUR_LANE_WIDTH).toBe(2.4)
    expect(PARKOUR_RACE_LENGTH_M).toBe(800)
    expect(PARKOUR_ONLINE_MAX_SPEED).toBe(21)
    expect(PARKOUR_DASH_MULT).toBe(1.4)
    expect(PARKOUR_PLAYER_HEIGHT).toBe(1.7)
    expect(PARKOUR_SLIDE_HEIGHT).toBe(0.9)
    expect([0, 1, 2].map(parkourLaneCenter)).toEqual([-2.4, 0, 2.4])
  })

  it('is byte-identical to the server engine', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'src/lib/games/parkour.ts'), 'utf8')
    const serverSource = readFileSync(
      resolve(process.cwd(), '../server/src/services/gameParkour.ts'),
      'utf8',
    )
    expect(stripHeader(clientSource)).toBe(stripHeader(serverSource))
  })

  it('generates the same course for the same seed', () => {
    const a = createParkourRun({ seed: 123456, mode: 'race' })
    const b = createParkourRun({ seed: 123456, mode: 'race' })
    const c = createParkourRun({ seed: 654321, mode: 'race' })
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.pickups).toEqual(b.pickups)
    expect(a.obstacles.length).toBeGreaterThan(0)
    expect(a.obstacles[0].zStart).toBeGreaterThanOrEqual(40)
    expect(a.obstacles).not.toEqual(c.obstacles)
  })

  it('moves between lanes in 160ms and respects bounds', () => {
    const run = createParkourRun({ seed: 1, mode: 'race' })
    expect(run.laneX).toBe(0)
    expect(requestParkourLane(run, 1)).toBe(true)
    stepMany(run, 12)
    expect(run.laneX).toBeCloseTo(2.4, 6)
    expect(requestParkourLane(run, 1)).toBe(false)
    expect(requestParkourLane(run, -1)).toBe(true)
    stepMany(run, 12)
    expect(run.laneX).toBeCloseTo(0, 6)
    expect(requestParkourLane(run, -1)).toBe(true)
    stepMany(run, 12)
    expect(run.laneX).toBeCloseTo(-2.4, 6)
    expect(requestParkourLane(run, -1)).toBe(false)
  })

  it('jumps and slides with the expected poses', () => {
    const run = createParkourRun({ seed: 2, mode: 'race' })
    expect(parkourPose(run)).toBe('run')
    expect(requestParkourJump(run)).toBe(true)
    stepMany(run, 6)
    expect(run.y).toBeGreaterThan(0)
    expect(parkourPose(run)).toBe('jump')
    stepMany(run, 60)
    expect(run.grounded).toBe(true)
    expect(run.y).toBe(0)

    setParkourSlide(run, true)
    stepParkour(run, 1000 / 60)
    expect(parkourPose(run)).toBe('slide')
    setParkourSlide(run, false)
    stepParkour(run, 1000 / 60)
    expect(parkourPose(run)).toBe('run')
  })

  it('ends the run on a barrier but allows shield or jump', () => {
    const hit = createParkourRun({ seed: 3, mode: 'race' })
    hit.obstacles = []
    hit.pickups = []
    addObstacle(hit, 'barrier', 1, 2, 2.6, 0, 1.1)
    stepMany(hit, 30)
    expect(hit.alive).toBe(false)
    expect(hit.cause).toBe('hit')

    const shield = createParkourRun({ seed: 4, mode: 'race' })
    shield.obstacles = []
    shield.pickups = []
    shield.shield = true
    addObstacle(shield, 'barrier', 1, 2, 2.6, 0, 1.1)
    stepMany(shield, 30)
    expect(shield.alive).toBe(true)
    expect(shield.shield).toBe(false)

    const jumped = createParkourRun({ seed: 5, mode: 'race' })
    jumped.obstacles = []
    jumped.pickups = []
    addObstacle(jumped, 'barrier', 1, 2.5, 3.1, 0, 1.1)
    requestParkourJump(jumped)
    stepMany(jumped, 30)
    expect(jumped.alive).toBe(true)
  })

  it('requires a lane switch for trains and a slide for signs', () => {
    const train = createParkourRun({ seed: 6, mode: 'race' })
    train.obstacles = []
    train.pickups = []
    addObstacle(train, 'train', 1, 2, 12, 0, 2.8)
    stepMany(train, 40)
    expect(train.alive).toBe(false)

    const sign = createParkourRun({ seed: 7, mode: 'race' })
    sign.obstacles = []
    sign.pickups = []
    addObstacle(sign, 'sign', 1, 3, 3.7, 1.6, 2.8)
    stepMany(sign, 30)
    expect(sign.alive).toBe(false)

    const slide = createParkourRun({ seed: 8, mode: 'race' })
    slide.obstacles = []
    slide.pickups = []
    addObstacle(slide, 'sign', 1, 3, 3.7, 1.6, 2.8)
    setParkourSlide(slide, true)
    stepMany(slide, 30)
    expect(slide.alive).toBe(true)
  })

  it('kills on a pit even with a shield, but completes a race at 800m', () => {
    const pit = createParkourRun({ seed: 9, mode: 'race' })
    pit.obstacles = []
    pit.pickups = []
    pit.shield = true
    addObstacle(pit, 'pit', 1, 2, 5, 0, 0)
    stepMany(pit, 30)
    expect(pit.alive).toBe(false)
    expect(pit.cause).toBe('pit')

    const finish = createParkourRun({ seed: 10, mode: 'race', startDistanceM: 799.5 })
    finish.obstacles = []
    finish.pickups = []
    stepMany(finish, 20)
    expect(finish.finished).toBe(true)
    expect(finish.distanceM).toBe(800)
    expect(finish.speed).toBe(0)
  })

  it('collects coins, magnets and keeps the score formula', () => {
    const run = createParkourRun({ seed: 11, mode: 'race' })
    run.obstacles = []
    run.pickups = []
    run.magnetUntil = run.elapsedMs + 8000
    run.pickups.push(
      { id: 1, kind: 'coin', lane: 1, z: 0.5, y: 0.9, taken: false },
      { id: 2, kind: 'coin', lane: 0, z: 0.5, y: 0.9, taken: false },
    )
    stepMany(run, 20)
    expect(run.coins).toBe(2)
    expect(run.maxCombo).toBe(2)
    expect(parkourScore({ distanceM: 100, coins: 12, maxCombo: 8 })).toBe(380)
  })

  it('restores distance/lane/coins for reconnects and keeps speed caps', () => {
    const run = createParkourRun({
      seed: 12,
      mode: 'race',
      startDistanceM: 320,
      lane: 2,
      coins: 12,
      maxCombo: 8,
    })
    expect(run.distanceM).toBeGreaterThanOrEqual(320)
    expect(run.lane).toBe(2)
    expect(run.laneX).toBe(2.4)
    expect(run.coins).toBe(12)
    expect(run.maxCombo).toBe(8)

    run.distanceM = 500
    expect(parkourSpeed(run)).toBeCloseTo(10 + 500 * 0.014, 9)
    run.distanceM = 2000
    expect(parkourSpeed(run)).toBe(21)
    run.mode = 'endless'
    expect(parkourSpeed(run)).toBe(26)
  })
})

describe('parkour catalog', () => {
  it('registers the single and online routes', () => {
    const entry = getGameCatalogEntry('parkour')
    expect(entry).toBeDefined()
    expect(entry?.name).toBe('霓虹跑酷')
    expect(entry?.modes).toEqual(['single', 'online'])
    expect(entry?.route).toBe(GAME_PARKOUR_ROUTE)
    expect(entry?.onlineRoute).toBe(GAME_PARKOUR_ONLINE_ROUTE)
    expect(isGamePlayable('parkour')).toBe(true)
  })
})
