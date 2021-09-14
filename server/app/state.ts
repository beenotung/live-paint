import { mkdirSync, existsSync, readFileSync } from 'fs'
import { writeFile, rename } from 'fs/promises'

import { join } from 'path'

if (!existsSync('data')) {
  mkdirSync('data')
}

let file = join('data', 'board.json')
let tmpfile = file + '.tmp'

// y -> x -> color
export type State = string[][]

export function loadState(): State {
  if (!existsSync(file)) {
    return []
  }
  return JSON.parse(readFileSync(file).toString())
}

let queue = Promise.resolve()

export function saveState(state: State) {
  queue = queue.then(async () => {
    try {
      await writeFile(tmpfile, JSON.stringify(state))
      await rename(tmpfile, file)
    } catch (error) {
      console.error('Failed to save state:', error)
    }
  })
}
