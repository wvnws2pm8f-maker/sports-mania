import { articles } from '../data/articles.js'
import SportPanel from './SportPanel.jsx'
import NflWeeklyGames from './NflWeeklyGames.jsx'

const nflArticles = articles.filter((a) => a.sport === 'nfl')

export default function NFLView() {
  return (
    <SportPanel sportPath="football" leaguePath="nfl" articles={nflArticles} renderGamesTab={() => <NflWeeklyGames />} />
  )
}
