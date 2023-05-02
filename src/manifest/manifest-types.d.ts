export interface LazyWriter {
  write(data: string): void
  close(): Promise<void>
}

export type LazyConstructor = (path: string) => LazyWriter
