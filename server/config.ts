import { config as loadEnv } from 'dotenv'
import { populateEnv } from 'populate-env'

loadEnv()

let env = {
  NODE_ENV: 'development',
  PORT: 8100,
  EPOCH: 1, // to distinct initial run or restart in serve mode
}

populateEnv(env, { mode: 'halt' })


let production = env.NODE_ENV === 'production' || process.argv[2] === '--prod'
let development = env.NODE_ENV === 'development' || process.argv[2] === '--dev'



function fixEpoch() {
  // workaround of initial build twice since esbuild v0.17
  if (env.EPOCH >= 2) {
    return env.EPOCH - 1
  }
  return env.EPOCH
}

let epoch = fixEpoch()

export let config = {
  production,
  development,
  port: env.PORT,
  site_name: 'live-paint',
  site_description: 'Realtime collaborative casual canvas',
  setup_robots_txt: false,
  epoch,
  auto_open: !production && development && epoch === 1,
}

export function title(page: string) {
  return page + ' | ' + config.site_name
}

export let apiEndpointTitle = title('API Endpoint')
