package commands

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/badges"
	"github.com/kdnvi/rambo-bot/internal/discord"
	"github.com/kdnvi/rambo-bot/internal/firebase"
	"github.com/kdnvi/rambo-bot/internal/flavor"
	"github.com/kdnvi/rambo-bot/internal/football"
)

func UpdateResult(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	allowed := allowedUsers()
	if !allowed[i.ActingUser().ID] {
		replyErr(ctx, b, i, "❌ Bạn không có quyền cập nhật kết quả trận đấu.")
		return
	}

	matchID := int(i.Data.GetOption("match-id").Int())
	homeScore := int(i.Data.GetOption("home-score").Int())
	awayScore := int(i.Data.GetOption("away-score").Int())
	matchIndex := matchID - 1

	if err := deferReply(ctx, b, i, false); err != nil {
		return
	}

	matches, err := b.DB.ReadMatches(ctx)
	if err != nil {
		editReply(ctx, b, i, discord.EditMessagePayload{Content: "❌ Không có dữ liệu trận đấu."})
		return
	}

	if matchIndex < 0 || matchIndex >= len(matches) {
		editReply(ctx, b, i, discord.EditMessagePayload{
			Embeds: []discord.Embed{{
				Title:       "❌  Không tìm thấy trận",
				Description: fmt.Sprintf("Không tìm thấy trận đấu với ID `%d`.", matchID),
				Color:       0xED4245,
				Timestamp:   time.Now().UTC().Format(time.RFC3339),
			}},
		})
		return
	}

	matchData := matches[matchIndex]

	if matchData.MessageID == "" {
		editReply(ctx, b, i, discord.EditMessagePayload{
			Embeds: []discord.Embed{{
				Title:       "⚠️  Trận chưa được đăng",
				Description: fmt.Sprintf("Trận `#%d` chưa được đăng lên channel — chưa ai vote được thì cập nhật kết quả làm gì?", matchID),
				Color:       0xFEE75C,
				Timestamp:   time.Now().UTC().Format(time.RFC3339),
			}},
		})
		return
	}

	if matchData.Date != "" {
		kickoff, _ := time.Parse(time.RFC3339, matchData.Date)
		elapsed := time.Since(kickoff)
		if elapsed < 90*time.Minute {
			remaining := int((90*time.Minute - elapsed).Minutes())
			editReply(ctx, b, i, discord.EditMessagePayload{
				Embeds: []discord.Embed{{
					Title:       "⏳  Chưa đủ 90 phút",
					Description: fmt.Sprintf("Trận `#%d` mới đá được chút xíu — chờ thêm **%d phút** nữa rồi hãy cập nhật.", matchID, remaining),
					Color:       0xFEE75C,
					Timestamp:   time.Now().UTC().Format(time.RFC3339),
				}},
			})
			return
		}
	}

	prevMatch, err := b.DB.UpdateMatchResult(ctx, matchIndex, homeScore, awayScore)
	if err != nil {
		if err.Error() == "not_found" {
			editReply(ctx, b, i, discord.EditMessagePayload{
				Embeds: []discord.Embed{{
					Title:       "❌  Không tìm thấy trận",
					Description: fmt.Sprintf("Không tìm thấy trận đấu với ID `%d`.", matchID),
					Color:       0xED4245,
					Timestamp:   time.Now().UTC().Format(time.RFC3339),
				}},
			})
		} else if err.Error() == "already_exists" {
			editReply(ctx, b, i, discord.EditMessagePayload{
				Embeds: []discord.Embed{{
					Title:       "⚠️  Kết quả đã tồn tại",
					Description: fmt.Sprintf("**%s** %d - %d **%s**", upper(prevMatch.Home), prevMatch.Result.Home, prevMatch.Result.Away, upper(prevMatch.Away)),
					Color:       0xFEE75C,
					Timestamp:   time.Now().UTC().Format(time.RFC3339),
				}},
			})
		} else {
			editReply(ctx, b, i, discord.EditMessagePayload{Content: "❌ Có lỗi xảy ra."})
		}
		return
	}

	editReply(ctx, b, i, discord.EditMessagePayload{
		Embeds: []discord.Embed{{
			Title:       "✅  Đã cập nhật kết quả",
			Description: fmt.Sprintf("**%s** %d - %d **%s**", upper(prevMatch.Home), homeScore, awayScore, upper(prevMatch.Away)),
			Color:       0x57F287,
			Fields: []discord.EmbedField{
				{Name: "🏟️ Sân vận động", Value: prevMatch.Location, Inline: true},
				{Name: "🆔 Match ID", Value: fmt.Sprintf("%d", matchID), Inline: true},
			},
			Footer:    &discord.EmbedFooter{Text: fmt.Sprintf("Cập nhật bởi %s", i.ActingUser().DisplayName())},
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}},
	})

	// Build the updated match for calculations
	updatedMatch := *prevMatch
	updatedMatch.HasResult = true
	updatedMatch.Result = &firebase.MatchResult{Home: homeScore, Away: awayScore}

	// Update group standings (group stage only)
	if err := football.UpdateGroupStandings(ctx, b.DB, &updatedMatch); err != nil {
		slog.Error("update group standings failed", "err", err)
	}

	// Calculate points
	matchDeltas, err := football.CalculateMatches(ctx, b.DB, []firebase.Match{updatedMatch})
	if err != nil {
		slog.Error("calculate matches failed", "err", err)
	}
	slog.Info("immediate calculation triggered", "match", matchID)

	// Check badges
	if matchDeltas != nil {
		allMatches, _ := b.DB.ReadMatches(ctx)
		completed := make([]firebase.Match, 0)
		for _, m := range allMatches {
			if m.HasResult && m.IsCalculated {
				completed = append(completed, m)
			}
		}
		badges.CheckAndAward(ctx, b, completed, updatedMatch.ID)
	}

	// Post breakdown, curse results, standings, roast
	postMatchBreakdown(ctx, b, i, &updatedMatch, matchDeltas[updatedMatch.ID])
	postCurseResults(ctx, b, i, &updatedMatch, matchDeltas[updatedMatch.ID])
	postStandings(ctx, b, i)
	postMatchRoast(ctx, b, i, &updatedMatch)
}

