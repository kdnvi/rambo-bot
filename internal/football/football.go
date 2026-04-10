package football

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync"

	"github.com/kdnvi/rambo-bot/internal/firebase"
)

const CursePts = 5

// StageStakes maps match ID ranges to point stakes.
var stageStakes = []struct{ minID, maxID, stake int }{
	{1, 72, 10},
	{73, 88, 10},
	{89, 96, 15},
	{97, 100, 20},
	{101, 102, 30},
	{103, 104, 50},
}

// GetMatchStake returns the stake for a given match ID.
func GetMatchStake(matchID int) int {
	for _, s := range stageStakes {
		if matchID >= s.minID && matchID <= s.maxID {
			return s.stake
		}
	}
	return 10
}

// GetWinner returns the winning team name, "draw", or "" if no result.
func GetWinner(m *firebase.Match) string {
	if m.Result == nil {
		return ""
	}
	if m.Result.Home > m.Result.Away {
		return m.Home
	}
	if m.Result.Away > m.Result.Home {
		return m.Away
	}
	return "draw"
}

// Delta holds the point change for one player in one match.
type Delta struct {
	Delta    float64
	Pick     string
	IsWinner bool
	Stake    int
	Random   bool
}

var calculationLock sync.Map

// CalculateMatches computes point deltas for a set of completed matches,
// updates player balances, and persists the results to Firebase.
// Returns a map of matchID → (userID → Delta).
func CalculateMatches(ctx context.Context, db *firebase.Client, matches []firebase.Match) (map[int]map[string]*Delta, error) {
	toProcess := []firebase.Match{}
	for _, m := range matches {
		if _, loaded := calculationLock.LoadOrStore(m.ID, struct{}{}); !loaded {
			toProcess = append(toProcess, m)
		}
	}
	if len(toProcess) == 0 {
		slog.Info("all matches already being calculated, skipping")
		return nil, nil
	}
	defer func() {
		for _, m := range toProcess {
			calculationLock.Delete(m.ID)
		}
	}()

	votes, err := db.ReadAllVotes(ctx)
	if err != nil {
		return nil, fmt.Errorf("read votes: %w", err)
	}
	wagers, err := db.ReadPlayerWagers(ctx)
	if err != nil {
		return nil, fmt.Errorf("read wagers: %w", err)
	}
	curses, err := db.ReadCurses(ctx)
	if err != nil {
		return nil, fmt.Errorf("read curses: %w", err)
	}
	players, err := db.ReadPlayers(ctx)
	if err != nil {
		return nil, fmt.Errorf("read players: %w", err)
	}
	if len(players) == 0 {
		slog.Warn("no players registered, skipping calculation")
		return map[int]map[string]*Delta{}, nil
	}

	matchDeltas := map[int]map[string]*Delta{}

	for _, match := range toProcess {
		winner := GetWinner(&match)
		if winner == "" {
			slog.Warn("match has no result, skipping", "id", match.ID)
			continue
		}

		key := fmt.Sprintf("%d", match.ID-1)
		var matchVotes map[string]*firebase.Vote
		if v, ok := votes[key]; ok {
			matchVotes = v[match.MessageID]
		}

		randomPicks, deltas := calculatePlayerPoints(players, matchVotes, &match, wagers)
		resolveCurses(players, curses, &match, votes, randomPicks, deltas)

		matchDeltas[match.ID] = deltas

		if err := db.SaveMatchRandomPicks(ctx, match.ID-1, randomPicks); err != nil {
			slog.Error("save random picks failed", "match", match.ID, "err", err)
		}
		if err := db.UpdateMatch(ctx, match.ID-1, map[string]interface{}{"isCalculated": true}); err != nil {
			slog.Error("mark calculated failed", "match", match.ID, "err", err)
		}
		slog.Info("calculated match", "id", match.ID)
	}

	if err := db.UpdatePlayers(ctx, players); err != nil {
		return nil, fmt.Errorf("persist players: %w", err)
	}
	slog.Info("persisted player data", "matches", len(toProcess))

	return matchDeltas, nil
}

func calculatePlayerPoints(
	players map[string]*firebase.Player,
	votes map[string]*firebase.Vote,
	match *firebase.Match,
	wagers map[string]map[string]*firebase.Wager,
) (randomPicks map[string]string, deltas map[string]*Delta) {
	winner := GetWinner(match)
	playerIDs := make([]string, 0, len(players))
	for id := range players {
		playerIDs = append(playerIDs, id)
	}

	picks, randomPicks, playerStakes := resolveMatchPicks(playerIDs, votes, match, wagers)
	rawDeltas := computeDeltas(picks, playerStakes, winner)

	deltas = make(map[string]*Delta, len(rawDeltas))
	for id, d := range rawDeltas {
		_, isRandom := randomPicks[id]
		deltas[id] = &Delta{
			Delta:    d.delta,
			Pick:     d.pick,
			IsWinner: d.isWinner,
			Stake:    d.stake,
			Random:   isRandom,
		}
		newPts := round2(players[id].Points + d.delta)
		players[id] = &firebase.Player{
			Points:             newPts,
			Matches:            players[id].Matches + 1,
			HadNegativeBalance: players[id].HadNegativeBalance || newPts < 0,
		}
	}
	return randomPicks, deltas
}

