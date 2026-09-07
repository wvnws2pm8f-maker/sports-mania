// 依存ライブラリなし(Node標準のzlibのみ)でPNGアイコンを描く簡易スクリプト。
// ダークネイビー背景に、緑のボール型アイコンを描く。
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function makeIcon(size) {
  const data = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const ballRadius = size * 0.32
  const bg = [11, 18, 32] // #0b1220
  const ball = [78, 225, 160] // #4ee1a0
  const ballDark = [30, 90, 65]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b] = bg
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < ballRadius) {
        // ボール本体(上側を少し明るく、光が当たっている感じに)
        const lightT = Math.max(0, (-dy / ballRadius + 1) / 2)
        r = Math.round(ballDark[0] + (ball[0] - ballDark[0]) * lightT)
        g = Math.round(ballDark[1] + (ball[1] - ballDark[1]) * lightT)
        b = Math.round(ballDark[2] + (ball[2] - ballDark[2]) * lightT)

        // 縫い目っぽいライン(横一本+縦一本、細め)
        if (Math.abs(dx) < size * 0.012 || Math.abs(dy) < size * 0.012) {
          r = bg[0]; g = bg[1]; b = bg[2]
        }
      } else if (dist < ballRadius + size * 0.02) {
        // ふちの光彩
        r = ball[0]; g = ball[1]; b = ball[2]
      }

      const idx = (y * size + x) * 4
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = b
      data[idx + 3] = 255
    }
  }
  return encodePNG(size, size, data)
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  function chunk(type, d) {
    const typeBuf = Buffer.from(type, 'ascii')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(d.length, 0)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, d])), 0)
    return Buffer.concat([lenBuf, typeBuf, d, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [192, 512]) {
  const png = makeIcon(size)
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png)
  console.log(`wrote icon-${size}.png (${png.length} bytes)`)
}
