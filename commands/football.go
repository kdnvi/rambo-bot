package commands

// stageStake maps match ID ranges to point stakes.
var stageStakes = []struct {
	minID, maxID int
	stake        int
}{
	{1, 72, 10},
	{73, 88, 10},
	{89, 96, 15},
	{97, 100, 20},
	{101, 102, 30},
	{103, 104, 50},
}

// getMatchStake returns the stake for a given match ID.
func getMatchStake(matchID int) int {
	for _, s := range stageStakes {
		if matchID >= s.minID && matchID <= s.maxID {
			return s.stake
		}
	}
	return 10
}
