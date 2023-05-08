import { o } from './jsx/jsx.js'
import { scanTemplateDir } from '../template.js'
import express, { Response } from 'express'
import type { Context, ExpressContext, WsContext } from './context'
import type { Element, Node } from './jsx/types'
import { writeNode } from './jsx/html.js'
import { sendHTMLHeader } from './express.js'
import { OnWsMessage } from '../ws/wss.js'
import { dispatchUpdate } from './jsx/dispatch.js'
import { EarlyTerminate } from './helpers.js'
import { getWSSession, sessions } from './session.js'
import escapeHtml from 'escape-html'
import { config } from '../config.js'
import { MuteConsole } from './components/script.js'
import type {
  ClientMountMessage,
  ClientRouteMessage,
  ServerMessage,
} from '../../client/types'
import { renderIndexTemplate } from '../../template/index.js'
import escapeHTML from 'escape-html'
import { HTMLStream } from './jsx/stream.js'
import Style from './components/style.js'
import { Raw } from './components/raw.js'
import { loadState, saveState } from './state.js'

if (config.development) {
  scanTemplateDir('template')
}
function renderTemplate(
  stream: HTMLStream,
  context: Context,
  options: { title: string; description: string; app: Node },
) {
  const app = options.app
  renderIndexTemplate(stream, {
    title: escapeHTML(options.title),
    description: escapeHTML(options.description),
    app:
      typeof app == 'string' ? app : stream => writeNode(stream, app, context),
  })
}

let scripts = config.development ? (
  <script src="/js/index.js" type="module" defer></script>
) : (
  <>
    {MuteConsole}
    <script src="/js/bundle.min.js" type="module" defer></script>
  </>
)

let colors = ['white', 'black', 'red', 'green', 'blue']

let style = Style(/* css */ `
h1.title {
  color: darkblue;
}
h1.title a {
  font-size: 1rem;
}
#board {
  display: inline-flex;
  flex-direction: column;
  margin: 0.5em;
  outline: 2px solid lightgray;
  user-select: none;
}
#colorPanel {
  display: inline-block;
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
        <h1 class="title">
          live-paint{' '}
          <a href="https://news.ycombinator.com/item?id=28581843">HN</a>{' '}
          <a href="https://github.com/beenotung/live-paint">git</a>
        </h1>
        <p>
          Powered by{' '}
          <a href="https://github.com/beenotung/ts-liveview/tree/v5-minimal-template">
            ts-liveview
          </a>
        </p>
        {colorPanel}
        <br />
        {board}
        {scripts}
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

export let appRouter = express.Router()

appRouter.use((req, res, next) => {
  sendHTMLHeader(res)

  let context: ExpressContext = {
    type: 'express',
    req,
    res,
    next,
    url: req.url,
  }

  let html = ''
  let stream = {
    write(chunk: string) {
      html += chunk
    },
    flush() {},
  }

  try {
    renderTemplate(stream, context, {
      title: config.site_name,
      description: config.site_description,
      app: App(),
    })
  } catch (error) {
    if (error === EarlyTerminate) {
      return
    }
    console.error('Failed to render App:', error)
    if (!res.headersSent) {
      res.status(500)
    }
    html +=
      error instanceof Error
        ? 'Internal Error: ' + escapeHtml(error.message)
        : 'Unknown Error: ' + escapeHtml(String(error))
  }

  // deepcode ignore XSS: the dynamic content is html-escaped
  res.end(html)
})

export let onWsMessage: OnWsMessage = (event, ws, _wss) => {
  console.log('ws message:', event)
  // TODO handle case where event[0] is not url
  let eventType: string | undefined
  let url: string
  let args: unknown[] | undefined
  let session = getWSSession(ws)
  if (event[0] === 'mount') {
    event = event as ClientMountMessage
    eventType = 'mount'
    url = event[1]
    session.locales = event[2]
    let timeZone = event[3]
    if (timeZone && timeZone !== 'null') {
      session.timeZone = timeZone
    }
    session.timezoneOffset = event[4]
  } else if (event[0][0] === '/') {
    event = event as ClientRouteMessage
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
  session.url = url
  let context: WsContext = {
    type: 'ws',
    ws,
    url,
    args,
    event: eventType,
    session,
  }
  dispatchUpdate(context, <App />)
}
