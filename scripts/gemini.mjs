// Gemini API(無料枠あり)の薄いラッパー。GEMINI_API_KEYが無ければ何もせずnullを返す
// (=AI機能はオプション。キーが無くてもニュース取得・ロスター取得自体は今まで通り動く)。
// GitHub Actionsでは Settings > Secrets and variables > Actions に登録した
// GEMINI_API_KEY を workflow の env: 経由で渡している。
// 2026-09時点: gemini-2.0-flash は廃止され、gemini-3.6-flash への切り替えが必要
// (実際にワークフロー実行時に "model ... is no longer available" エラーで判明した)。
//
// 【用途ごとにモデルを分けている理由(2026-10-03)】
// 無料枠はモデルごとに別々に数えられる。Google AI Studioのレート制限画面で確認したところ、
// gemini-3.6-flash の無料枠は 1日20回・1分5回 しかなく、15分おきのニュース翻訳だけで
// 使い切っていた(ニュース翻訳が何時間も止まっていた本当の原因)。一方 Gemma 4 は
// 1分30回で別枠。そこで:
//   - news(見出し翻訳)      → Gemma 4 31B
//   - commentary(一言解説)  → Gemma 4 26B
//   - boxing(Wikipediaの文章から試合を抜き出す) → Gemma 4 26B
//   - search(Web検索付き) → gemini-3.6-flash。ただし無料枠では検索機能が使えないらしく(2026-10-03、
//     検索付きの呼び出しだけが理由なしの429で断られた)、現在どこからも使っていない
// GemmaのモデルIDは実行時にモデル一覧APIから探す(IDの細かい表記を推測に頼らないため)。
// GitHubのリポジトリ変数 GEMINI_MODEL_NEWS / GEMINI_MODEL_COMMENTARY / GEMINI_MODEL_SEARCH を
// 設定すれば、コードを変えずにモデルを差し替えられる。
const MODEL_ROLES = {
  // 31Bが混雑(503)・タイムアウト・枠切れで答えない時は、26Bで代わりに翻訳する(fallbackRoles)
  news: { env: 'GEMINI_MODEL_NEWS', match: /^gemma-4-31b/, fallback: 'gemma-4-31b-it', fallbackRoles: ['commentary'] },
  commentary: { env: 'GEMINI_MODEL_COMMENTARY', match: /^gemma-4-26b/, fallback: 'gemma-4-26b-it' },
  // ボクシング: Wikipediaから取った文章の中から試合結果・予定を抜き出す(検索は使わない)
  boxing: { env: 'GEMINI_MODEL_BOXING', match: /^gemma-4-26b/, fallback: 'gemma-4-26b-it', fallbackRoles: ['news'] },
  search: { env: 'GEMINI_MODEL_SEARCH', match: null, fallback: 'gemini-3.6-flash' }
}

let modelListPromise = null
async function listModelIds(key) {
  if (!modelListPromise) {
    modelListPromise = (async () => {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        return (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => m.name.replace(/^models\//, ''))
      } catch (err) {
        console.error(`Gemini model list failed: ${err.message}`)
        return []
      }
    })()
  }
  return modelListPromise
}

const resolvedModels = new Map()
export async function resolveModel(role) {
  if (resolvedModels.has(role)) return resolvedModels.get(role)
  const cfg = MODEL_ROLES[role]
  let model = process.env[cfg.env] || null
  if (!model && cfg.match) {
    const ids = await listModelIds(process.env.GEMINI_API_KEY)
    model = ids.find((id) => cfg.match.test(id)) || null
  }
  model = model || cfg.fallback
  console.log(`Gemini model for ${role}: ${model}`)
  resolvedModels.set(role, model)
  return model
}

const isGemma = (model) => /^gemma/i.test(model)

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY)
}

// 1回の実行(1回のnodeプロセス)内でクォータ超過を検知したら、以降の呼び出しは
// フェッチすら行わず即座に諦める。同じ実行の中で見出し翻訳がクォータ超過で失敗した後、
// 本文翻訳(1回でも呼べば必ず同じ理由で失敗する)まで律儀に試みて無駄にAPIへ
// アクセスし続けることが無いようにする(2026-09-22、本文翻訳が常に0件だった問題の対策の一部)。
let quotaExhaustedThisRun = false
// 1日の枠を使い切ったモデル(このプロセス内)。代わりのモデルがあればそちらで続ける。
const exhaustedModels = new Set()
// 混雑(503)・タイムアウト等で応答しなかったモデル(このプロセス内)。次の呼び出しでは後回しにする。
const unresponsiveModels = new Set()

