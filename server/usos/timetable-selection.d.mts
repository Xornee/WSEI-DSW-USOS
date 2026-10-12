import type { ApiResponse, Plan, Stages, TimetableSelection } from '../../shared/types.js'
import type { TimetableRepository } from './timetable.mjs'
export interface StudyHint { programme: string; specialty: string | null; mode: 'N' | 'S' | null; degree: string | null; cohortYear: number; admission: 'Z' | 'L' }
export interface TrackCandidate extends StudyHint { trackId: string; title: string }
export function studyHints(stages: Stages): StudyHint[]
export function parseTrackFilters(html: string): { programmes: { id: string; title: string }[]; admissions: { id: string; title: string }[] }
export function parseTrackCandidates(html: string): TrackCandidate[]
export function matchingTracks(hint: StudyHint, tracks: TrackCandidate[]): TrackCandidate[]
export function trackSelection(candidates: TrackCandidate[], requestedId?: string): TimetableSelection
export class TrackCatalog { constructor(timetable: TimetableRepository, options?: { ttl?: number }); candidates(hints: StudyHint[]): Promise<TrackCandidate[]> }
export function publicPlan(timetable: TimetableRepository, id?: string): Promise<ApiResponse<Plan>>