type rawDelta struct {
	delta    float64
	pick     string
	isWinner bool
	stake    int
}

func resolveMatchPicks(
	playerIDs []string,
	votes map[string]*firebase.Vote,
	match *firebase.Match,
	wagers map[string]map[string]*firebase.Wager,
) (picks map[string]string, randomPicks map[string]string, playerStakes map[string]int) {
	outcomes := []string{match.Home, "draw", match.Away}
	baseStake := GetMatchStake(match.ID)

	picks = make(map[string]string, len(playerIDs))
	randomPicks = make(map[string]string)
	votedSet := map[string]bool{}

	for _, id := range playerIDs {
		if votes != nil {
			if v, ok := votes[id]; ok && v != nil {
				picks[id] = v.Vote
				votedSet[id] = true
			}
		}
	}

	// Assign unvoted players
	leastPicked := getLeastVotedOutcome(outcomes, picks)
	for _, id := range playerIDs {
		if votedSet[id] {
			continue
		}
		usesRandom := false
		if w := wagers[id]; w != nil {
			if wm := w[fmt.Sprintf("%d", match.ID)]; wm != nil {
				usesRandom = wm.Random
			}
		}
		var pick string
		if usesRandom {
			pick = outcomes[rand.IntN(len(outcomes))]
		} else {
			pick = leastPicked
		}
		picks[id] = pick
		randomPicks[id] = pick
	}

	playerStakes = make(map[string]int, len(picks))
	for id := range picks {
		multiplier := 1
		if w := wagers[id]; w != nil {
			if wm := w[fmt.Sprintf("%d", match.ID)]; wm != nil && wm.DoubleDown {
				multiplier = 2
			}
		}
		playerStakes[id] = baseStake * multiplier
	}
	return picks, randomPicks, playerStakes
}

func getLeastVotedOutcome(outcomes []string, picks map[string]string) string {
	counts := make(map[string]int, len(outcomes))
	for _, o := range outcomes {
		counts[o] = 0
	}
	for _, v := range picks {
		counts[v]++
	}
	minCount := counts[outcomes[0]]
	for _, o := range outcomes[1:] {
		if counts[o] < minCount {
			minCount = counts[o]
		}
	}
	var least []string
	for _, o := range outcomes {
		if counts[o] == minCount {
			least = append(least, o)
		}
	}
	return least[rand.IntN(len(least))]
}

func computeDeltas(picks map[string]string, playerStakes map[string]int, winner string) map[string]rawDelta {
	var winnerEntries, loserEntries []string
	for id, pick := range picks {
		if pick == winner {
			winnerEntries = append(winnerEntries, id)
		} else {
			loserEntries = append(loserEntries, id)
		}
	}

	allWin := len(loserEntries) == 0
	allLose := len(winnerEntries) == 0

	totalLoserStake := 0
	for _, id := range loserEntries {
		totalLoserStake += playerStakes[id]
	}
	totalWinnerStake := 0
	for _, id := range winnerEntries {
		totalWinnerStake += playerStakes[id]
	}

	deltas := make(map[string]rawDelta, len(picks))
	for id, pick := range picks {
		isWinner := pick == winner
		var delta float64
		if allWin || allLose {
			delta = 0
		} else if isWinner && totalWinnerStake > 0 {
			delta = round2(float64(playerStakes[id]) / float64(totalWinnerStake) * float64(totalLoserStake))
		} else if !isWinner {
			delta = -float64(playerStakes[id])
		}
		deltas[id] = rawDelta{delta: delta, pick: pick, isWinner: isWinner, stake: playerStakes[id]}
	}
	return deltas
}