// 呼び出し側(fetch-news.mjs)が「今回クォータ超過にぶつかったか」を見て、次回以降しばらく
// 翻訳の試行自体をスキップする(無駄打ちを減らす)バックオフ判断に使う。
export function hasQuotaExhausted() {
  return quotaExhaustedThisRun
}

// 429エラー本文のdetailsから、どの上限(quotaId)に当たったかと、何秒待てばよいか(retryDelay)を取り出す。
// perMinuteOnly: 当たった上限がすべて「1分あたり」で、待てば回復するもの(1日の上限や、
// 無料枠では使えない機能=上限0 は含まない)。retryDelayが60秒を超える場合も待たずに諦める。
function parseQuotaError(text) {
  const result = { message: '', violations: [], perMinuteOnly: false, retryDelaySec: null }
  let err
  try {
    err = JSON.parse(text).error
  } catch {
    return result
  }
  result.message = String(err?.message || '').trim()
  let allPerMinute = true
  for (const d of err?.details || []) {
    for (const v of d.violations || []) {
      if (!v.quotaId) continue
      result.violations.push(`${v.quotaId}${v.quotaValue != null ? ` limit=${v.quotaValue}` : ''}`)
      if (!/PerMinute/i.test(v.quotaId) || String(v.quotaValue) === '0') allPerMinute = false
    }
    const m = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay || '')
    if (m) result.retryDelaySec = Math.ceil(Number(m[1]))
  }
  result.perMinuteOnly =
    result.violations.length > 0 && allPerMinute && (result.retryDelaySec == null || result.retryDelaySec <= 60)
  return result
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// asJson: true にすると、Gemini自身にJSONとしてのみ応答するよう強制する
// (responseMimeType)。プロンプトの指示だけに頼ると、内容が単純な記事(見出し=要約の
// 動画ハイライトなど)でGeminiが前置き文や説明を付けて返し、JSON parseに失敗することが
// あったため、これで確実にJSONだけを返させる。
// role: 'news' | 'commentary'(上のMODEL_ROLES参照)。
// GemmaはJSONモード(responseMimeType)に対応していないので、Gemmaの時はプロンプトの指示だけに頼り、
// 呼び出し側のparseGeminiJsonで前置き文などを剥がして取り出す。
export async function callGemini(prompt, { asJson = false, retries = 2, role = 'news', timeoutMs = 60000 } = {}) {
  if (!hasGeminiKey()) return null
  const roles = [role, ...(MODEL_ROLES[role].fallbackRoles || [])]
  const models = []
  for (const r of roles) {
    const m = await resolveModel(r)
    if (!models.includes(m)) models.push(m)
  }
  // 直前に応答しなかったモデルは後回しにし、毎回待たされないようにする
  models.sort((a, b) => unresponsiveModels.has(a) - unresponsiveModels.has(b))
  for (const [i, model] of models.entries()) {
    if (i > 0) console.log(`Gemini: ${models[i - 1]} が応答しないため ${model} で再試行します`)
    const body = { contents: [{ parts: [{ text: prompt }] }] }
    if (asJson && !isGemma(model)) body.generationConfig = { responseMimeType: 'application/json' }
    const candidate = await requestGemini(body, { retries, timeoutMs, model })
    if (candidate) return candidateText(candidate)
    if (!exhaustedModels.has(model)) unresponsiveModels.add(model)
  }
  // 使えるモデルがすべて1日の枠切れなら、呼び出し側(ニュースのバックオフ等)に知らせる
  if (models.every((m) => exhaustedModels.has(m))) quotaExhaustedThisRun = true
  return null
}

// Google検索(グラウンディング)付きで呼び出す。Geminiが実際にWeb検索した結果を元に答えさせ、
// 参照したページのURLをsourcesとして返す(sourcesが空=検索結果に基づいていない回答なので、
// 呼び出し側で「根拠なし」として捨てられるようにするため)。検索付きはresponseMimeTypeとの
// 併用ができないので、JSONが欲しい場合はプロンプトで指示してparseGeminiJsonで取り出すこと。
// 検索を挟む分だけ応答が遅いので、タイムアウトは通常の呼び出しより長めにしている。
export async function callGeminiWithSearch(prompt, { retries = 2 } = {}) {
  if (!hasGeminiKey()) return null
  const model = await resolveModel('search')
  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }
  const candidate = await requestGemini(body, { retries, timeoutMs: 120000, model })
  if (!candidate) {
    if (exhaustedModels.has(model)) quotaExhaustedThisRun = true
    return null
  }
  const text = candidateText(candidate)
  if (!text) return null
  const sources = (candidate.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web?.uri)
    .filter(Boolean)
  return { text, sources }
}

