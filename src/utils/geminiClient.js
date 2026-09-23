// ニュース記事の「全文を読む」をタップした時、その場で本文を日本語に翻訳する。
// Geminiには直接ブラウザから呼ばず、専用のCloudflare Worker(リポジトリ内 worker/)を経由する。
//
// 【経緯・2026-09-23】当初はブラウザから直接Gemini APIを呼ぶ案(APIキーをJSに埋め込み、
// Google Cloud Console側でHTTPリファラー制限をかけてこのサイト限定にする)を検討したが、
// GeminiのAPIキーは必ずサービスアカウントへのバインドが必要で、そのようなキーは
// リファラー制限に対応していない(IPアドレス制限しか選べない)ことが実際の画面で確認できた。
// 不特定多数のブラウザから使われる以上IP制限は意味を持たないため、代わりにこの用途専用の
// Cloudflare Worker(worker/src/index.js)を用意し、Gemini APIキー自体はそのWorkerの
// シークレットとしてサーバー側にだけ保持する方式に変更した。ブラウザのコードにも
// ビルド後のJSにも、Gemini APIキーは一切含まれない。
const WORKER_URL = 'https://sports-mania-translate.eeggxgjsd85.workers.dev'

const CACHE_PREFIX = 'mania-body-ja-v1:'

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

// 記事本文を日本語に翻訳する。同じ記事(id+見出しが同じ)を過去に翻訳済みならWorkerを
// 呼ばずキャッシュを返す(同じ端末で何度も開き直してもクォータを消費しないため)。
export async function translateArticleBody(articleId, headline, body) {
  const cached = loadCached(articleId, headline)
  if (cached) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  let res
  try {
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body }),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`worker-error-${res.status}`)
  }
  const data = await res.json()
  if (!data.text) {
    throw new Error('worker-empty')
  }

  saveCached(articleId, headline, data.text)
  return data.text
}
