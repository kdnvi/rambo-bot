package commands

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/kdnvi/rambo-bot/bot"
	"github.com/kdnvi/rambo-bot/internal/discord"
)

func Stats(ctx context.Context, b *bot.Bot, i *discord.Interaction) {
	// Resolve target user
	targetID := i.ActingUser().ID
	targetAvatarURL := i.ActingUser().AvatarURL()
	targetDisplayName := i.ActingUser().DisplayName()

	if opt := i.Data.GetOption("user"); opt != nil {
		targetID = opt.String()
	}

	players, err := b.DB.ReadPlayers(ctx)
	if err != nil || players[targetID] == nil {
		msg := "Chưa đăng ký kìa. `/register` đi rồi chơi!"
		if targetID != i.ActingUser().ID {
			msg = fmt.Sprintf("<@%s> chưa đăng ký.", targetID)
		}
		replyEphemeral(ctx, b, i, discord.InteractionCallbackData{
			Embeds: []discord.Embed{{
				Title:       "❌  Chưa đăng ký",
				Description: msg,
				Color:       0xED4245,
			}},
		})
		return
	}

	if err := deferReply(ctx, b, i, false); err != nil {
		return
	}

	tournamentName := getTournamentName(ctx, b)
	player := players[targetID]

	matches, _ := b.DB.ReadMatches(ctx)
	votes, _ := b.DB.ReadAllVotes(ctx)
	userWagers, _ := b.DB.ReadUserWagers(ctx, targetID)

	completed := make([]int, 0)
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

	correctCount, votedCount := 0, 0
	type recentEntry struct {
		matchID int
		home    string
		away    string
		vote    string
		correct bool
		auto    bool
		random  bool
	}
	var recentResults []recentEntry

	for _, idx := range completed {
		m := matches[idx]
		key := fmt.Sprintf("%d", m.ID-1)
		userVote := getMatchVote(votes, key, m.MessageID, targetID)
		winner := getWinner(&m)

		voted := userVote != ""
		correct := voted && userVote == winner
		if voted {
			votedCount++
		}
		if correct {
			correctCount++
		}

		wager := userWagers[fmt.Sprintf("%d", m.ID)]
		recentResults = append(recentResults, recentEntry{
			matchID: m.ID,
			home:    m.Home,
			away:    m.Away,
			vote:    userVote,
			correct: correct,
			auto:    !voted,
			random:  wager != nil && wager.Random,
		})
	}

	winRate := "—"
	if votedCount > 0 {
		winRate = fmt.Sprintf("%d%% (%d/%d)", (correctCount*100)/votedCount, correctCount, votedCount)
	}

	// Resolve display name from cache if available
	if u := b.GetCachedUser(targetID); u != nil {
		targetDisplayName = u.DisplayName()
		targetAvatarURL = u.AvatarURL
	}

	embed := discord.Embed{
		Title:       fmt.Sprintf("📊  Thống kê %s", targetDisplayName),
		Description: fmt.Sprintf("**%s**", tournamentName),
		Color:       0x5865F2,
		Fields: []discord.EmbedField{
			{Name: "💰 Tài khoản", Value: fmtVND(player.Points), Inline: true},
			{Name: "🎮 Đã chơi", Value: fmt.Sprintf("%d trận", player.Matches), Inline: true},
			{Name: "🎯 Tỉ lệ đúng", Value: winRate, Inline: true},
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	if targetAvatarURL != "" {
		embed.Thumbnail = &discord.EmbedImage{URL: targetAvatarURL}
	}

	// Last 5 matches
	recent := recentResults
	if len(recent) > 5 {
		recent = recent[len(recent)-5:]
	}
	// reverse
	for lo, hi := 0, len(recent)-1; lo < hi; lo, hi = lo+1, hi-1 {
		recent[lo], recent[hi] = recent[hi], recent[lo]
	}
	if len(recent) > 0 {
		lines := make([]string, 0, len(recent))
		for _, r := range recent {
			icon := "🤡"
			if r.correct {
				icon = "👑"
			}
			voteLabel := fmt.Sprintf("vote **%s**", upper(r.vote))
			if r.auto {
				if r.random {
					voteLabel = "🎲 random"
				} else {
					voteLabel = "🤖 auto"
				}
			}
			lines = append(lines, fmt.Sprintf("%s #%d %s vs %s — %s",
				icon, r.matchID, upper(r.home), upper(r.away), voteLabel))
		}
		embed.Fields = append(embed.Fields, discord.EmbedField{
			Name:  "🕐 Mấy trận gần đây",
			Value: joinLines(lines, "\n"),
		})
	}

	// Badges
	storedBadges, _ := b.DB.ReadPlayerBadges(ctx, targetID)
	embed.Fields = append(embed.Fields, discord.EmbedField{
		Name:  "🏅 Huy hiệu",
		Value: formatBadgesDetailed(storedBadges),
	})

	editReply(ctx, b, i, discord.EditMessagePayload{Embeds: []discord.Embed{embed}})
}
