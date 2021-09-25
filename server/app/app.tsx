import JSX from './jsx/jsx.js'
import type { index } from '../../template/index.html'
import { loadTemplate } from '../template.js'
import express from 'express'
import { ExpressContext, WsContext } from './context.js'
import type { Element } from './jsx/types'
import { nodeToHTML } from './jsx/html.js'
import { sendHTML } from './express.js'
import { OnWsMessage } from '../ws/wss.js'
import { dispatchUpdate } from './jsx/dispatch.js'
import { EarlyTerminate } from './helpers.js'
import { getWSSession, sessions } from './session.js'
import { capitalize } from './string.js'
import type { ClientMessage } from '../../client/index'
import Style from './components/style.js'
import { ServerMessage } from '../../client/index'
import { Raw } from './components/raw.js'
import { loadState, saveState } from './state.js'
import { config } from '../config.js'

let template = loadTemplate<index>('index')

let colors = ['white', 'black', 'red', 'green', 'blue']

let style = Style(/* css */ `
#board {
  display: inline-flex;
  flex-direction: column;
  margin: 0.5em;
  outline: 2px solid lightgray;
  user-select: none;
}
#colorPanel .cell {
  border: 0.25em solid lightgray;
  outline: 1px solid lightgray;
}
.row {
  display: flex;
}
.cell {
  display: inline-block;
  width: 1em;
  height: 1em;
  outline: 1px solid lightgray;
}
${colors
  .map(
    color => `
.cell.${color} {
  background: ${color}
}
`,
  )
  .join('')}
`)

export function App(): Element {
  // you can write the AST direct for more compact wire-format
  return [
    'div.app',
    {},
    [
      // or you can write in JSX for better developer-experience (if you're coming from React)
      <>
        {style}
        <h1>live-paint</h1>
        <p>
          Powered by{' '}
          <a href="https://github.com/beenotung/ts-liveview/tree/v2-rc3-jsx-with-context">
            ts-liveview
          </a>
        </p>
        {colorPanel}
        {board}
      </>,
    ],
  ]
}

let colorPanel = (
  <fieldset id="colorPanel">
    <legend>Color Panel</legend>
    <div class="row">
      {[
        colors.map(color => (
          <div
            id={color}
            class="cell"
            style={`background: ${color}`}
            onclick={`pickColor('${color}', this)`}
          />
        )),
      ]}
    </div>
    {Raw(/* html */ `<script>
      function pickColor(color, div) {
        window.color = color;
        let colors = document.querySelectorAll('#colorPanel .cell');
        colors.forEach(div => {
          div.style.border = '';
        })
        div.style.border = '0.25em solid ' + color;
      }
    </script>`)}
  </fieldset>
)

let W = 20
let H = 20

let state = loadState()
let y_x_cell: Element[][] = []
let rows = new Array(H).fill(0).map((_, y) => {
  y_x_cell[y] = []
  return (
    <div class="row">
      {[
        new Array(W).fill(0).map((_, x) => {
          if (!state[y]) {
            state[y] = []
          }
          if (!state[y][x]) {
            state[y][x] = ''
          }
          let color = state[y][x] || 'white'
          let cell = (
            <div
              id={`c-${y}-${x}`}
              class={`cell ${color}`}
              onclick={`clickCell(${y},${x})`}
              onmousedown={`clickCell(${y},${x})`}
              onmouseover={`overCell(${y},${x})`}
              ontouchstart={`touchStartCell(${y},${x})`}
            ></div>
          )
          y_x_cell[y][x] = cell
          return cell
        }),
      ]}
    </div>
  )
})
let board = (
  <div id="board" ontouchmove="touchMoveBoard()">
    {[rows]}
    {Raw(/* html */ `<script>
      window.onmousedown = () => window.mouseDown = true
      window.onmouseup = () => window.mouseDown = false
      window.ontouchend = window.mouseDown = false
      function clickCell(y, x) {
        let color = window.color || 'black'
        emit('paint', {y, x, color})
      }
      function overCell(y, x) {
        if (!window.mouseDown) return
        clickCell(y, x)
      }
      function touchStartCell(y, x) {
        window.mouseDown = true
        clickCell(y, x)
      }
      function touchMoveBoard() {
        let touch = event.touches[0]
        let div = document.elementFromPoint(touch.clientX, touch.clientY)
        if (div && div.onmousedown) {
          div.onmousedown()
        }
      }
    </script>`)}
  </div>
)
enum Board {
  attrs = 1,
}
type PaintInput = { y: number; x: number; color: string }
function paint(input: PaintInput): void {
  let { y, x, color } = input
  let cell = y_x_cell[y][x]
  let className = 'cell ' + color
  cell[Board.attrs]!.class = className
  let message: ServerMessage = ['update-props', `#c-${y}-${x}`, { className }]
  sessions.forEach(session => session.ws.send(message))
  if (!config.development) {
    state[y][x] = color
    saveState(state)
  }
}

export let expressRouter = express.Router()
expressRouter.use((req, res, next) => {
  let context: ExpressContext = {
    type: 'express',
    req,
    res,
    next,
    url: req.url,
  }
  let app: string
  let description = 'TODO'
  try {
    app = nodeToHTML(<App />, context)
  } catch (error) {
    if (error === EarlyTerminate) {
      return
    }
    console.error('Failed to render App:', error)
    res.status(500)
    if (error instanceof Error) {
      app = 'Internal Error: ' + error.message
    } else {
      app = 'Unknown Error'
    }
  }
  let page = capitalize(req.url.split('/')[1] || 'Home Page')
  let html = template({
    title: `${page} - LiveView Demo`,
    description,
    app,
  })
  sendHTML(res, html)
})

export let onWsMessage: OnWsMessage<ClientMessage> = (event, ws, wss) => {
  let eventType: string | undefined
  let url: string
  let args: any[] | undefined
  let locale: string | undefined
  let timeZone: string | undefined
  if (event[0] === 'mount') {
    eventType = 'mount'
    url = event[1]
    locale = event[2]
    timeZone = event[3]
  } else if (event[0][0] === '/') {
    eventType = 'route'
    url = event[0]
    args = event.slice(1)
  } else if (event[0] === 'paint') {
    paint(event[1])
    return
  } else {
    console.log('unknown type of ws message:', event)
    return
  }
  let context: WsContext = {
    type: 'ws',
    ws,
    wss,
    url,
    args,
    event: eventType,
  }
  let session = getWSSession(ws)
  session.url = url
  if (locale) {
    session.locales = locale
  }
  if (timeZone) {
    session.timeZone = timeZone
  }
  dispatchUpdate(<App />, context)
}