func resolveCurses(
	players map[string]*firebase.Player,
	curses map[string]map[string]*firebase.Curse,
	match *firebase.Match,
	votes map[string]map[string]map[string]*firebase.Vote,
	randomPicks map[string]string,
	deltas map[string]*Delta,
) {
	matchCurses := curses[fmt.Sprintf("%d", match.ID)]
	if len(matchCurses) == 0 {
		return
	}
	winner := GetWinner(match)
	if winner == "" {
		return
	}
	key := fmt.Sprintf("%d", match.ID-1)

	for curserID, c := range matchCurses {
		if _, ok := players[curserID]; !ok {
			continue
		}
		if _, ok := players[c.Target]; !ok {
			continue
		}

		var targetVote string
		if mv, ok := votes[key]; ok {
			if byMsg, ok := mv[match.MessageID]; ok {
				if v, ok := byMsg[c.Target]; ok && v != nil {
					targetVote = v.Vote
				}
			}
		}
		if targetVote == "" {
			targetVote = randomPicks[c.Target]
		}
		if targetVote == "" {
			continue
		}

		targetCorrect := targetVote == winner

		if targetCorrect {
			players[curserID].Points = round2(players[curserID].Points - CursePts)
			players[c.Target].Points = round2(players[c.Target].Points + CursePts)
		} else {
			players[curserID].Points = round2(players[curserID].Points + CursePts)
			players[c.Target].Points = round2(players[c.Target].Points - CursePts)
		}

		if d, ok := deltas[curserID]; ok {
			if targetCorrect {
				d.Delta -= CursePts
			} else {
				d.Delta += CursePts
			}
		}
		if d, ok := deltas[c.Target]; ok {
			if targetCorrect {
				d.Delta += CursePts
			} else {
				d.Delta -= CursePts
			}
		}

		slog.Info("curse resolved", "curser", curserID, "target", c.Target, "targetCorrect", targetCorrect, "match", match.ID)
	}
}

// UpdateGroupStandings updates group table stats for a group-stage match.
func UpdateGroupStandings(ctx context.Context, db *firebase.Client, match *firebase.Match) error {
	const maxGroupStageID = 72
	if match.ID > maxGroupStageID || !match.HasResult || match.Result == nil {
		return nil
	}
	if match.GroupUpdated {
		return nil
	}

	// Re-fetch to guard against races
	matches, err := db.ReadMatches(ctx)
	if err != nil {
		return err
	}
	if match.ID-1 < len(matches) && matches[match.ID-1].GroupUpdated {
		return nil
	}

	groups, err := db.ReadGroups(ctx)
	if err != nil || groups == nil {
		return fmt.Errorf("no groups data")
	}

	var groupKey string
	for key, teams := range groups {
		if _, okH := teams[match.Home]; okH {
			if _, okA := teams[match.Away]; okA {
				groupKey = key
				break
			}
		}
	}
	if groupKey == "" {
		slog.Warn("could not find group for match", "id", match.ID, "home", match.Home, "away", match.Away)
		return nil
	}

	homeGoals := match.Result.Home
	awayGoals := match.Result.Away
	homeTeam := groups[groupKey][match.Home]
	awayTeam := groups[groupKey][match.Away]

	homeWon, awayWon, drawn := 0, 0, 0
	switch {
	case homeGoals > awayGoals:
		homeWon = 1
	case awayGoals > homeGoals:
		awayWon = 1
	default:
		drawn = 1
	}

	homePts := 0
	if homeWon == 1 {
		homePts = 3
	} else if drawn == 1 {
		homePts = 1
	}
	awayPts := 0
	if awayWon == 1 {
		awayPts = 3
	} else if drawn == 1 {
		awayPts = 1
	}

	updatedHome := &firebase.GroupTeamStats{
		Played:         homeTeam.Played + 1,
		Won:            homeTeam.Won + homeWon,
		Drawn:          homeTeam.Drawn + drawn,
		Lost:           homeTeam.Lost + awayWon,
		For:            homeTeam.For + homeGoals,
		Against:        homeTeam.Against + awayGoals,
		GoalDifference: homeTeam.GoalDifference + homeGoals - awayGoals,
		Points:         homeTeam.Points + homePts,
	}
	updatedAway := &firebase.GroupTeamStats{
		Played:         awayTeam.Played + 1,
		Won:            awayTeam.Won + awayWon,
		Drawn:          awayTeam.Drawn + drawn,
		Lost:           awayTeam.Lost + homeWon,
		For:            awayTeam.For + awayGoals,
		Against:        awayTeam.Against + homeGoals,
		GoalDifference: awayTeam.GoalDifference + awayGoals - homeGoals,
		Points:         awayTeam.Points + awayPts,
	}

	if err := db.UpdateGroupTeam(ctx, groupKey, match.Home, updatedHome); err != nil {
		return err
	}
	if err := db.UpdateGroupTeam(ctx, groupKey, match.Away, updatedAway); err != nil {
		return err
	}
	if err := db.UpdateMatch(ctx, match.ID-1, map[string]interface{}{"groupUpdated": true}); err != nil {
		return err
	}
	slog.Info("updated group standings", "group", groupKey, "match", match.ID)
	return nil
}

func round2(v float64) float64 {
	if v < 0 {
		return float64(int64(v*100-0.5)) / 100
	}
	return float64(int64(v*100+0.5)) / 100
}
