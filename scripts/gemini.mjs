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

export async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    })
    if (!res.ok) {
      console.error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return null
    }
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch (err) {
    console.error(`Gemini API call failed: ${err.message}`)
    return null
  }
}

// GeminiがJSONを```json ... ```で囲んで返すことがあるので剥がしてからparseする
export function parseGeminiJson(text) {
  if (!text) return null
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
