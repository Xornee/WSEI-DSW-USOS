import type { ApiResponse, Plan } from '../../shared/types.js'
export const TIMETABLE_ORIGIN: string
export const DEFAULT_TRACK_ID: string
export class TimetableError extends Error { status: number; constructor(status: number, message: string) }
export function trackId(value?: string): string
export function warsawInstant(date: string, time: string): string
export interface TrackInfo { trackId: string; title: string; from: string; to: string; state: Record<string, unknown> }
export function parseTrackPage(html: string, id?: string): TrackInfo
export function parseTrackGrid(html: string, info: TrackInfo): Plan
export class TimetableRepository {
 constructor(options?: { defaultTrackId?: string; fetchImpl?: typeof fetch; ttl?: number; intervalMs?: number })
 request(path: string, options?: RequestInit): Promise<string>
 defaultTrackId: string
 get(id?: string): Promise<ApiResponse<Plan>>
}
