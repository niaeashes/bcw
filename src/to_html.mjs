import { Client } from '@notionhq/client'
import { promises as fs } from 'fs'
import util from 'util'
import path from 'path'
import Mustache from 'mustache'

const notion = new Client({ auth: process.env.NOTION_API_KEY })

const database_id = process.env.NOTION_DATABASE_ID

async function objectCache({ key }, source) {
  return new Promise((resolve, reject) => {
    fs.readFile(`./tmp/${key}.json`)
      .then(body => resolve(JSON.parse(body)))
      .catch(() => {
        source()
          .then((data) => {
            if (typeof data == 'undefined') {
              resolve(data)
            }
            fs.writeFile(`./tmp/${key}.json`, JSON.stringify(data))
            resolve(data)
          })
          .catch(reject)
      })
  })
}

function parseMinion(data) {
  const name = data.properties['名前'].title.map(e => e.plain_text).join("")
  const color = data.properties['色'].select.name
  const subtypes = data.properties['分類（ミニオン）'].multi_select.map(e => e.name)
  const cost = data.properties['コスト']
    .rich_text
    .map(rich_text => rich_text.plain_text)
    .join("\n")
  const power = data.properties['攻撃'].number
  const life = data.properties['生命'].number
  const label = `ミニオン ― ${subtypes.join("、")}`
  const size = `${power} / ${life}`
  return { color, name, cost, subtypes, power, life, label, size }
}

function parseGlyph(data) {
  const name = data.properties['名前'].title.map(e => e.plain_text).join("")
  const color = data.properties['色'].select.name
  const subtypes = data.properties['分類（グリフ）'].multi_select.map(e => e.name)
  const cost = data.properties['コスト']
    .rich_text
    .map(rich_text => rich_text.plain_text)
    .join("\n")
  const label = `グリフ ― ${subtypes.join("、")}`
  return { color, name, cost, subtypes, label }
}

function parseMateria(data) {
  const name = data.properties['名前'].title.map(e => e.plain_text).join("")
  const color = data.properties['色'].select.name
  const label = `マテリア ― ${color}`
  return { color, name, label }
}

function parseBlocks(blocks) {
  let effects = []
  blocks.results.forEach((block) => {
    if (block.type == 'paragraph') {
      effects.push(block.paragraph.text.map(text => text.plain_text).join(''))
    } else {
      console.log(block)
    }
  })
  return { effects }
}

async function loadData({ code }) {
  const key = `loadData.${code}`
  const response = await objectCache({ key }, async () => {
    return await notion.databases.query({
      database_id,
      filter: {
        and: [
          { property: "開発コード", text: { equals: code } },
        ],
      },
    })
  })
  if (response.results.length > 0) {
    const data = response.results[0]
    const page_id = data.id
    const key = `loadData.blocks.${code}`
    const { effects } = parseBlocks(await objectCache({ key }, () => {
      return notion.blocks.children.list({ block_id: page_id })
    }))
    const type = data.properties['種別'].select.name
    if (type == 'ミニオン') {
      return { type, ...parseMinion(data), effects }
    }
    if (type == 'グリフ') {
      return { type, ...parseGlyph(data), effects }
    }
    if (type == 'マテリア') {
      return { type, ...parseMateria(data), effects }
    }
    return { type }
  } else {
    return null
  }
}

async function loadDeck({ fullpath }) {
  const data = JSON.parse(await fs.readFile(fullpath))
  return await Promise.all(Object.keys(data.cards).map(async code => {
    return { code, count: data.cards[code], data: await loadData({ code }) }
  }))
  .then(recipe => {
    let cards = []
    recipe.forEach(item => {
      for (var i = 0; i < item.count; i++) {
        cards.push({ ...item.data, code: item.code })
      }
    })
    return { ...data, name: path.basename(fullpath), cards }
  })
}

async function renderDeck(deck) {
  const template = await fs.readFile('./src/template/deck.mustache', { encoding: 'utf-8' })
  const html = Mustache.render(template, deck)
  await fs.writeFile(`./dist/${deck.name}.html`, html)
}

fs.readdir('./decks')
  .then(files => Promise.all(files.map(path => loadDeck({ fullpath: `./decks/${path}` }).then(renderDeck))))
//  Promise.all(deck)
//    .then(result => console.log(util.inspect(result, false, null, true)))
