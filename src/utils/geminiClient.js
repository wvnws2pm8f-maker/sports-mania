// ニュース記事の「全文を読む」をタップした時、その場でブラウザから直接Gemini APIを呼んで
// 本文を日本語に翻訳する(2026-09-22、「本文はクリックした記事だけ翻訳してGeminiの
// 無料枠クォータを節約したい」との要望で追加)。
//
// 【重要・セキュリティ上の注意】このAPIキーはビルド時にJSバンドルへそのまま埋め込まれるため、
// サイトのソース(devtoolsのNetworkタブ等)を見れば誰でも値を読み取れる。悪用や意図しない
// クォータ消費を防ぐため、Google Cloud Console側でこのAPIキーに「このサイトのドメインからの
// リクエストのみ許可する」HTTPリファラー制限をかけて運用することを前提にしている
// (Google MapsのJS埋め込み用キー等と同じ考え方)。この制限自体はGoogleアカウント側の設定な
// ので、このリポジトリのコードからは設定できない。
const MODEL = 'gemini-3.6-flash'
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY

const CACHE_PREFIX = 'mania-body-ja-v1:'

export function hasClientTranslation() {
  return Boolean(API_KEY)
}

function cacheKey(articleId, headline) {
  return `${CACHE_PREFIX}${articleId}:${headline}`
}

// localStorageは端末ごとに独立していて壊れていたり使えないこと(プライベートブラウズ等)も
// あるので、失敗しても致命的にならないよう必ずtry/catchで囲む。
function loadCached(articleId, headline) {
  try {
    return localStorage.getItem(cacheKey(articleId, headline))
  } catch {
    return null
  }
}

function saveCached(articleId, headline, text) {
  try {
    localStorage.setItem(cacheKey(articleId, headline), text)
  } catch {
    // 保存できなくても致命的ではない(次回また翻訳し直すだけ)
  }
}

// 記事本文を日本語に翻訳する。同じ記事(id+見出しが同じ)を過去に翻訳済みならAPIを
// 呼ばずキャッシュを返す(同じ端末で何度も開き直してもクォータを消費しないため)。
export async function translateArticleBody(articleId, headline, body) {
  const cached = loadCached(articleId, headline)
  if (cached) return cached

  if (!API_KEY) throw new Error('no-key')

  const prompt = `以下は英語のスポーツニュース記事本文です。自然な日本語に翻訳してください。
リンクや選手名などの固有名詞はそのまま活かしつつ、読みやすい日本語にしてください。
前置き・説明・引用符は付けず、翻訳した本文のみを出力してください。

${body}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  let res
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`gemini-error-${res.status}`)
  }
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) {
    throw new Error('gemini-empty')
  }

  saveCached(articleId, headline, text)
  return text
}
