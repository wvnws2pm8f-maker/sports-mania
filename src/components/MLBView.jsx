import { articles } from '../data/articles.js'
import SportPanel from './SportPanel.jsx'

const mlbArticles = articles.filter((a) => a.sport === 'mlb')

export default function MLBView() {
  return <SportPanel sportPath="baseball" leaguePath="mlb" articles={mlbArticles} />
}
