const QR_VERSION = 10
const QR_SIZE = QR_VERSION * 4 + 17
const DATA_CODEWORDS = 274
const ERROR_CODEWORDS_PER_BLOCK = 18
const DATA_BLOCK_SIZES = [68, 68, 69, 69]
const MAX_QR_BYTE_LENGTH = Math.floor((DATA_CODEWORDS * 8 - 20) / 8)

const GF_EXP = new Array(512).fill(0)
const GF_LOG = new Array(256).fill(0)
let gfValue = 1
for (let i = 0; i < 255; i += 1) {
  GF_EXP[i] = gfValue
  GF_LOG[gfValue] = i
  gfValue <<= 1
  if (gfValue & 0x100) gfValue ^= 0x11d
}
for (let i = 255; i < GF_EXP.length; i += 1) GF_EXP[i] = GF_EXP[i - 255]

function gfMultiply(a, b) {
  return a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0
}

function reedSolomonDivisor(degree) {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

const RS_DIVISOR = reedSolomonDivisor(ERROR_CODEWORDS_PER_BLOCK)

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1)
}

function createDataCodewords(text) {
  const bytes = [...Buffer.from(String(text || ''), 'utf8')]
  if (!bytes.length) throw new Error('QR code content is required.')
  if (bytes.length > MAX_QR_BYTE_LENGTH) {
    throw new Error(`QR code content is too long. Maximum supported length is ${MAX_QR_BYTE_LENGTH} UTF-8 bytes.`)
  }

  const bits = []
  appendBits(bits, 0x4, 4) // byte mode
  appendBits(bits, bytes.length, 16) // version 10+ byte-mode character count
  for (const byte of bytes) appendBits(bits, byte, 8)

  const capacityBits = DATA_CODEWORDS * 8
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length))
  while (bits.length % 8) bits.push(0)

  const codewords = []
  for (let i = 0; i < bits.length; i += 8) {
    let codeword = 0
    for (let j = 0; j < 8; j += 1) codeword = (codeword << 1) | bits[i + j]
    codewords.push(codeword)
  }

  for (let pad = 0xec; codewords.length < DATA_CODEWORDS; pad = pad === 0xec ? 0x11 : 0xec) {
    codewords.push(pad)
  }
  return codewords
}

function createErrorCodewords(dataCodewords) {
  const result = new Array(ERROR_CODEWORDS_PER_BLOCK).fill(0)
  for (const codeword of dataCodewords) {
    const factor = codeword ^ result.shift()
    result.push(0)
    for (let i = 0; i < RS_DIVISOR.length; i += 1) {
      result[i] ^= gfMultiply(RS_DIVISOR[i], factor)
    }
  }
  return result
}

function createFinalCodewords(text) {
  const data = createDataCodewords(text)
  const blocks = []
  let offset = 0
  for (const size of DATA_BLOCK_SIZES) {
    const dataBlock = data.slice(offset, offset + size)
    offset += size
    blocks.push({ data: dataBlock, error: createErrorCodewords(dataBlock) })
  }

  const result = []
  const maxDataLength = Math.max(...DATA_BLOCK_SIZES)
  for (let i = 0; i < maxDataLength; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i])
    }
  }
  for (let i = 0; i < ERROR_CODEWORDS_PER_BLOCK; i += 1) {
    for (const block of blocks) result.push(block.error[i])
  }
  return result
}

function createMatrix() {
  return Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false))
}

function cloneMatrix(matrix) {
  return matrix.map((row) => row.slice())
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < QR_SIZE && y < QR_SIZE
}

function setFunctionModule(modules, isFunction, x, y, dark) {
  if (!inBounds(x, y)) return
  modules[y][x] = Boolean(dark)
  isFunction[y][x] = true
}

function setModule(modules, x, y, dark) {
  if (inBounds(x, y)) modules[y][x] = Boolean(dark)
}

function getBit(value, index) {
  return ((value >>> index) & 1) !== 0
}

function drawFinderPattern(modules, isFunction, x, y) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx
      const yy = y + dy
      if (!inBounds(xx, yy)) continue
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (
        dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
      )
      setFunctionModule(modules, isFunction, xx, yy, dark)
    }
  }
}

function drawAlignmentPattern(modules, isFunction, centerX, centerY) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(modules, isFunction, centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
}

function formatBits(mask) {
  const errorCorrectionFormatBits = 1 // L level
  const data = (errorCorrectionFormatBits << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) ? 0x537 : 0)
  return ((data << 10) | remainder) ^ 0x5412
}

function versionBits() {
  let remainder = QR_VERSION
  for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) ? 0x1f25 : 0)
  return (QR_VERSION << 12) | remainder
}

function drawFormatBits(modules, isFunction, mask) {
  const bits = formatBits(mask)
  const set = isFunction
    ? (x, y, dark) => setFunctionModule(modules, isFunction, x, y, dark)
    : (x, y, dark) => setModule(modules, x, y, dark)

  for (let i = 0; i <= 5; i += 1) set(8, i, getBit(bits, i))
  set(8, 7, getBit(bits, 6))
  set(8, 8, getBit(bits, 7))
  set(7, 8, getBit(bits, 8))
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, getBit(bits, i))

  for (let i = 0; i < 8; i += 1) set(QR_SIZE - 1 - i, 8, getBit(bits, i))
  for (let i = 8; i < 15; i += 1) set(8, QR_SIZE - 15 + i, getBit(bits, i))
  set(8, QR_SIZE - 8, true)
}

