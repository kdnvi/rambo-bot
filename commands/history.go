package commands

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func History(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	if err := deferReply(ctx, b, i, true); err != nil {
		return
	}

	tournamentName := getTournamentName(ctx, b)

	targetID := i.ActingUser().ID
	targetDisplayName := i.ActingUser().DisplayName()
	targetAvatarURL := i.ActingUser().AvatarURL()

	if opt := i.Data.GetOption("user"); opt != nil {
		targetID = opt.String()
	}
	count := int64(5)
	if opt := i.Data.GetOption("count"); opt != nil {
		count = opt.Int()
	}

	if u := b.GetCachedUser(targetID); u != nil {
		targetDisplayName = u.DisplayName()
		targetAvatarURL = u.AvatarURL
	}

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil || matches == nil {
		editReply(ctx, b, i, discord.EditMessagePayload{Content: "❌ Không có dữ liệu trận đấu."})
		return
	}

	votes, _ := b.DB.ReadAllVotes(ctx)
	userWagers, _ := b.DB.ReadUserWagers(ctx, targetID)
	allCurses, _ := b.DB.ReadCurses(ctx)
	users := b.GetAllCachedUsers()

	// Completed matches sorted oldest first
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

	type histEntry struct {
		matchID      int
		home, away   string
		result       [2]int
		winner       string
		vote         string
		correct      *bool
		hasDoubleDown bool
		hasRandom    bool
		curseTarget  string
	}

	cursedTargetCounts := map[string]int{}
	var history []histEntry

	for _, idx := range completed {
		m := matches[idx]
		key := fmt.Sprintf("%d", m.ID-1)
		winner := getWinner(&m)
		userVote := getMatchVote(votes, key, m.MessageID, targetID)

		matchIDStr := fmt.Sprintf("%d", m.ID)
		wager := userWagers[matchIDStr]
		curse := allCurses[fmt.Sprintf("%d", m.ID)]
		var curseTarget string
		if c, ok := curse[targetID]; ok {
			curseTarget = c.Target
			cursedTargetCounts[curseTarget]++
		}

		var correct *bool
		if userVote != "" {
			c := userVote == winner
			correct = &c
		}

		res := [2]int{}
		if m.Result != nil {
			res = [2]int{m.Result.Home, m.Result.Away}
		}

		history = append(history, histEntry{
			matchID:      m.ID,
			home:         m.Home,
			away:         m.Away,
			result:       res,
			winner:       winner,
			vote:         userVote,
			correct:      correct,
			hasDoubleDown: wager != nil && wager.DoubleDown,
			hasRandom:    wager != nil && wager.Random,
			curseTarget:  curseTarget,
		})
	}

	// Take last `count` entries, reverse to newest-first
	recent := history
	if int64(len(recent)) > count {
		recent = recent[len(recent)-int(count):]
	}
	for lo, hi := 0, len(recent)-1; lo < hi; lo, hi = lo+1, hi-1 {
		recent[lo], recent[hi] = recent[hi], recent[lo]
	}

	if len(recent) == 0 {
		editReply(ctx, b, i, discord.EditMessagePayload{
			Embeds: []discord.Embed{{
				Title:       "🔍  Không có lịch sử",
				Description: fmt.Sprintf("Chưa có trận nào xong cho **%s** cả.", targetDisplayName),
				Color:       0xFEE75C,
			}},
		})
		return
	}

	lines := make([]string, 0, len(recent))
	for _, r := range recent {
		score := fmt.Sprintf("%d-%d", r.result[0], r.result[1])
		var line string
		if r.vote == "" {
			autoLabel := "tự động (least-voted)"
			if r.hasRandom {
				autoLabel = "ngẫu nhiên 🎲"
			}
			line = fmt.Sprintf("🤖 **#%d** %s %s %s — *%s*",
				r.matchID, upper(r.home), score, upper(r.away), autoLabel)
		} else {
			icon := "🤡"
			if r.correct != nil && *r.correct {
				icon = "👑"
			}
			line = fmt.Sprintf("%s **#%d** %s %s %s — vote **%s**",
				icon, r.matchID, upper(r.home), score, upper(r.away), upper(r.vote))
		}

		var tags []string
		if r.hasDoubleDown {
			tags = append(tags, "⏫ double-down")
		}
		if r.curseTarget != "" {
			tName := "Unknown"
			if u := users[r.curseTarget]; u != nil {
				tName = u.DisplayName()
			}
			tags = append(tags, fmt.Sprintf("🪄 nguyền **%s**", tName))
		}
		if len(tags) > 0 {
			line += "\n  └ " + strings.Join(tags, " · ")
		}
		lines = append(lines, line)
	}

	totalVoted := 0
	totalCorrect := 0
	totalRandom := 0
	totalAuto := 0
	totalDD := 0
	totalCurses := 0
	for _, r := range history {
		if r.vote != "" {
			totalVoted++
			if r.correct != nil && *r.correct {
				totalCorrect++
			}
		} else {
			if r.hasRandom {
				totalRandom++
			} else {
				totalAuto++
			}
		}
		if r.hasDoubleDown {
			totalDD++
		}
		if r.curseTarget != "" {
			totalCurses++
		}
	}

	winRate := "—"
	if totalVoted > 0 {
		winRate = fmt.Sprintf("%d%%", (totalCorrect*100)/totalVoted)
	}

	summary := fmt.Sprintf("🎯 Tỉ lệ đúng **%s** (%d/%d)", winRate, totalCorrect, totalVoted)
	if totalRandom > 0 {
		summary += fmt.Sprintf(" · 🎲 %d random", totalRandom)
	}
	if totalAuto > 0 {
		summary += fmt.Sprintf(" · 🤖 %d tự động", totalAuto)
	}
	if totalDD > 0 || totalCurses > 0 {
		var parts []string
		if totalDD > 0 {
			parts = append(parts, fmt.Sprintf("⏫ %d double-down", totalDD))
		}
		if totalCurses > 0 {
			parts = append(parts, fmt.Sprintf("🪄 %d curse", totalCurses))
		}
		summary += "\n" + strings.Join(parts, " · ")
	}
	if len(cursedTargetCounts) > 0 {
		type kv struct {
			id    string
			count int
		}
		var kvs []kv
		for id, c := range cursedTargetCounts {
			kvs = append(kvs, kv{id, c})
		}
		sort.Slice(kvs, func(a, b int) bool { return kvs[a].count > kvs[b].count })
		parts := make([]string, 0, len(kvs))
		for _, kv := range kvs {
			name := "Unknown"
			if u := users[kv.id]; u != nil {
				name = u.DisplayName()
			}
			parts = append(parts, fmt.Sprintf("%s (×%d)", name, kv.count))
		}
		summary += "\n🪄 Nguyền: " + strings.Join(parts, ", ")
	}

	desc := fmt.Sprintf("**%s**\n\n%s\n\n%s", tournamentName, joinLines(lines, "\n"), summary)
	if len(desc) > 4096 {
		desc = desc[:4093] + "..."
	}

	embed := discord.Embed{
		Title:       fmt.Sprintf("📜  Lịch sử vote %s", targetDisplayName),
		Description: desc,
		Color:       0x5865F2,
		Footer:      &discord.EmbedFooter{Text: fmt.Sprintf("Hiển thị %d/%d trận gần nhất", len(recent), len(history))},
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
	if targetAvatarURL != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: targetAvatarURL}
	}

	editReply(ctx, b, i, discord.EditMessagePayload{Embeds: []discord.Embed{embed}})
}
