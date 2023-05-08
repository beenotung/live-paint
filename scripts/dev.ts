#!/usr/bin/env node

import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import child_process from 'child_process'
import debug from 'debug'

let log = debug('ts-liveview dev')
log.enabled = true

type Mode = 'build' | 'serve'
const mode = process.argv[2] as Mode

if (mode != 'build' && mode != 'serve') {
  console.log('Please specify a mode: build or serve')
  process.exit(1)
}

main()

let stop = async () => {}

if (mode === 'serve') {
  process.stdin.on('data', async chunk => {
    if (chunk.toString().trim() == 'rs') {
      log('manual restarting...')
      await stop()
      main()
    }
  })
}

async function main() {
  log('scanning files...')
  let files = scan()
  if (mode == 'build') {
    log('building', files.length, 'files...')
  } else if (mode == 'serve') {
    log('watching', files.length, 'files...')
  }
  await build(files)
  if (mode == 'build') {
    process.exit(0)
  }
}

function scan() {
  let files: string[] = []

  function scanDir(dir: string) {
    fs.readdirSync(dir).forEach(filename => {
      if (filename == 'node_modules') return
      let file = path.join(dir, filename)
      let stat = fs.statSync(file)
      if (stat.isDirectory()) {
        scanDir(file)
        return
      }
      if (stat.isFile()) {
        let ext = path.extname(filename)
        if (ext == '.ts' || ext == '.tsx') {
          files.push(file)
        }
      }
    })
  }

  scanDir('server')
  scanDir('client')
  scanDir('template')

  return files
}

async function build(files: string[]) {
  let plugins: esbuild.Plugin[] = []
  plugins.push({
    name: 'dev-server-watch',
    setup(build) {
      let count = 0
      build.onEnd(result => {
        count++
        log(`Finished build x${count}`)
        if (result.errors.length > 0) {
          log(result.errors)
        }
        postBuild()
      })
    },
  })
  let context = await esbuild.context({
    entryPoints: files,
    outdir: './dist',
    platform: 'node',
    format: 'esm',
    jsx: 'transform',
    jsxFactory: 'o',
    jsxFragment: 'null',
    plugins,
  })
  await context.rebuild()
  if (mode == 'serve') {
    await context.watch()
  }
  stop = () => context.dispose()
  if (mode == 'build') {
    log('build finished')
  }
  if (mode == 'serve') {
    log('initial build finished')
    log(
      'You can type "rs <Enter>" to restart manually (e.g. after added new files)',
    )
  }
}

function postBuild() {
  if (mode == 'serve') {
    restartServer()
  }
}

let stopServer = () => Promise.resolve()

let EPOCH = 0

async function restartServer() {
  await stopServer()
  log('starting server...')
  EPOCH++
  let server = child_process.spawn('node', ['dist/server/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      EPOCH: String(EPOCH),
    },
  })
  let stopped = false
  let stopServerPromise = new Promise<void>(resolve => {
    server.on('close', () => {
      stopped = true
      log('server stopped')
      resolve()
    })
  })
  stopServer = () => {
    if (stopped) {
      log('server already stopped')
    } else {
      log('stopping server...')
      server.kill()
    }
    return stopServerPromise
  }
}
