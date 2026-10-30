export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export async function api<T = void>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(result?.error ?? 'The request could not be completed.', response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
