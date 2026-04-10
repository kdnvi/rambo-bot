package commands

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func WallOfShame(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || len(players) == 0 {
		replyErr(ctx, b, i, "❌ Chưa có người chơi.")
		return
	}

	matches, _ := b.DB.ReadMatches(ctx)
	var completed []int
	for idx, m := range matches {
		if m.HasResult && m.IsCalculated {
			completed = append(completed, idx)
		}
	}
	sort.Slice(completed, func(a, b int) bool {
		ta, _ := time.Parse(time.RFC3339, matches[completed[a]].Date)
		tb, _ := time.Parse(time.RFC3339, matches[completed[b]].Date)
		return ta.Before(tb)
	})
	if len(completed) == 0 {
		replyErr(ctx, b, i, "❌ Chưa có trận nào hoàn thành.")
		return
	}

	if err := deferReply(ctx, b, i, false); err != nil {
		return
	}

	tournamentName := getTournamentName(ctx, b)
	votes, _ := b.DB.ReadAllVotes(ctx)
	users := b.GetAllCachedUsers()

	playerIDs := make([]string, 0, len(players))
	for id := range players {
		playerIDs = append(playerIDs, id)
	}

	type streak struct{ current, max int }
	loseStreaks := map[string]*streak{}
	winStreaks := map[string]*streak{}
	missedVotes := map[string]int{}
	totalWrong := map[string]int{}
	totalCorrect := map[string]int{}

	for _, id := range playerIDs {
		loseStreaks[id] = &streak{}
		winStreaks[id] = &streak{}
	}

	for _, idx := range completed {
		m := matches[idx]
		key := fmt.Sprintf("%d", m.ID-1)
		winner := getWinner(&m)
		if winner == "" {
			continue
		}
		for _, id := range playerIDs {
			userVote := getMatchVote(votes, key, m.MessageID, id)
			if userVote == "" {
				missedVotes[id]++
				loseStreaks[id].current = 0
				winStreaks[id].current = 0
				continue
			}
			if userVote == winner {
				totalCorrect[id]++
				winStreaks[id].current++
				if winStreaks[id].current > winStreaks[id].max {
					winStreaks[id].max = winStreaks[id].current
				}
				loseStreaks[id].current = 0
			} else {
				totalWrong[id]++
				loseStreaks[id].current++
				if loseStreaks[id].current > loseStreaks[id].max {
					loseStreaks[id].max = loseStreaks[id].current
				}
				winStreaks[id].current = 0
			}
		}
	}

	nick := func(id string) string {
		if u := users[id]; u != nil {
			return u.DisplayName()
		}
		return "Unknown"
	}
	names := func(ids []string) string {
		ns := make([]string, len(ids))
		for i, id := range ids {
			ns[i] = nick(id)
		}
		return joinLines(ns, ", ")
	}

	topBy := func(valFn func(string) int, desc bool) ([]string, int) {
		sorted := make([]string, len(playerIDs))
		copy(sorted, playerIDs)
		sort.Slice(sorted, func(a, b int) bool {
			if desc {
				return valFn(sorted[a]) > valFn(sorted[b])
			}
			return valFn(sorted[a]) < valFn(sorted[b])
		})
		top := valFn(sorted[0])
		var ids []string
		for _, id := range sorted {
			if valFn(id) == top {
				ids = append(ids, id)
			}
		}
		return ids, top
	}

	bestStreakIDs, bestStreakVal := topBy(func(id string) int { return winStreaks[id].max }, true)
	worstStreakIDs, worstStreakVal := topBy(func(id string) int { return loseStreaks[id].max }, true)
	mostCorrectIDs, mostCorrectVal := topBy(func(id string) int { return totalCorrect[id] }, true)
	mostWrongIDs, mostWrongVal := topBy(func(id string) int { return totalWrong[id] }, true)
	diligentIDs, diligentVal := topBy(func(id string) int { return missedVotes[id] }, false)
	laziestIDs, laziestVal := topBy(func(id string) int { return missedVotes[id] }, true)
	richestIDs, richestVal := topBy(func(id string) int { return int(players[id].Points * 100) }, true)
	poorestIDs, poorestVal := topBy(func(id string) int { return int(players[id].Points * 100) }, false)

	lines := []string{
		"**🔥 Chuỗi thắng vs 🔻 Chuỗi thua**",
		fmt.Sprintf("👑 %s — **%d** trận đúng liền", names(bestStreakIDs), bestStreakVal),
		fmt.Sprintf("💀 %s — **%d** trận sai liền", names(worstStreakIDs), worstStreakVal),
		"",
		"**🎯 Thánh đoán vs 🤡 Thánh sai**",
		fmt.Sprintf("👑 %s — **%d**/%d đúng", names(mostCorrectIDs), mostCorrectVal, len(completed)),
		fmt.Sprintf("💀 %s — **%d**/%d sai", names(mostWrongIDs), mostWrongVal, len(completed)),
		"",
		"**⚡ Siêng nhất vs 😴 Lười nhất**",
		fmt.Sprintf("👑 %s — bỏ **%d** vote", names(diligentIDs), diligentVal),
		fmt.Sprintf("💀 %s — bỏ **%d** vote", names(laziestIDs), laziestVal),
		"",
		"**💰 Đại gia vs 📉 Viện trợ**",
		fmt.Sprintf("👑 %s — **%.2f** pts", names(richestIDs), float64(richestVal)/100),
		fmt.Sprintf("💀 %s — **%.2f** pts", names(poorestIDs), float64(poorestVal)/100),
	}

	desc := joinLines(lines, "\n")
	if len(desc) > 4096 {
		desc = desc[:4093] + "..."
	}

	editReply(ctx, b, i, discord.EditMessagePayload{
		Embeds: []discord.Embed{{
			Title:       fmt.Sprintf("⚔️  %s — Đối đầu", tournamentName),
			Description: desc,
			Color:       0xED4245,
			Footer:      &discord.EmbedFooter{Text: "Có vua thì phải có hề."},
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}
