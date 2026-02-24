/**
 * UMAYOSE データ拡張スクリプト
 * 1. races/2026-02-16.json に sex, age, trainer, bodyWeight, pastResults を追加
 * 2. results/2026-02-16.json に time, margin, passingOrder, last3f を追加（着順）、numbers, popularity を追加（払戻）
 * 3. hits.json を predictions + results から自動生成
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── 定数プール ───

const TRAINERS = [
  '国枝栄', '堀宣行', '藤沢和雄', '手塚貴久', '木村哲也',
  '矢作芳人', '友道康夫', '池江泰寿', '角居勝彦', '田中博康',
  '萩原清', '鹿戸雄一', '大竹正博', '中内田充正', '高野友和',
  '西村真幸', '杉山晴紀', '斎藤崇史', '音無秀孝', '松永幹夫',
  '中竹和也', '奥村武', '加藤征弘', '尾関知人', '宗像義忠',
  '須貝尚介', '安田隆行', '清水久詞', '石坂正', '小島茂之',
  '上原博之', '菊沢隆徳', '古賀史生', '武幸四郎', '吉岡辰弥',
  '高橋亮', '松下武士', '今野貞一', '和田正一郎', '新開幸一'
];

const SEX_OPTIONS = ['牡', '牝', 'セ'];

// ─── ユーティリティ ───

// 疑似乱数（seed付き、再現性あり）
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Step 1: レースデータ拡張 ───

function enhanceRaces() {
  const racesPath = path.join(DATA_DIR, 'races', '2026-02-16.json');
  const data = JSON.parse(fs.readFileSync(racesPath, 'utf8'));

  let totalEntries = 0;

  for (const venue of data.venues) {
    for (const race of venue.races) {
      // レース名から年齢を推測
      const raceAge = guessAge(race.name);

      for (const entry of race.entries) {
        const seed = hashString(race.id + '_' + entry.number);
        const rng = seededRandom(seed);

        // 性別（牡が多め）
        const sexRoll = rng();
        entry.sex = sexRoll < 0.55 ? '牡' : (sexRoll < 0.85 ? '牝' : 'セ');

        // 年齢
        entry.age = raceAge !== null ? raceAge + (rng() < 0.3 ? 1 : 0) : Math.floor(rng() * 4) + 3;
        // セン馬は4歳以上
        if (entry.sex === 'セ' && entry.age < 4) entry.age = 4 + Math.floor(rng() * 3);

        // 調教師
        entry.trainer = pickRandom(TRAINERS, rng);

        // 馬体重 (440-520, 牝はやや軽め)
        const baseWeight = entry.sex === '牝' ? 440 : 460;
        const weight = baseWeight + Math.floor(rng() * 60);
        const delta = Math.floor(rng() * 12) - 4; // -4 to +7
        const sign = delta > 0 ? '+' : (delta === 0 ? '' : '');
        entry.bodyWeight = `${weight}(${sign}${delta})`;

        // 直近5走の着順（nullは未出走）— オブジェクト配列
        const VENUES = ['東京','中山','阪神','京都','中京','小倉','福島','新潟','札幌','函館'];
        const TRACKS = ['芝','ダート'];
        const CONDITIONS = ['良','稍重','重','不良'];
        const CLASSES = ['3歳未勝利','3歳1勝クラス','2勝クラス','3勝クラス','オープン','G3','G2','G1'];
        const SIRE_NAMES = ['ディープインパクト','キタサンブラック','ロードカナロア','エピファネイア','ハーツクライ','ドゥラメンテ','モーリス','キズナ'];
        const DAM_SIRE_NAMES = ['Storm Cat','サンデーサイレンス','キングカメハメハ','ダイワメジャー','スペシャルウィーク','ネオユニヴァース','マンハッタンカフェ','シンボリクリスエス'];
        const OWNERS = ['（有）サクラ牧場','（有）シルクレーシング','（株）ノースヒルズ','（有）ゴドルフィン','（有）キャロットファーム','吉田照哉','大塚亮一','金子真人ホールディングス'];
        const BREEDERS = ['社台ファーム','ノーザンファーム','追分ファーム','白老ファーム','ダーレー・ジャパン','下河辺牧場','千代田牧場','ケイアイファーム'];
        const INTERVALS = ['連闘','中1週','中2週','中3週','中4週','中6週','中8週','中12週','中半年'];
        const JOCKEYS = ['横山武史','戸崎圭太','C.ルメール','川田将雅','福永祐一','松山弘平','M.デムーロ','北村友一','田辺裕信','石橋脩'];
        const pastResults = [];
        for (let i = 0; i < 5; i++) {
          if (rng() < 0.15) {
            pastResults.push(null);
          } else {
            const maxRank = entry.popularity <= 3 ? 8 : 16;
            const rank = Math.floor(rng() * maxRank) + 1;
            const dayOffset = (i + 1) * (14 + Math.floor(rng() * 60));
            const pastDate = new Date('2026-02-16');
            pastDate.setDate(pastDate.getDate() - dayOffset);
            const dist = [1200,1400,1600,1800,2000,2200,2400,2500][Math.floor(rng() * 8)];
            const track = pickRandom(TRACKS, rng);
            const fieldSize = 10 + Math.floor(rng() * 8);
            const bw = (entry.sex === '牝' ? 440 : 460) + Math.floor(rng() * 60);
            const bwDelta = Math.floor(rng() * 10) - 4;
            const bwSign = bwDelta > 0 ? '+' : '';
            const minutes = Math.floor((dist * (track === '芝' ? 0.0593 : 0.0625)) / 60);
            const secs = ((dist * (track === '芝' ? 0.0593 : 0.0625)) % 60 + rng() * 2).toFixed(1);
            const timeStr = minutes > 0 ? `${minutes}:${parseFloat(secs) < 10 ? '0' + secs : secs}` : secs;
            pastResults.push({
              rank,
              date: pastDate.toISOString().slice(0, 10),
              venue: pickRandom(VENUES, rng),
              distance: `${track}${dist}m`,
              track,
              condition: pickRandom(CONDITIONS, rng),
              class: pickRandom(CLASSES, rng),
              raceName: pickRandom(CLASSES, rng),
              jockey: pickRandom(JOCKEYS, rng),
              weight: entry.weight,
              sireName: pickRandom(SIRE_NAMES, rng),
              damSireName: pickRandom(DAM_SIRE_NAMES, rng),
              owner: pickRandom(OWNERS, rng),
              breeder: pickRandom(BREEDERS, rng),
              bodyWeight: `${bw}(${bwSign}${bwDelta})`,
              fieldSize,
              margin: (rng() * 3).toFixed(1),
              popularity: Math.floor(rng() * fieldSize) + 1,
              time: timeStr,
              last3f: (33 + rng() * 4).toFixed(1),
              passingOrder: Array.from({length: 4}, () => Math.floor(rng() * Math.min(fieldSize, 12)) + 1).join('-'),
              interval: pickRandom(INTERVALS, rng)
            });
          }
        }
        entry.pastResults = pastResults;

        totalEntries++;
      }
    }
  }

  fs.writeFileSync(racesPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[Step 1] races enhanced: ${totalEntries} entries updated`);
}

function guessAge(raceName) {
  if (raceName.includes('3歳')) return 3;
  if (raceName.includes('2歳')) return 2;
  if (raceName.includes('4歳以上')) return 4;
  return null; // 混合
}

// ─── Step 2: 結果データ拡張 ───

function enhanceResults() {
  const resultsPath = path.join(DATA_DIR, 'results', '2026-02-16.json');
  const racesPath = path.join(DATA_DIR, 'races', '2026-02-16.json');
  const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const racesData = JSON.parse(fs.readFileSync(racesPath, 'utf8'));

  // レースIDからレース情報を引くマップ
  const raceMap = {};
  for (const venue of racesData.venues) {
    for (const race of venue.races) {
      raceMap[race.id] = race;
    }
  }

  for (const result of resultsData.results) {
    const race = raceMap[result.raceId];
    if (!race) continue;

    const seed = hashString(result.raceId + '_result');
    const rng = seededRandom(seed);

    // 距離からベースタイムを算出
    const distMatch = race.distance.match(/(\d+)/);
    const distance = distMatch ? parseInt(distMatch[1]) : 1600;
    const surface = race.distance.includes('芝') ? 'turf' : 'dirt';
    const baseTime = calcBaseTime(distance, surface, rng);

    // 着順データ拡張
    let cumMargin = 0;
    for (let i = 0; i < result.placings.length; i++) {
      const placing = result.placings[i];

      // 走破タイム
      const timeOffset = i === 0 ? 0 : cumMargin;
      const totalSeconds = baseTime + timeOffset;
      placing.time = formatTime(totalSeconds);

      // 着差
      if (i === 0) {
        placing.margin = '';
      } else {
        const marginVal = generateMargin(rng, i);
        cumMargin += marginVal;
        placing.margin = formatMargin(marginVal);
      }

      // コーナー通過順
      placing.passingOrder = generatePassingOrder(rng, placing.rank, result.placings.length, distance);

      // 上り3F
      const baseLast3f = surface === 'turf' ? 33.5 : 36.0;
      const last3fVar = (rng() - 0.3) * 3; // 1着は速めに
      placing.last3f = (baseLast3f + last3fVar + (i * 0.2)).toFixed(1);
    }

    // レースラップ生成
    const furlongs = Math.round(distance / 200);
    const laps = [];
    for (let f = 0; f < furlongs; f++) {
      const baseLap = surface === 'turf' ? 12.0 : 12.5;
      const lapVar = (rng() - 0.5) * 1.5;
      laps.push((baseLap + lapVar).toFixed(1));
    }
    result.raceLap = laps.join('-');

    // 払戻データ拡張
    const top3 = result.placings.slice(0, 3);
    for (const payout of result.payouts) {
      const payoutInfo = generatePayoutNumbers(payout.type, top3, rng);
      payout.numbers = payoutInfo.numbers;
      payout.popularity = payoutInfo.popularity;
    }
  }

  fs.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2), 'utf8');
  console.log(`[Step 2] results enhanced: ${resultsData.results.length} races updated`);
}

function calcBaseTime(distance, surface, rng) {
  // 大体の秒数（目安）
  const pace = surface === 'turf' ? 0.0593 : 0.0625; // 秒/m
  return distance * pace + (rng() * 2 - 1);
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = (seconds % 60).toFixed(1);
  const secStr = parseFloat(sec) < 10 ? '0' + sec : sec;
  if (min === 0) return secStr;
  return `${min}:${secStr}`;
}

function generateMargin(rng, rank) {
  // 着差（秒単位）
  if (rank <= 3) {
    return 0.1 + rng() * 0.5; // 僅差
  } else {
    return 0.2 + rng() * 1.5;
  }
}

function formatMargin(seconds) {
  if (seconds < 0.05) return 'ハナ';
  if (seconds < 0.1) return 'アタマ';
  if (seconds < 0.15) return 'クビ';
  if (seconds < 0.25) return '1/2';
  if (seconds < 0.4) return '3/4';
  if (seconds < 0.55) return '1';
  if (seconds < 0.75) return '1.1/2';
  if (seconds < 1.0) return '2';
  if (seconds < 1.3) return '3';
  if (seconds < 1.6) return '4';
  return '大差';
}

function generatePassingOrder(rng, finalRank, totalHorses, distance) {
  const corners = distance >= 2000 ? 4 : (distance >= 1400 ? 4 : 3);
  const positions = [];
  // 逃げ・先行・差し・追込をランダムに
  let basePos = Math.floor(rng() * Math.min(totalHorses, 12)) + 1;
  for (let c = 0; c < corners; c++) {
    const shift = Math.floor(rng() * 3) - 1;
    basePos = Math.max(1, Math.min(totalHorses, basePos + shift));
    positions.push(basePos);
  }
  return positions.join('-');
}

function generatePayoutNumbers(type, top3, rng) {
  const n1 = top3[0].number;
  const n2 = top3[1].number;
  const n3 = top3[2].number;

  let numbers, popularity;

  switch (type) {
    case '単勝':
      numbers = String(n1);
      popularity = Math.floor(rng() * 5) + 1;
      break;
    case '複勝':
      numbers = `${n1}, ${n2}, ${n3}`;
      popularity = Math.floor(rng() * 3) + 1;
      break;
    case '馬連':
      numbers = [n1, n2].sort((a, b) => a - b).join('-');
      popularity = Math.floor(rng() * 15) + 1;
      break;
    case '馬単':
      numbers = `${n1} → ${n2}`;
      popularity = Math.floor(rng() * 30) + 1;
      break;
    case '3連複':
      numbers = [n1, n2, n3].sort((a, b) => a - b).join('-');
      popularity = Math.floor(rng() * 50) + 1;
      break;
    case '3連単':
      numbers = `${n1} → ${n2} → ${n3}`;
      popularity = Math.floor(rng() * 100) + 1;
      break;
    default:
      numbers = '';
      popularity = 1;
  }

  return { numbers, popularity };
}

// ─── Step 3: 的中速報データ生成 ───

function generateHits() {
  const resultsPath = path.join(DATA_DIR, 'results', '2026-02-16.json');
  const racesPath = path.join(DATA_DIR, 'races', '2026-02-16.json');
  const predictorsPath = path.join(DATA_DIR, 'predictors.json');
  const predictionsDir = path.join(DATA_DIR, 'predictions');

  const resultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const racesData = JSON.parse(fs.readFileSync(racesPath, 'utf8'));
  const predictors = JSON.parse(fs.readFileSync(predictorsPath, 'utf8'));

  // 予想家マップ
  const predictorMap = {};
  for (const p of predictors) predictorMap[p.id] = p;

  // レースマップ
  const raceMap = {};
  const venueMap = {};
  for (const venue of racesData.venues) {
    for (const race of venue.races) {
      raceMap[race.id] = race;
      venueMap[race.id] = venue.name;
    }
  }

  // 結果マップ
  const resultMap = {};
  for (const r of resultsData.results) resultMap[r.raceId] = r;

  // 予想ファイル一覧
  const predFiles = fs.readdirSync(predictionsDir).filter(f => f.endsWith('.json'));

  const hits = [];
  let baseTimestamp = new Date('2026-02-16T12:00:00+09:00').getTime();

  for (const predFile of predFiles) {
    const predData = JSON.parse(fs.readFileSync(path.join(predictionsDir, predFile), 'utf8'));
    const raceId = predData.raceId;
    const result = resultMap[raceId];
    const race = raceMap[raceId];

    if (!result || !race || !result.placings || result.placings.length < 3) continue;

    const top3 = result.placings.slice(0, 3);
    const firstNum = top3[0].number;
    const secondNum = top3[1].number;
    const thirdNum = top3[2].number;
    const top3Nums = [firstNum, secondNum, thirdNum];

    // 払戻マップ
    const payoutMap = {};
    for (const p of result.payouts) payoutMap[p.type] = p;

    const venue = venueMap[raceId];

    for (const pred of predData.predictions) {
      // 予想家のマーク取得
      const marks = pred.marks;
      const honmeiEntry = Object.entries(marks).find(([, v]) => v === '◎');
      const taikouEntry = Object.entries(marks).find(([, v]) => v === '○');
      const tanaEntry = Object.entries(marks).find(([, v]) => v === '▲');
      const renkaEntry = Object.entries(marks).find(([, v]) => v === '△');

      const honmei = honmeiEntry ? parseInt(honmeiEntry[0]) : null;
      const taikou = taikouEntry ? parseInt(taikouEntry[0]) : null;
      const tana = tanaEntry ? parseInt(tanaEntry[0]) : null;
      const renka = renkaEntry ? parseInt(renkaEntry[0]) : null;

      const markedHorses = [honmei, taikou, tana, renka].filter(n => n !== null);

      // タイムスタンプ（レースの発走時間ベース）
      const raceTime = new Date(`2026-02-16T${race.startTime}:00+09:00`).getTime();
      const resultTime = raceTime + 10 * 60 * 1000; // レース後10分

      // ─── 7種の買い目判定 ───

      // 1. 単勝: ◎馬が1着
      if (honmei === firstNum) {
        const payout = payoutMap['単勝'];
        hits.push(createHit(pred.predictorId, race, raceId, venue, 'tansho', '単勝的中',
          firstNum, top3[0].name, '単勝', payout ? payout.amount : 0, resultTime));
      }

      // 2. 複勝: ◎馬が3着以内
      if (honmei && top3Nums.includes(honmei)) {
        const payout = payoutMap['複勝'];
        const horseName = top3.find(p => p.number === honmei)?.name || '';
        hits.push(createHit(pred.predictorId, race, raceId, venue, 'fukusho', '複勝的中',
          honmei, horseName, '複勝', payout ? payout.amount : 0, resultTime + 1000));
      }

      // 3. 馬連: ◎○の2頭が1-2着（順不同）
      if (honmei && taikou) {
        const pair = [honmei, taikou].sort((a, b) => a - b);
        const topPair = [firstNum, secondNum].sort((a, b) => a - b);
        if (pair[0] === topPair[0] && pair[1] === topPair[1]) {
          const payout = payoutMap['馬連'];
          hits.push(createHit(pred.predictorId, race, raceId, venue, 'umaren', '馬連的中',
            null, `${pair[0]}-${pair[1]}`, '馬連', payout ? payout.amount : 0, resultTime + 2000));
        }
      }

      // 4. 馬単: ◎が1着かつ○が2着
      if (honmei === firstNum && taikou === secondNum) {
        const payout = payoutMap['馬単'];
        hits.push(createHit(pred.predictorId, race, raceId, venue, 'umatan', '馬単的中',
          null, `${firstNum} → ${secondNum}`, '馬単', payout ? payout.amount : 0, resultTime + 3000));
      }

      // 5. ワイド: ◎○▲△のうち2頭が3着以内
      {
        const inTop3 = markedHorses.filter(n => top3Nums.includes(n));
        if (inTop3.length >= 2) {
          // 最初の組み合わせ（最も高い配当を想定）
          const widePair = inTop3.slice(0, 2).sort((a, b) => a - b);
          // ワイド払戻はデータにないのでダミー計算
          const payout = payoutMap['馬連']; // ワイドはないので馬連の1/3程度
          const wideAmount = payout ? Math.round(payout.amount * 0.4) : 0;
          hits.push(createHit(pred.predictorId, race, raceId, venue, 'wide', 'ワイド的中',
            null, `${widePair[0]}-${widePair[1]}`, 'ワイド', wideAmount, resultTime + 4000));
        }
      }

      // 6. 3連複: ◎○▲が全員3着以内
      if (honmei && taikou && tana) {
        const trio = [honmei, taikou, tana];
        if (trio.every(n => top3Nums.includes(n))) {
          const payout = payoutMap['3連複'];
          const sorted = [...trio].sort((a, b) => a - b);
          hits.push(createHit(pred.predictorId, race, raceId, venue, 'sanrenpuku', '3連複的中',
            null, sorted.join('-'), '3連複', payout ? payout.amount : 0, resultTime + 5000));
        }
      }

      // 7. 3連単: ◎→1着、○→2着、▲→3着
      if (honmei === firstNum && taikou === secondNum && tana === thirdNum) {
        const payout = payoutMap['3連単'];
        hits.push(createHit(pred.predictorId, race, raceId, venue, 'sanrentan', '3連単的中',
          null, `${firstNum} → ${secondNum} → ${thirdNum}`, '3連単', payout ? payout.amount : 0, resultTime + 6000));
      }
    }
  }

  // タイムスタンプ降順でソート
  hits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const hitsData = {
    lastUpdated: '2026-02-16T18:30:00+09:00',
    hits: hits
  };

  fs.writeFileSync(path.join(DATA_DIR, 'hits.json'), JSON.stringify(hitsData, null, 2), 'utf8');
  console.log(`[Step 3] hits.json generated: ${hits.length} hits`);
}

function createHit(predictorId, race, raceId, venue, hitType, hitLabel, hitHorseNumber, hitHorseName, payoutType, payoutAmount, timestampMs) {
  return {
    predictorId,
    date: '2026-02-16',
    venue,
    raceNumber: race.raceNumber,
    raceName: race.name,
    raceId,
    grade: race.grade || '',
    hitType,
    hitLabel,
    hitHorseNumber,
    hitHorseName: String(hitHorseName),
    payoutType,
    payoutAmount,
    timestamp: new Date(timestampMs).toISOString().replace('Z', '+09:00').replace(/\.\d{3}/, '')
  };
}

// ─── 実行 ───
console.log('=== UMAYOSE データ拡張スクリプト ===');
enhanceRaces();
enhanceResults();
generateHits();
console.log('=== 完了 ===');
