// ニュース記事本文の「その場で翻訳」を代行する小さなCloudflare Worker。
//
// 【なぜこれが必要か】(2026-09-22〜23の経緯)
// 当初はブラウザから直接Gemini APIを呼ぶ方式にしようとしたが、GoogleがGemini API用の
// APIキーに必ずサービスアカウントのバインドを要求するようになっており、そのようなキーは
// 「ウェブサイト(HTTPリファラー)」制限を選べない(IPアドレス制限しか選べない)ことが
// 実際にGoogle Cloud Consoleで確認できた。ブラウザから使う以上リファラー制限で
// ドメインを絞れないと、APIキーをそのままJSに埋め込むのは危険すぎる。
// そこでこのWorkerを間に挟み、Gemini APIキー自体はここ(サーバー側、Cloudflareの
// シークレットストア)にだけ保持し、ブラウザにはWorkerのURLだけを公開する。
// このWorker側でAccept元のOriginをこのアプリのGitHub Pagesドメインだけに絞ることで、
// 「特定サイトからしか使えない」という当初やりたかった制限を実現する。
const ALLOWED_ORIGIN = 'https://wvnws2pm8f-maker.github.io'
const MODEL = 'gemini-3.6-flash'
// 記事本文は元々BODY_MAX_CHARS=3000文字に切り詰められている(scripts/fetch-news.mjs)ので、
// それより余裕を持たせつつ、想定外に長い入力でGeminiへの請求量が膨らまないよう上限を設ける。
const MAX_INPUT_CHARS = 4000

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  }
  if (origin === ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN
  return headers
}

function jsonResponse(status, body, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const cors = corsHeaders(origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Originがこのサイト以外(または無い=直接curl等で叩いた場合)は拒否する。
    // これが「ブラウザに埋め込んだAPIキーを、このドメイン限定で使わせる」の代わりになる。
    if (origin !== ALLOWED_ORIGIN) {
      return jsonResponse(403, { error: 'forbidden origin' }, cors)
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'method not allowed' }, cors)
    }

    let payload
    try {
      payload = await request.json()
    } catch {
      return jsonResponse(400, { error: 'invalid json' }, cors)
    }

    const text = typeof payload?.text === 'string' ? payload.text.slice(0, MAX_INPUT_CHARS) : ''
    if (!text) {
      return jsonResponse(400, { error: 'text is required' }, cors)
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse(500, { error: 'GEMINI_API_KEY not configured' }, cors)
    }

    const prompt = `以下は英語のスポーツニュース記事本文です。自然な日本語に翻訳してください。
リンクや選手名などの固有名詞はそのまま活かしつつ、読みやすい日本語にしてください。
前置き・説明・引用符は付けず、翻訳した本文のみを出力してください。

${text}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    let geminiRes
    try {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal
        }
      )
    } catch (err) {
      return jsonResponse(502, { error: `gemini request failed: ${err.message}` }, cors)
    } finally {
      clearTimeout(timer)
    }

    if (!geminiRes.ok) {
      const errText = (await geminiRes.text()).slice(0, 300)
      return jsonResponse(502, { error: `gemini error ${geminiRes.status}: ${errText}` }, cors)
    }

    const data = await geminiRes.json()
    const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!translated) {
      return jsonResponse(502, { error: 'gemini returned no text' }, cors)
    }

    return jsonResponse(200, { text: translated }, cors)
  }
}
