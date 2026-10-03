// Gemini API(無料枠あり)の薄いラッパー。GEMINI_API_KEYが無ければ何もせずnullを返す
// (=AI機能はオプション。キーが無くてもニュース取得・ロスター取得自体は今まで通り動く)。
// GitHub Actionsでは Settings > Secrets and variables > Actions に登録した
// GEMINI_API_KEY を workflow の env: 経由で渡している。
// 2026-09時点: gemini-2.0-flash は廃止され、gemini-3.6-flash への切り替えが必要
// (実際にワークフロー実行時に "model ... is no longer available" エラーで判明した)。
const MODEL = 'gemini-3.6-flash'

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY)
}

// 1回の実行(1回のnodeプロセス)内でクォータ超過を検知したら、以降の呼び出しは
// フェッチすら行わず即座に諦める。同じ実行の中で見出し翻訳がクォータ超過で失敗した後、
// 本文翻訳(1回でも呼べば必ず同じ理由で失敗する)まで律儀に試みて無駄にAPIへ
// アクセスし続けることが無いようにする(2026-09-22、本文翻訳が常に0件だった問題の対策の一部)。
let quotaExhaustedThisRun = false

// 呼び出し側(fetch-news.mjs)が「今回クォータ超過にぶつかったか」を見て、次回以降しばらく
// 翻訳の試行自体をスキップする(無駄打ちを減らす)バックオフ判断に使う。
export function hasQuotaExhausted() {
  return quotaExhaustedThisRun
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// asJson: true にすると、Gemini自身にJSONとしてのみ応答するよう強制する
// (responseMimeType)。プロンプトの指示だけに頼ると、内容が単純な記事(見出し=要約の
// 動画ハイライトなど)でGeminiが前置き文や説明を付けて返し、JSON parseに失敗することが
// あったため、これで確実にJSONだけを返させる。
export async function callGemini(prompt, { asJson = false, retries = 2 } = {}) {
  const body = { contents: [{ parts: [{ text: prompt }] }] }
  if (asJson) body.generationConfig = { responseMimeType: 'application/json' }
  const candidate = await requestGemini(body, { retries, timeoutMs: 30000 })
  return candidate ? candidateText(candidate) : null
}

// Google検索(グラウンディング)付きで呼び出す。Geminiが実際にWeb検索した結果を元に答えさせ、
// 参照したページのURLをsourcesとして返す(sourcesが空=検索結果に基づいていない回答なので、
// 呼び出し側で「根拠なし」として捨てられるようにするため)。検索付きはresponseMimeTypeとの
// 併用ができないので、JSONが欲しい場合はプロンプトで指示してparseGeminiJsonで取り出すこと。
// 検索を挟む分だけ応答が遅いので、タイムアウトは通常の呼び出しより長めにしている。
export async function callGeminiWithSearch(prompt, { retries = 2 } = {}) {
  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }
  const candidate = await requestGemini(body, { retries, timeoutMs: 120000 })
  if (!candidate) return null
  const text = candidateText(candidate)
  if (!text) return null
  const sources = (candidate.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web?.uri)
    .filter(Boolean)
  return { text, sources }
}

// 検索付きの応答はテキストが複数のpartに分かれて返ることがあるので全部つなげる
function candidateText(candidate) {
  const text = (candidate.content?.parts || []).map((p) => p.text || '').join('').trim()
  if (!text) {
    console.error(`Gemini returned no text (finishReason=${candidate.finishReason || 'unknown'})`)
    return null
  }
  return text
}

async function requestGemini(body, { retries, timeoutMs }) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  if (quotaExhaustedThisRun) return null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {

      // タイムアウトが無いと、通信が詰まった時にワークフローのステップ全体が
      // timeout-minutesいっぱいまで固まってしまい、その回の結果が何も保存されない
      // (2026-09-20、fetch-news.mjsの本文取得で発覚した同種の不具合と同じ対策)。
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
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
        const errText = (await res.text()).slice(0, 300)
        console.error(`Gemini API error ${res.status}: ${errText}`)
        // 【重要・2026-09-22発覚】429には2種類あり、区別せず一律リトライしていたことが
        // 「本文翻訳が0件のまま」の原因になっていた。一時的なレート制限(1分あたりの上限)は
        // 数秒待てば回復するが、"exceeded your current quota"は日次/月次クォータ自体を
        // 使い切った状態で、数秒〜数十秒待っても回復しない。それにも関わらず毎回2回リトライ
        // していたため、1回の記事翻訳あたり最大3倍の無駄な呼び出しでクォータを消費し、
        // 15分おきの実行が積み重なって日次クォータを早々に使い切り、本文翻訳が
        // いつまで経っても成功しない状態が続いていた。クォータ超過と判定できた場合は
        // 即座に諦め、無駄なリトライでクォータをこれ以上消費しないようにする。
        const quotaExceeded = res.status === 429 && /exceeded your current quota/i.test(errText)
        if (quotaExceeded) quotaExhaustedThisRun = true
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
