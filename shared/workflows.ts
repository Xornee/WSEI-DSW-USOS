import type { SourceLink, SourceTable } from './sections'

export interface WorkflowField {
  name: string
  label: string
  type: 'text' | 'email' | 'number' | 'date' | 'tel' | 'url' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file'
  value: string
  required: boolean
  readonly: boolean
  multiple: boolean
  options: readonly { value: string; label: string; selected: boolean; disabled: boolean }[]
  maxLength?: number
  min?: string
  max?: string
  step?: string
  accept?: string
}
export interface WorkflowForm {
  id: string
  draftKey?: string
  title: string
  submitLabel: string
  changesAccount: boolean
  fields: readonly WorkflowField[]
}
export interface WorkflowPage {
  target: string
  title: string
  paragraphs: readonly string[]
  tables: readonly SourceTable[]
  links: readonly SourceLink[]
  forms: readonly WorkflowForm[]
  notices: readonly string[]
}