// 検索付きの応答はテキストが複数のpartに分かれて返ることがあるので全部つなげる。
// 思考過程(thought: true のpart)を返すモデルもあるので、それは除く。
function candidateText(candidate) {
  const text = (candidate.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim()
  if (!text) {
    console.error(`Gemini returned no text (finishReason=${candidate.finishReason || 'unknown'})`)
    return null
  }
  return text
}

async function requestGemini(body, { retries, timeoutMs, model }) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  if (exhaustedModels.has(model)) return null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {

      // タイムアウトが無いと、通信が詰まった時にワークフローのステップ全体が
      // timeout-minutesいっぱいまで固まってしまい、その回の結果が何も保存されない
      // (2026-09-20、fetch-news.mjsの本文取得で発覚した同種の不具合と同じ対策)。
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        // 429(レート制限)や5xxは少し待って再試行する。それ以外(400等)は再試行しても無駄なので諦める。
        const errText = await res.text()
        const quota = parseQuotaError(errText)
        // エラー本文は長いので、どの上限に当たったか(quotaId)が分かる部分だけを要約して出す。
        // 以前は先頭300文字だけ出していたため肝心のquotaIdが切れて見えず、
        // 「1分あたりの上限」か「1日の上限」か区別できなかった(2026-10-03)。
        console.error(
          `Gemini API error ${res.status}: ${quota.message || errText.slice(0, 300)}` +
            (quota.violations.length ? ` [${quota.violations.join(', ')}]` : '') +
            (quota.retryDelaySec != null ? ` retryDelay=${quota.retryDelaySec}s` : '')
        )
        // 【重要・2026-09-22発覚】429には2種類あり、区別せず一律リトライしていたことが
        // 「本文翻訳が0件のまま」の原因になっていた。一時的なレート制限(1分あたりの上限)は
        // 数秒待てば回復するが、日次クォータ自体を使い切った状態は待っても回復しない。
        // ただし"exceeded your current quota"という文面は両方で同じなので、文面ではなく
        // details内のquotaIdで判定する(2026-10-03、1分あたりの上限に当たっただけなのに
        // 日次クォータ切れと誤判定し、ニュース翻訳を何時間も止めていたため)。
        // 1分あたりの上限だけなら、指示された時間(retryDelay)待って再試行する。
        if (res.status === 429 && quota.perMinuteOnly && attempt < retries) {
          await sleep(((quota.retryDelaySec ?? 30) + 1) * 1000)
          continue
        }
        const quotaExceeded = res.status === 429 && !quota.perMinuteOnly && /exceeded your current quota/i.test(errText)
        if (quotaExceeded) exhaustedModels.add(model)
        if (!quotaExceeded && (res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        return null
      }
      const data = await res.json()
      const candidate = data.candidates?.[0]
      if (!candidate) {
        console.error('Gemini returned no candidates')
        return null
      }
      return candidate
    } catch (err) {
      console.error(`Gemini API call failed: ${err.message}`)
      if (attempt < retries) {
        await sleep(2000 * (attempt + 1))
        continue
      }
      return null
    }
  }
  return null
}

// GeminiがJSONを```json ... ```で囲んで返すことがあるので剥がしてからparseする
// (asJson:trueで呼んでいれば通常はそのままparseできるが、念のため残す)
export function parseGeminiJson(text) {
  if (!text) return null
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  // 検索付き呼び出し(responseMimeType不可)では前置き文の後にJSONが続くことがあるので、
  // 素のままparseできない時は最初の{か[から最後の}か]までを取り出して試す
  if (!/^[[{]/.test(cleaned)) {
    const start = cleaned.search(/[[{]/)
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'))
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1)
  }
  try {
    return JSON.parse(cleaned)
  } catch (err) {
    console.error(`Gemini JSON parse failed: ${err.message}. raw=${cleaned.slice(0, 200)}`)
    return null
  }
}
