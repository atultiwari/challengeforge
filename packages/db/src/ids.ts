import { randomInt, randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()
export const newSeed = (): number => randomInt(0, 2 ** 31 - 1)
