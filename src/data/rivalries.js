// 「今週末の注目カード」で優先的に拾い上げる伝統の一戦・人気カード。
// team idはpublic/data/team/<sportPath>-<teamId>.jsonのファイル名と対応する
// (scripts/fetch-team-details.mjsが書き出すものと同じESPNのteam.id)。
// ここに無い組み合わせの試合は、順位表の首位同士の対戦を自動的に拾う(HomeView.jsx)。
//
// background: なぜこのカードが特別なのか、という歴史的・文化的背景。
// AIにその場で生成させると年代や記録を間違えるリスクがあるため、ここは手動で
// 事実確認した文章を直接書いている(記事のようにたまに見直す想定)。
export const rivalries = [
  // ---- サッカー ----
  {
    sportPath: 'soccer',
    teamIds: ['86', '83'],
    label: 'エル・クラシコ',
    background:
      'スペインの首都マドリードとカタルーニャの中心バルセロナ、政治的・地域的な対立の歴史も背負う世界最大級の一戦。世界で最も視聴されるクラブサッカーの試合とも言われる。'
  }, // Real Madrid vs Barcelona
  {
    sportPath: 'soccer',
    teamIds: ['382', '360'],
    label: 'マンチェスター・ダービー',
    background:
      '同じマンチェスターを本拠地とする両クラブの一戦。長年名門だったユナイテッドに対し、2008年のオイルマネー流入以降シティが急成長し、街の勢力図を塗り替えたことで対立が一層激しくなった。'
  }, // Man City vs Man United
  {
    sportPath: 'soccer',
    teamIds: ['359', '367'],
    label: '北ロンドン・ダービー',
    background:
      '100年以上の歴史を持つロンドン北部の宿命の対決。1913年にアーセナルがトッテナムの目と鼻の先に移転してきたことが対立の発端とされ、ファンにとっては優勝争いよりもこの一戦の勝敗が重いとも言われる。'
  }, // Arsenal vs Tottenham
  {
    sportPath: 'soccer',
    teamIds: ['364', '368'],
    label: 'マージーサイド・ダービー',
    background:
      '同じリヴァプールを本拠地とし、家族間でも応援チームが分かれることから「フレンドリー・ダービー」とも呼ばれてきたが、近年は両クラブの実力が拮抗し白熱度が増している。'
  }, // Liverpool vs Everton
  {
    sportPath: 'soccer',
    teamIds: ['103', '110'],
    label: 'ミラノ・ダービー',
    background:
      '同じサン・シーロを本拠地とする2クラブによる「デルビー・デラ・マドンニーナ」。かつてはインテルが実業家層、ミランが労働者層のクラブとされたが、今では純粋な街の威信をかけた戦いとして知られる。'
  }, // AC Milan vs Inter
  {
    sportPath: 'soccer',
    teamIds: ['132', '124'],
    label: 'デア・クラシカー',
    background:
      'ドイツ随一の好カード。圧倒的な強さを誇るバイエルンに対し、2010年代にドルトムントが最大のライバルとして台頭したことで「デア・クラシカー(The Klassiker)」という呼び名が定着した。'
  }, // Bayern Munich vs Borussia Dortmund
  {
    sportPath: 'soccer',
    teamIds: ['160', '176'],
    label: 'ル・クラシック',
    background:
      'フランスの首都パリと、南仏の港湾都市マルセイユ。政治・経済の中心地と労働者階級の街という対照的なイメージも重なり、フランスで最も熱狂的なダービーの一つとされる。'
  }, // PSG vs Marseille
  {
    sportPath: 'soccer',
    teamIds: ['86', '1068'],
    label: 'マドリード・ダービー',
    background:
      '同じマドリードを本拠地とする一戦。長らく格上とされてきたレアルに対し、2011年以降のシメオネ監督のもとでアトレティコが本物のタイトル争い相手に成長し、対立が一気に熱を帯びた。'
  }, // Real Madrid vs Atlético Madrid

  // ---- NBA ----
  {
    sportPath: 'basketball',
    teamIds: ['13', '2'],
    label: 'レイカーズ vs セルティックス',
    background:
      'NBA史上最多の優勝回数を分け合う両チームによる、リーグ最高峰の伝統カード。1980年代のマジック・ジョンソン対ラリー・バードの名勝負が今も語り継がれている。'
  },
  {
    sportPath: 'basketball',
    teamIds: ['18', '17'],
    label: 'ニックス vs ネッツ',
    background:
      'マンハッタンとブルックリン、同じニューヨークを舞台にした地元対決。2012年にネッツがブルックリンへ移転してから、地元密着型の熱いライバル関係として定着した。'
  },

  // ---- MLB ----
  {
    sportPath: 'baseball',
    teamIds: ['10', '2'],
    label: 'ヤンキース vs レッドソックス',
    background:
      'MLBで最も有名な因縁の一戦。1919年にレッドソックスがベーブ・ルースをヤンキースへ放出したことが「バンビーノの呪い」として語り継がれ、以来100年以上にわたり熱戦を繰り広げている。'
  },
  {
    sportPath: 'baseball',
    teamIds: ['19', '26'],
    label: 'ドジャース vs ジャイアンツ',
    background:
      '元々はブルックリン・ドジャース対ニューヨーク・ジャイアンツとしてニューヨークで争われ、1958年に両球団そろってカリフォルニアへ移転してからも受け継がれる、米国スポーツ史上最古級のライバル関係。'
  },
  {
    sportPath: 'baseball',
    teamIds: ['16', '24'],
    label: 'カブス vs カージナルス',
    background:
      'イリノイ州とミズーリ州、中西部を代表する両球団によるMLB最古級のリーグ内ライバル対決。地理的に近いこともあり、地域を挙げた熱狂的な応援合戦で知られる。'
  }
]
