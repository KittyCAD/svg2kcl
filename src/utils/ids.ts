import { customAlphabet } from 'nanoid/non-secure'

export function newId(prefix?: string): string {
  // Generate a new UUID for segment IDs.
  // return uuidv4()
  const nanoid = customAlphabet('1234567890abcdef', 6)
  return prefix ? `${prefix}_${nanoid()}` : nanoid()
}