function drawVersionBits(modules, isFunction) {
  const bits = versionBits()
  for (let i = 0; i < 18; i += 1) {
    const bit = getBit(bits, i)
    const a = QR_SIZE - 11 + (i % 3)
    const b = Math.floor(i / 3)
    setFunctionModule(modules, isFunction, a, b, bit)
    setFunctionModule(modules, isFunction, b, a, bit)
  }
}

function drawFunctionPatterns(modules, isFunction) {
  drawFinderPattern(modules, isFunction, 0, 0)
  drawFinderPattern(modules, isFunction, QR_SIZE - 7, 0)
  drawFinderPattern(modules, isFunction, 0, QR_SIZE - 7)

  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    const dark = i % 2 === 0
    setFunctionModule(modules, isFunction, i, 6, dark)
    setFunctionModule(modules, isFunction, 6, i, dark)
  }

  const alignmentPositions = [6, 28, 50]
  for (let i = 0; i < alignmentPositions.length; i += 1) {
    for (let j = 0; j < alignmentPositions.length; j += 1) {
      const skipFinderCorner = (i === 0 && j === 0) || (i === 0 && j === alignmentPositions.length - 1) || (i === alignmentPositions.length - 1 && j === 0)
      if (!skipFinderCorner) drawAlignmentPattern(modules, isFunction, alignmentPositions[i], alignmentPositions[j])
    }
  }

  drawFormatBits(modules, isFunction, 0)
  drawVersionBits(modules, isFunction)
}

function drawCodewords(modules, isFunction, codewords) {
  const bits = []
  for (const codeword of codewords) appendBits(bits, codeword, 8)

  let bitIndex = 0
  let upward = true
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1
    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical
      for (let dx = 0; dx < 2; dx += 1) {
        const x = right - dx
        if (isFunction[y][x]) continue
        modules[y][x] = bitIndex < bits.length ? Boolean(bits[bitIndex]) : false
        bitIndex += 1
      }
    }
    upward = !upward
  }
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5: return ((x * y) % 2 + (x * y) % 3) === 0
    case 6: return (((x * y) % 2 + (x * y) % 3) % 2) === 0
    case 7: return (((x + y) % 2 + (x * y) % 3) % 2) === 0
    default: return false
  }
}

function applyMask(modules, isFunction, mask) {
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (!isFunction[y][x] && maskCondition(mask, x, y)) modules[y][x] = !modules[y][x]
    }
  }
}

function linePenalty(values) {
  let penalty = 0
  let runColor = values[0]
  let runLength = 1
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === runColor) {
      runLength += 1
    } else {
      if (runLength >= 5) penalty += 3 + (runLength - 5)
      runColor = values[i]
      runLength = 1
    }
  }
  if (runLength >= 5) penalty += 3 + (runLength - 5)
  return penalty
}

function finderLikePenalty(values) {
  let penalty = 0
  const patterns = ['10111010000', '00001011101']
  const line = values.map((item) => (item ? '1' : '0')).join('')
  for (const pattern of patterns) {
    let index = line.indexOf(pattern)
    while (index !== -1) {
      penalty += 40
      index = line.indexOf(pattern, index + 1)
    }
  }
  return penalty
}

function scoreMatrix(modules) {
  let penalty = 0
  for (let y = 0; y < QR_SIZE; y += 1) {
    penalty += linePenalty(modules[y])
    penalty += finderLikePenalty(modules[y])
  }
  for (let x = 0; x < QR_SIZE; x += 1) {
    const column = modules.map((row) => row[x])
    penalty += linePenalty(column)
    penalty += finderLikePenalty(column)
  }

  for (let y = 0; y < QR_SIZE - 1; y += 1) {
    for (let x = 0; x < QR_SIZE - 1; x += 1) {
      const color = modules[y][x]
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) penalty += 3
    }
  }

  const darkCount = modules.flat().filter(Boolean).length
  const total = QR_SIZE * QR_SIZE
  const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1
  penalty += Math.max(0, k) * 10
  return penalty
}

export function createQrMatrix(text) {
  const modules = createMatrix()
  const isFunction = createMatrix()
  drawFunctionPatterns(modules, isFunction)
  drawCodewords(modules, isFunction, createFinalCodewords(text))

  let bestMatrix = null
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = cloneMatrix(modules)
    applyMask(candidate, isFunction, mask)
    drawFormatBits(candidate, null, mask)
    const penalty = scoreMatrix(candidate)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMatrix = candidate
    }
  }
  return bestMatrix
}

export function generateQrSvg(text, options = {}) {
  const margin = Number.isFinite(Number(options.margin)) ? Math.max(0, Number(options.margin)) : 4
  const moduleSize = Number.isFinite(Number(options.moduleSize)) ? Math.max(1, Number(options.moduleSize)) : 4
  const matrix = createQrMatrix(text)
  const viewSize = QR_SIZE + margin * 2
  const outputSize = viewSize * moduleSize
  const paths = []

  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (matrix[y][x]) paths.push(`M${x + margin},${y + margin}h1v1h-1z`)
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tournament page QR code" width="${outputSize}" height="${outputSize}" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges">\n  <rect width="100%" height="100%" fill="#fff"/>\n  <path fill="#000" d="${paths.join(' ')}"/>\n</svg>`
}

export { MAX_QR_BYTE_LENGTH, QR_SIZE }
