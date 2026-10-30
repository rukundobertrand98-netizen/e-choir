import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message })
    return
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 413
  ) {
    res.status(413).json({ error: 'The uploaded file is larger than the permitted size.' })
    return
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  ) {
    const target =
      'meta' in error &&
      typeof error.meta === 'object' &&
      error.meta !== null &&
      'target' in error.meta
        ? error.meta.target
        : null
    const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '')
    const message = targetText.includes('loginName')
      ? 'This full name is already used in this choir.'
      : targetText.includes('nameKey')
        ? 'A choir with this name already exists.'
        : 'A record with these details already exists.'
    res.status(409).json({ error: message })
    return
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  ) {
    res.status(409).json({ error: 'This record changed concurrently. Please retry.' })
    return
  }

  console.error('Unhandled request error', {
    name: error instanceof Error ? error.name : 'UnknownError',
  })
  res.status(500).json({ error: 'An unexpected server error occurred.' })
}
