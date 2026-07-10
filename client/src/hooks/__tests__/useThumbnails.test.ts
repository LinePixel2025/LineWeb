import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useThumbnails } from '../useThumbnails'

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '../../lib/api'

describe('useThumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty state initially', () => {
    const { result } = renderHook(() => useThumbnails([]))

    const thumbnail = result.current.getThumbnail(1)
    expect(thumbnail).toEqual({ url: null, loading: false, error: false })
  })

  it('should load thumbnail and return URL', async () => {
    const mockUrl = 'https://example.com/thumb.jpg'
    vi.mocked(api.get).mockResolvedValue({ url: mockUrl })

    const { result } = renderHook(() => useThumbnails([1]))

    await waitFor(() => {
      const thumbnail = result.current.getThumbnail(1)
      expect(thumbnail.url).toBe(mockUrl)
      expect(thumbnail.loading).toBe(false)
      expect(thumbnail.error).toBe(false)
    })

    expect(api.get).toHaveBeenCalledWith('/drive/thumbnails/1?size=medium&quality=0.8')
  })

  it('should handle loading error', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useThumbnails([1]))

    await waitFor(() => {
      const thumbnail = result.current.getThumbnail(1)
      expect(thumbnail.url).toBe(null)
      expect(thumbnail.loading).toBe(false)
      expect(thumbnail.error).toBe(true)
    })
  })

  it('should cache loaded thumbnails', async () => {
    const mockUrl = 'https://example.com/thumb.jpg'
    vi.mocked(api.get).mockResolvedValue({ url: mockUrl })

    const { result, rerender } = renderHook(
      ({ ids }) => useThumbnails(ids),
      { initialProps: { ids: [1] } }
    )

    await waitFor(() => {
      expect(result.current.getThumbnail(1).url).toBe(mockUrl)
    })

    expect(api.get).toHaveBeenCalledTimes(1)

    rerender({ ids: [1, 2] })

    await waitFor(() => {
      expect(result.current.getThumbnail(1).url).toBe(mockUrl)
    })

    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('should clear cache when clearCache is called', async () => {
    const mockUrl = 'https://example.com/thumb.jpg'
    vi.mocked(api.get).mockResolvedValue({ url: mockUrl })

    const { result } = renderHook(() => useThumbnails([1]))

    await waitFor(() => {
      expect(result.current.getThumbnail(1).url).toBe(mockUrl)
    })

    act(() => {
      result.current.clearCache()
    })

    expect(result.current.getThumbnail(1)).toEqual({ url: null, loading: false, error: false })
  })
})
