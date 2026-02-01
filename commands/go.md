---
description: Bridge to the Figma desktop app.
allowed-tools: Bash, Glob
---

# /fig:go

The `bun ${CLAUDE_PLUGIN_ROOT}/figma.ts` command is the bridge between the CLI and the Figma desktop app.
It evaluates JavaScript inside a running Figma dev plugin (main context), where the `figma` global is available,


```sh
bun ${CLAUDE_PLUGIN_ROOT}/figma.ts help
Usage:
  figma.ts status
  figma.ts start
  figma.ts restart
  figma.ts stop
  figma.ts eval [--client <id|index>]
```

# Example

- API docs: https://developers.figma.com/docs/plugins/api/figma/

```sh
bun ${CLAUDE_PLUGIN_ROOT}/figma.ts eval --client <id|index> <<'EOF'
// JS evaluated in Figma plugin context
EOF
```

## Output

```json
{"ok":true,"result":null,"logs":["console.log output"]}
```
`result` always null. Use `console.log()` + `JSON.stringify()` for data.


```js
// Async APIs
await figma.getNodeByIdAsync(id)        // not getNodeById
await figma.loadFontAsync({family, style})
await node.setVectorNetworkAsync(...)
await figma.getLocalPaintStylesAsync()
//Finding Nodes
figma.currentPage.children                                   // top-level nodes
figma.currentPage.findOne(n => n.name === "Button")          // first match
figma.currentPage.findAll(n => n.type === "RECTANGLE")       // all matches
figma.currentPage.findAll(n => n.name.includes("icon"))
await figma.getNodeByIdAsync("3:1419")                       // by ID
node.parent                                                  // parent node
// Reading Properties
node.id, node.name, node.type          // FRAME, RECTANGLE, TEXT, INSTANCE, COMPONENT...
node.x, node.y, node.width, node.height, node.rotation
node.visible, node.locked, node.opacity
node.fills, node.strokes, node.strokeWeight, node.effects
node.cornerRadius                      // may be figma.mixed
node.layoutMode                        // "NONE" | "HORIZONTAL" | "VERTICAL"
node.itemSpacing, node.paddingLeft/Right/Top/Bottom
node.absoluteBoundingBox               // {x, y, width, height} in page coords
// Modifying
node.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.2 } }]
node.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[1,0,0],[0,1,0]],
  gradientStops: [{position:0, color:{r:0.4,g:0.2,b:0.8,a:1}}, {position:1, color:{r:0.2,g:0.6,b:1,a:1}}] }]

node.strokes = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
node.strokeWeight = 2; node.strokeAlign = 'INSIDE'  // INSIDE, OUTSIDE, CENTER
node.effects = [{ type: 'DROP_SHADOW', color: {r:0,g:0,b:0,a:0.25}, offset: {x:0,y:4}, radius: 8, spread: 0, visible: true, blendMode: 'NORMAL' }]

node.x = 100; node.y = 200
node.resize(300, 150)
node.visible = false; node.opacity = 0.5
// Creating Nodes
const rect = figma.createRectangle()
rect.resize(200, 100); rect.fills = [{type:'SOLID', color:{r:0.2,g:0.6,b:1}}]; rect.cornerRadius = 8
figma.currentPage.appendChild(rect)

await figma.loadFontAsync({ family: "Inter", style: "Regular" })
const text = figma.createText()
text.fontName = {family:"Inter", style:"Regular"}; text.characters = "Hello"; text.fontSize = 24
figma.currentPage.appendChild(text)

const frame = figma.createFrame()
frame.layoutMode = "HORIZONTAL"; frame.itemSpacing = 12
frame.paddingLeft = frame.paddingRight = frame.paddingTop = frame.paddingBottom = 16
frame.primaryAxisSizingMode = "AUTO"; frame.counterAxisSizingMode = "AUTO"
figma.currentPage.appendChild(frame)

const comp = figma.createComponent(); comp.resize(120, 40)
const instance = comp.createInstance(); instance.x = 200
// Grouping & Booleans
figma.group([node1, node2], figma.currentPage)
figma.union([n1, n2], parent)      // also: subtract, intersect, exclude
// Selection & Viewport
figma.currentPage.selection                        // read
figma.currentPage.selection = [node]               // set
figma.viewport.scrollAndZoomIntoView([node])
figma.viewport.center = {x: 500, y: 300}; figma.viewport.zoom = 1
// Other
node.clone()                           // duplicate
node.remove()                          // delete
parent.insertChild(0, child)           // reorder (auto-layout)
figma.notify("Done!", {timeout: 3000}) // toast
await node.exportAsync({format:'PNG', constraint:{type:'SCALE', value:2}})  // returns Uint8Array
```
