import { articles } from '../data/articles.js'
import SportPanel from './SportPanel.jsx'

const nbaArticles = articles.filter((a) => a.sport === 'nba')

export default function NBAView() {
  return <SportPanel sportPath="basketball" leaguePath="nba" articles={nbaArticles} />
}