func postMatchBreakdown(ctx context.Context, b *bot.Bot, i *discord.Interaction, match *firebase.Match, deltas map[string]*football.Delta) {
	if len(deltas) == 0 {
		return
	}
	users := b.GetAllCachedUsers()

	type entry struct {
		name     string
		delta    float64
		pick     string
		isWinner bool
		random   bool
	}
	entries := make([]entry, 0, len(deltas))
	for uid, d := range deltas {
		name := "Unknown"
		if u := users[uid]; u != nil {
			name = u.DisplayName()
		}
		entries = append(entries, entry{name, round2(d.Delta), d.Pick, d.IsWinner, d.Random})
	}
	// Sort winners first, then by delta desc
	for a := 0; a < len(entries); a++ {
		for b2 := a + 1; b2 < len(entries); b2++ {
			if entries[b2].delta > entries[a].delta {
				entries[a], entries[b2] = entries[b2], entries[a]
			}
		}
	}

	allWin := true
	allLose := true
	for _, e := range entries {
		if !e.isWinner {
			allWin = false
		}
		if e.isWinner {
			allLose = false
		}
	}

	lines := make([]string, 0, len(entries))
	for _, e := range entries {
		sign := ""
		if e.delta >= 0 {
			sign = "+"
		}
		icon := "🤡"
		if e.isWinner {
			icon = "👑"
		}
		tag := ""
		if e.random {
			tag = " 🎲"
		}
		lines = append(lines, fmt.Sprintf("%s **%s** — %s%s → **%s%.2f** pts", icon, e.name, upper(e.pick), tag, sign, e.delta))
	}

	if allWin {
		lines = append(lines, "", flavor.PickLine(ctx, b.DB, "all_win"))
	} else if allLose {
		lines = append(lines, "", flavor.PickLine(ctx, b.DB, "all_lose"))
	}

	color := 0x5865F2
	if allWin {
		color = 0x57F287
	} else if allLose {
		color = 0xED4245
	}

	followup(ctx, b, i, discord.SendMessagePayload{
		Embeds: []discord.Embed{{
			Title:       fmt.Sprintf("💰  Sổ sách trận #%d", match.ID),
			Description: strings.Join(lines, "\n"),
			Color:       color,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func postCurseResults(ctx context.Context, b *bot.Bot, i *discord.Interaction, match *firebase.Match, deltas map[string]*football.Delta) {
	curses, err := b.DB.ReadCurses(ctx)
	if err != nil {
		return
	}
	matchCurses := curses[fmt.Sprintf("%d", match.ID)]
	if len(matchCurses) == 0 {
		return
	}
	winner := football.GetWinner(match)
	if winner == "" {
		return
	}

	users := b.GetAllCachedUsers()
	lines := []string{}
	for curserID, curse := range matchCurses {
		curserName := "Unknown"
		if u := users[curserID]; u != nil {
			curserName = u.DisplayName()
		}
		targetName := "Unknown"
		if u := users[curse.Target]; u != nil {
			targetName = u.DisplayName()
		}
		d := deltas[curse.Target]
		if d == nil {
			continue
		}
		autoTag := ""
		if d.Random {
			autoTag = " *(auto)*"
		}
		targetCorrect := d.Pick == winner
		if targetCorrect {
			lines = append(lines, fmt.Sprintf("🧿 **%s** nguyền **%s**%s — người đó đúng! **%s** mất **%d** pts. %s",
				curserName, targetName, autoTag, curserName, football.CursePts, flavor.PickLine(ctx, b.DB, "curse_lose")))
		} else {
			lines = append(lines, fmt.Sprintf("🧿 **%s** nguyền **%s**%s — người đó sai! **%s** ăn **%d** pts. %s",
				curserName, targetName, autoTag, curserName, football.CursePts, flavor.PickLine(ctx, b.DB, "curse_win")))
		}
	}
	if len(lines) == 0 {
		return
	}
	followup(ctx, b, i, discord.SendMessagePayload{
		Embeds: []discord.Embed{{
			Title:       fmt.Sprintf("🧿  Bùa chú trận #%d", match.ID),
			Description: strings.Join(lines, "\n"),
			Color:       0x9B59B6,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func postMatchRoast(ctx context.Context, b *bot.Bot, i *discord.Interaction, match *firebase.Match) {
	if match.MessageID == "" {
		return
	}
	votes, err := b.DB.ReadMatchVotes(ctx, match.ID, match.MessageID)
	if err != nil || len(votes) == 0 {
		return
	}
	winner := football.GetWinner(match)
	users := b.GetAllCachedUsers()

	var losers []string
	for uid, v := range votes {
		if v.Vote != winner {
			name := "Unknown"
			if u := users[uid]; u != nil {
				name = u.DisplayName()
			}
			losers = append(losers, name)
		}
	}
	if len(losers) == 0 {
		return
	}

	roasted := losers
	if len(roasted) > 3 {
		roasted = roasted[:3]
	}
	lines := make([]string, 0, len(roasted))
	for _, name := range roasted {
		lines = append(lines, fmt.Sprintf("🤡 **%s** %s", name, flavor.PickLine(ctx, b.DB, "roast")))
	}
	if len(losers) > 3 {
		lines = append(lines, fmt.Sprintf("...cùng **%d** thánh sai khác", len(losers)-3))
	}

	followup(ctx, b, i, discord.SendMessagePayload{
		Embeds: []discord.Embed{{
			Title:       "🔥  Xào nát sau trận",
			Description: strings.Join(lines, "\n"),
			Color:       0xE67E22,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func postStandings(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || len(players) < 2 {
		return
	}
	users := b.GetAllCachedUsers()

	type entry struct {
		id     string
		name   string
		points float64
	}
	ranked := make([]entry, 0, len(players))
	for id, p := range players {
		name := "Unknown"
		if u := users[id]; u != nil {
			name = u.DisplayName()
		}
		ranked = append(ranked, entry{id, name, p.Points})
	}
	for a := 0; a < len(ranked); a++ {
		for b2 := a + 1; b2 < len(ranked); b2++ {
			if ranked[b2].points > ranked[a].points {
				ranked[a], ranked[b2] = ranked[b2], ranked[a]
			}
		}
	}
	if ranked[0].points <= 0 {
		return
	}

	leader := ranked[0]
	bottom := ranked[len(ranked)-1]

	leaderLine := flavor.PickLine(ctx, b.DB, "leader")
	bottomLine := flavor.PickLine(ctx, b.DB, "bottom")

	lines := []string{
		fmt.Sprintf("👑 **%s** %s (%s)", leader.name, leaderLine, fmtVND(leader.points)),
		"",
		fmt.Sprintf("💀 **%s** %s (%s)", bottom.name, bottomLine, fmtVND(bottom.points)),
	}

	followup(ctx, b, i, discord.SendMessagePayload{
		Embeds: []discord.Embed{{
			Title:       "📊  BXH sau trận",
			Description: strings.Join(lines, "\n"),
			Color:       0xFFD700,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func allowedUsers() map[string]bool {
	m := map[string]bool{}
	for _, id := range strings.Split(os.Getenv("AUDITED_USERS"), ",") {
		if id != "" {
			m[id] = true
		}
	}
	return m
}

func round2(v float64) float64 {
	if v < 0 {
		return float64(int64(v*100-0.5)) / 100
	}
	return float64(int64(v*100+0.5)) / 100
}
